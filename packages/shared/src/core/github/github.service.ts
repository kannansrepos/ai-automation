import axios from 'axios';

const GITHUB_API_URL = 'https://api.github.com';
const getClient = () => {
  const token = process.env.GITHUB_API_TOKEN;
  if (!token) {
    throw new Error('GitHub API token is not set in the environment variables.');
  }
  return axios.create({
    baseURL: GITHUB_API_URL,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.v3+json',
    },
  });
};

const client = {
  get: (url: string, config?: any) => getClient().get(url, config),
  post: (url: string, data?: any, config?: any) => getClient().post(url, data, config),
  put: (url: string, data?: any, config?: any) => getClient().put(url, data, config),
  delete: (url: string, config?: any) => getClient().delete(url, config),
  patch: (url: string, data?: any, config?: any) => getClient().patch(url, data, config),
};

const validateGitHubToken = (): void => {
  if (!process.env.GITHUB_API_TOKEN) {
    throw new Error(
      'GitHub API token is not set in the environment variables.',
    );
  }
};

const GetGithubBuildErrors = async (
  runId: string,
  repo: string,
): Promise<any> => {
  validateGitHubToken();
  try {
    const response = await client.get(
      `/repos/${repo}/actions/runs/${runId}/jobs`,
    );
    const jobs = response.data.jobs;
    const failedJobs = jobs.find((job: any) => job.conclusion === 'failure');

    return failedJobs || jobs[0]; // Return the first failed job or the first job if none failed
  } catch (error) {
    console.error('Error fetching GitHub build errors:', error);
    throw new Error('Failed to fetch GitHub build errors.');
  }
};

const GetChangedFiles = async (commit: string, repo: string): Promise<any> => {
  validateGitHubToken();
  try {
    const response = await client.get(
      `/repos/${repo}/commits/${commit}`,
    );
    const changedFiles = response.data.files || [];
    return changedFiles;
  } catch (error: any) {
    console.error(`Error fetching changed files for commit ${commit}:`, error.message);
    throw new Error('Failed to fetch changed files.');
  }
};

const GetFileContent = async (filePath: string): Promise<string> => {
  validateGitHubToken();
  try {
    const fileClient = await axios.create({
      baseURL: filePath,
      headers: {
        Authorization: `Bearer ${process.env.GITHUB_API_TOKEN}`,
      },
    });
    const response = await fileClient.get('');

    const fileContent = response.data;
    const actualCode =
      typeof fileContent === 'string'
        ? fileContent
        : fileContent.data ||
          fileContent.content ||
          JSON.stringify(fileContent);
    return actualCode;
  } catch (error) {
    console.error('Error fetching file content:', error);
    throw new Error('Failed to fetch file content.');
  }
};

const getRefPath = (branchOrRef: string): string => {
  let cleaned = branchOrRef;
  if (cleaned.startsWith('refs/')) {
    cleaned = cleaned.substring(5); // Remove 'refs/'
  }
  if (cleaned.startsWith('heads/') || cleaned.startsWith('pull/')) {
    return cleaned;
  }
  if (/^\d+\/(merge|head)$/.test(cleaned)) {
    return `pull/${cleaned}`;
  }
  return `heads/${cleaned}`;
};

const getPullRequest = async (
  repo: string,
  pullNumber: number,
): Promise<any> => {
  validateGitHubToken();
  try {
    const response = await client.get(`/repos/${repo}/pulls/${pullNumber}`);
    return response.data;
  } catch (error) {
    console.error(`Error fetching pull request ${pullNumber}:`, error);
    throw new Error(`Failed to fetch pull request ${pullNumber}.`);
  }
};

const createBranch = async (
  repo: string,
  branchName: string,
  startCommit: string,
): Promise<void> => {
  validateGitHubToken();
  try {
    // 1. Delete the branch first if it already exists to avoid "Reference already exists" (422)
    try {
      await client.delete(`/repos/${repo}/git/refs/heads/${branchName}`);
    } catch (deleteError: any) {
      const status = deleteError.response?.status;
      const isNotExist =
        status === 404 ||
        (status === 422 &&
          deleteError.response?.data?.message?.includes('does not exist'));
      if (!isNotExist) {
        console.warn(
          `Could not delete branch ${branchName}:`,
          deleteError.message,
        );
      }
    }

    // 2. Resolve startCommit to a commit SHA if it's a branch/ref name rather than a SHA
    let latestCommitSha = startCommit;
    if (!/^[0-9a-f]{40}$/i.test(startCommit)) {
      const baseBranchResponse = await client.get(
        `/repos/${repo}/git/ref/${getRefPath(startCommit)}`,
      );
      latestCommitSha = baseBranchResponse.data.object.sha;
    }

    // 3. Create the new branch referencing the latest commit SHA
    await client.post(`/repos/${repo}/git/refs`, {
      ref: `refs/heads/${branchName}`,
      sha: latestCommitSha,
    });
    console.log(
      `Branch '${branchName}' created successfully from ${latestCommitSha.substring(0, 7)}`,
    );
  } catch (error: any) {
    console.error(
      'Error creating branch:',
      error.response?.data || error.message,
    );
    throw new Error('Failed to create branch.');
  }
};

const createFile = async (
  repo: string,
  branchName: string,
  filePath: string,
  content: string,
  commitMessage: string,
): Promise<void> => {
  validateGitHubToken();
  try {
    // Create a new file in the specified branch
    await client.put(`/repos/${repo}/contents/${filePath}`, {
      message: commitMessage,
      content: Buffer.from(content).toString('base64'),
      branch: branchName,
    });
  } catch (error) {
    console.error('Error creating file:', error);
    throw new Error('Failed to create file.');
  }
};

const createPullRequest = async (
  repo: string,
  headBranch: string,
  baseBranch: string,
  title: string,
  body: string,
): Promise<void> => {
  validateGitHubToken();
  try {
    // Create a pull request from the head branch to the base branch
    await client.post(`/repos/${repo}/pulls`, {
      title: title,
      head: headBranch,
      base: baseBranch,
      body: body,
    });
  } catch (error) {
    console.error('Error creating pull request:', error);
    throw new Error('Failed to create pull request.');
  }
};

export interface FileCommit {
  path: string;
  content: string;
}

const commitMultipleFiles = async (
  repo: string,
  branchName: string,
  files: FileCommit[],
  commitMessage: string,
): Promise<void> => {
  validateGitHubToken();
  try {
    // 1. Get the latest commit SHA of the branch
    const branchRefResponse = await client.get(
      `/repos/${repo}/git/ref/heads/${branchName}`,
    );
    const latestCommitSha = branchRefResponse.data.object.sha;

    // 2. Get the commit to find its tree SHA
    const commitResponse = await client.get(
      `/repos/${repo}/git/commits/${latestCommitSha}`,
    );
    const baseTreeSha = commitResponse.data.tree.sha;

    // 3. Create blobs in parallel
    const treeItems = await Promise.all(
      files.map(async (file) => {
        const blobResponse = await client.post(`/repos/${repo}/git/blobs`, {
          content: file.content,
          encoding: 'base64',
        });
        return {
          path: file.path,
          mode: '100644',
          type: 'blob',
          sha: blobResponse.data.sha,
        };
      }),
    );

    // 4. Create a new tree
    const treeResponse = await client.post(`/repos/${repo}/git/trees`, {
      base_tree: baseTreeSha,
      tree: treeItems,
    });
    const newTreeSha = treeResponse.data.sha;

    // 5. Create a new commit
    const commitCreateResponse = await client.post(
      `/repos/${repo}/git/commits`,
      {
        message: commitMessage,
        tree: newTreeSha,
        parents: [latestCommitSha],
      },
    );
    const newCommitSha = commitCreateResponse.data.sha;

    // 6. Update the reference
    await client.patch(`/repos/${repo}/git/refs/heads/${branchName}`, {
      sha: newCommitSha,
      force: false,
    });
  } catch (error) {
    console.error('Error committing multiple files:', error);
    throw new Error('Failed to commit multiple files.');
  }
};

const getDefaultBranch = async (repo: string): Promise<string> => {
  validateGitHubToken();
  try {
    const response = await client.get(`/repos/${repo}`);
    return response.data.default_branch || 'main';
  } catch (error: any) {
    console.error(`Error fetching default branch for ${repo}:`, error.message);
    return 'main';
  }
};

const getRepositoryFileTree = async (
  repo: string,
  branch?: string,
): Promise<any[]> => {
  validateGitHubToken();
  try {
    const resolvedBranch = branch || (await getDefaultBranch(repo));

    // Get the latest commit of the branch
    const refResponse = await client.get(
      `/repos/${repo}/git/ref/${getRefPath(resolvedBranch)}`,
    );
    const commitSha = refResponse.data.object.sha;

    // Get the commit info to find the tree SHA
    const commitResponse = await client.get(
      `/repos/${repo}/git/commits/${commitSha}`,
    );
    const treeSha = commitResponse.data.tree.sha;

    // Get the recursive tree
    const treeResponse = await client.get(
      `/repos/${repo}/git/trees/${treeSha}?recursive=true`,
    );
    return treeResponse.data.tree || [];
  } catch (error: any) {
    console.error(`Error fetching file tree for ${repo}:`, error.message);
    throw new Error(`Failed to fetch file tree for repository: ${repo}`);
  }
};

const getFileContentByPath = async (
  repo: string,
  path: string,
  ref?: string,
): Promise<string> => {
  validateGitHubToken();
  try {
    const url = `/repos/${repo}/contents/${path}${ref ? `?ref=${ref}` : ''}`;
    const response = await client.get(url);
    if (response.data && response.data.content) {
      return Buffer.from(response.data.content, 'base64').toString('utf-8');
    }
    throw new Error('File content is empty or not in base64 format.');
  } catch (error: any) {
    console.error(`Error fetching file content at ${path} for ${repo}:`, error.message);
    throw new Error(`Failed to fetch file content for path: ${path}`);
  }
};

const getPullRequestsForCommit = async (
  repo: string,
  commitSha: string,
): Promise<any[]> => {
  validateGitHubToken();
  try {
    const response = await client.get(`/repos/${repo}/commits/${commitSha}/pulls`);
    return response.data || [];
  } catch (error: any) {
    console.error(`[GitHub] Error fetching PRs for commit ${commitSha}:`, error.message);
    return [];
  }
};

const findJiraKeyInPullRequest = async (
  repo: string,
  branch: string,
  commitSha: string,
): Promise<string | null> => {
  const jiraKeyRegex = /[A-Z]+-\d+/;
  
  // 1. Check branch name
  const branchMatch = branch.match(jiraKeyRegex);
  if (branchMatch) {
    return branchMatch[0];
  }

  // 2. Check PRs associated with the commit
  const prs = await getPullRequestsForCommit(repo, commitSha);
  for (const pr of prs) {
    const titleMatch = pr.title?.match(jiraKeyRegex);
    if (titleMatch) return titleMatch[0];

    const bodyMatch = pr.body?.match(jiraKeyRegex);
    if (bodyMatch) return bodyMatch[0];
  }

  // 3. Fallback: Check open PRs for this branch
  try {
    const response = await client.get(`/repos/${repo}/pulls?head=${repo.split('/')[0]}:${branch}`);
    const branchPrs = response.data || [];
    for (const pr of branchPrs) {
      const titleMatch = pr.title?.match(jiraKeyRegex);
      if (titleMatch) return titleMatch[0];

      const bodyMatch = pr.body?.match(jiraKeyRegex);
      if (bodyMatch) return bodyMatch[0];
    }
  } catch (e: any) {
    console.warn(`[GitHub] Failed to search open PRs for branch ${branch}:`, e.message);
  }

  return null;
};

export {
  GetGithubBuildErrors,
  GetChangedFiles,
  GetFileContent,
  createBranch,
  createFile,
  createPullRequest,
  commitMultipleFiles,
  getPullRequest,
  getDefaultBranch,
  getRepositoryFileTree,
  getFileContentByPath,
  findJiraKeyInPullRequest,
};
