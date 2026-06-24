import axios from 'axios';

// Helper to configure JIRA authorization header (Basic Auth using base64 encoded Email and Token)
const getJiraClient = () => {
  const host = process.env.JIRA_HOST;
  const email = process.env.JIRA_EMAIL;
  const token = process.env.JIRA_API_TOKEN;

  if (!host || !email || !token) {
    throw new Error('JIRA configuration is missing in the environment variables (JIRA_HOST, JIRA_EMAIL, JIRA_API_TOKEN).');
  }

  const credentials = Buffer.from(`${email}:${token}`).toString('base64');

  return axios.create({
    baseURL: host.replace(/\/$/, ''), // Strip trailing slash
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
  });
};

/**
 * Creates a bug or task issue under JIRA with details and acceptance criteria
 */
export const createJiraIssue = async (
  summary: string,
  description: string,
  acceptanceCriteria: string,
  issueType?: string,
): Promise<string> => {
  const projectKey = process.env.JIRA_PROJECT_KEY;
  const resolvedIssueType = issueType || process.env.JIRA_ISSUE_TYPE || 'Bug';

  if (!projectKey) {
    throw new Error('JIRA_PROJECT_KEY is not defined in the environment variables.');
  }

  const client = getJiraClient();
  const fullDescription = `${description}\n\n*Acceptance Criteria:*\n${acceptanceCriteria}`;

  const attemptCreate = async (type: string): Promise<string> => {
    const response = await client.post('/rest/api/2/issue', {
      fields: {
        project: {
          key: projectKey,
        },
        summary: summary,
        issuetype: {
          name: type,
        },
        description: fullDescription,
      },
    });
    return response.data.key;
  };

  try {
    return await attemptCreate(resolvedIssueType);
  } catch (error: any) {
    const errorData = error.response?.data;
    const isIssueTypeError = errorData?.errors?.issuetype;

    // Self-healing fallback: JIRA rejected the issue type, fetch valid types for this project
    if (isIssueTypeError) {
      console.warn(`JIRA rejected issue type "${resolvedIssueType}". Querying valid issue types for project "${projectKey}"...`);
      try {
        const metaResponse = await client.get(`/rest/api/2/issue/createmeta?projectKeys=${projectKey}&expand=projects.issuetypes`);
        const projects = metaResponse.data?.projects || [];
        if (projects.length > 0) {
          const issueTypes = projects[0].issuetypes || [];
          const validTypes = issueTypes.filter((it: any) => !it.subtask).map((it: any) => it.name);
          if (validTypes.length > 0) {
            console.log(`Found valid issue types for project "${projectKey}":`, validTypes);
            // Try to pick 'Task' or 'Bug' first, otherwise use the first non-subtask issue type available
            const fallbackType = validTypes.find((t: string) => t === 'Task' || t === 'Bug') || validTypes[0];
            console.log(`Retrying JIRA issue creation with fallback type "${fallbackType}"...`);
            return await attemptCreate(fallbackType);
          }
        }
      } catch (fallbackError: any) {
        console.error('Failed to resolve JIRA fallback issue type:', fallbackError.message);
      }
    }

    console.error('Error creating JIRA issue:', errorData || error.message);
    throw new Error(`Failed to create JIRA issue: ${error.message}`);
  }
};

let cachedFieldMappings: Record<string, string> | null = null;

/**
 * Dynamically queries all JIRA fields to map friendly display names (like "Repository") to field IDs (like "customfield_10015")
 */
const getFieldMappings = async (): Promise<Record<string, string>> => {
  if (cachedFieldMappings) {
    return cachedFieldMappings;
  }
  try {
    const client = getJiraClient();
    const response = await client.get('/rest/api/2/field');
    const fields = response.data || [];
    const mappings: Record<string, string> = {};
    fields.forEach((f: any) => {
      if (f.name && f.id) {
        mappings[f.name.toLowerCase()] = f.id;
      }
    });
    cachedFieldMappings = mappings;
    return mappings;
  } catch (error: any) {
    console.error('Failed to fetch JIRA field mappings:', error.message);
    return {};
  }
};

/**
 * Extracts description, acceptance criteria, and repository from a JIRA webhook payload
 */
export const extractJiraWebhookFields = async (
  payload: any,
): Promise<{ description: string; acceptanceCriteria: string; repository: string }> => {
  const issue = payload?.issue;
  if (!issue) {
    return { description: 'No issue found in payload', acceptanceCriteria: 'None', repository: 'None' };
  }

  const fields = issue.fields || {};
  let description = fields.description || '';

  // Handle both Atlassian Document Format (v3) and plain text (v2) descriptions
  if (typeof description === 'object' && description !== null) {
    description = convertAdfToPlainText(description);
  }

  let acceptanceCriteria = 'None';
  let repository = 'None';

  // 1. Resolve field IDs dynamically from friendly display names
  try {
    const mappings = await getFieldMappings();
    const acFieldId = mappings['acceptance criteria'];
    const repoFieldId = mappings['repository'] || mappings['repo'];

    if (acFieldId && fields[acFieldId]) {
      acceptanceCriteria = fields[acFieldId];
    }
    if (repoFieldId && fields[repoFieldId]) {
      repository = fields[repoFieldId];
    }
  } catch (error) {
    console.error('Error resolving custom fields from mappings:', error);
  }

  // 2. Fallback: If acceptance criteria was not found via API mappings, try custom fields scan
  if (acceptanceCriteria === 'None') {
    const customFieldKeys = Object.keys(fields).filter((k) => k.startsWith('customfield_'));
    for (const key of customFieldKeys) {
      const value = fields[key];
      if (value && typeof value === 'string' && value.toLowerCase().includes('acceptance')) {
        acceptanceCriteria = value;
        break;
      }
    }
  }

  // 3. Fallback: Parse from description text if needed
  if (acceptanceCriteria === 'None' && typeof description === 'string') {
    const acRegex = /(?:Acceptance Criteria|Criteria|AC):?\s*([\s\S]+)/i;
    const match = description.match(acRegex);
    if (match && match[1]) {
      acceptanceCriteria = match[1].trim();
      description = description.replace(acRegex, '').trim();
    }
  }

  if (repository === 'None' && typeof description === 'string') {
    const repoRegex = /(?:Repository|Repo):?\s*([^\s]+)/i;
    const match = description.match(repoRegex);
    if (match && match[1]) {
      repository = match[1].trim();
      description = description.replace(repoRegex, '').trim();
    }
  }

  // Handle JIRA v3 ADF format for the values if they are objects
  if (typeof acceptanceCriteria === 'object' && acceptanceCriteria !== null) {
    acceptanceCriteria = convertAdfToPlainText(acceptanceCriteria);
  }
  if (typeof repository === 'object' && repository !== null) {
    repository = convertAdfToPlainText(repository);
  }

  return {
    description: typeof description === 'string' ? description.trim() : '',
    acceptanceCriteria: typeof acceptanceCriteria === 'string' ? acceptanceCriteria.trim() : 'None',
    repository: typeof repository === 'string' ? repository.trim() : 'None',
  };
};

/**
 * Helper to convert JIRA v3 ADF (Atlassian Document Format) JSON to plain text
 */
const convertAdfToPlainText = (doc: any): string => {
  if (!doc || !doc.content) return '';
  let text = '';

  const traverse = (node: any) => {
    if (node.type === 'text') {
      text += node.text;
    }
    if (node.content) {
      node.content.forEach(traverse);
    }
    if (node.type === 'paragraph' || node.type === 'heading') {
      text += '\n';
    }
  };

  doc.content.forEach(traverse);
  return text.trim();
};
