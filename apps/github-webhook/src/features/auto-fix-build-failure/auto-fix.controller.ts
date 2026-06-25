import type { Request, Response } from 'express';
import type { GitFailureRequest } from '@git-auto-fix/shared';
import {
  createBranch,
  commitMultipleFiles,
  createPullRequest,
  GetChangedFiles,
  GetFileContent,
  GetGithubBuildErrors,
  CodeExtensions,
  getLanguageName,
  GetPrompt,
  getAiAssistant,
  createJiraIssue,
  createJiraSubtask,
  findJiraKeyInPullRequest,
  addJiraComment,
  getPullRequest,
} from '@git-auto-fix/shared';

/**
 * Endpoint callback for when a GitHub build failure occurs.
 * Responds immediately and processes the auto-fix asynchronous logic in the background.
 */
export const handleBuildFailureCallback = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const request: GitFailureRequest = req.body;
  const branch = request.branch || '';
  handleAutoFix(request).catch((error) => {
    console.error('Error running auto-fix process:', error);
  });
  // Process auto-fix in background to keep API response times minimal
  setTimeout(() => {
    res.status(200).json({
      success: true,
      message: `Auto-fix process initiated successfully for branch "${branch}".`,
    });
  }, 10);
};

/**
 * Asynchronously handles the auto-fix pipeline:
 * 1. Resolves and parses build logs.
 * 2. Creates a corresponding JIRA tracking ticket.
 * 3. Identifies changed code files.
 * 4. Invokes the AI assistant to formulate a solution.
 * 5. Applies fixes to a new Git branch and opens a PR.
 */
const handleAutoFix = async (request: GitFailureRequest): Promise<void> => {
  console.log('STEP 1: Fetching failed job information');
  const failedJob = await GetGithubBuildErrors(
    request.run_id,
    request.repository,
  );
  console.log('STEP 1: Completed');

  // Filter steps that explicitly failed
  const failedSteps =
    failedJob?.steps?.filter((s: any) => s.conclusion === 'failure') || [];

  // Generate failed step details formatted for the prompt
  const stepDetails = failedSteps
    .map(
      (s: any) => `
        Step: ${s.name}
        Status: ${s.status}
        Started: ${s.started_at}
        Completed: ${s.completed_at}
      `,
    )
    .join('\n');

  // Attempt to find any JIRA issue key associated with the Pull Request/branch
  let parentJiraKey: string | null = null;
  try {
    parentJiraKey = await findJiraKeyInPullRequest(
      request.repository,
      request.branch,
      request.commit,
    );
  } catch (error: any) {
    console.error('Error finding JIRA key in PR:', error.message);
  }

  // Asynchronously log the failure under JIRA
  console.log('STEP 1.5: Submitting tracking issue to JIRA');
  const jiraSummary = `Build Failure: ${request.repository} - Run #${request.run_number}`;
  const jiraDescription = `A CI/CD pipeline build failure has been detected.
- *Repository:* [${request.repository}|https://github.com/${request.repository}]
- *Workflow:* ${request.workflow}
- *Run URL:* [Workflow Run URL|https://github.com/${request.repository}/actions/runs/${request.run_id}]
- *Failed Job:* ${failedJob?.name || 'Unknown'}
- *Commit SHA:* \`${request.commit}\`
- *Triggered By:* ${request.actor}`;

  const failedStepNames =
    failedSteps.map((s: any) => s.name).join(', ') || 'Build Execution';
  const jiraAcceptanceCriteria = `1. Resolve the compile or test failures reported in step(s): *${failedStepNames}*.
2. Verify that the updated project code builds cleanly.
3. Ensure that a new pipeline run starts and passes successfully.`;

  let jiraKey = '';
  const issueType = (request as any).issue_type;
  try {
    if (parentJiraKey) {
      console.log(
        `[Auto-Fix] Creating JIRA subtask under parent: ${parentJiraKey}`,
      );
      jiraKey = await createJiraSubtask(
        parentJiraKey,
        jiraSummary,
        jiraDescription,
        jiraAcceptanceCriteria,
      );
    } else {
      console.log(
        '[Auto-Fix] No parent JIRA key found in PR. Creating regular JIRA issue.',
      );
      jiraKey = await createJiraIssue(
        jiraSummary,
        jiraDescription,
        jiraAcceptanceCriteria,
        issueType,
      );
    }
    console.log(`Created JIRA issue: ${jiraKey}`);
  } catch (err: any) {
    console.error('Failed to create JIRA issue:', err.message);
  }

  console.log('STEP 2: Fetching changed files for the commit');
  const changedFiles = await GetChangedFiles(
    request.commit,
    request.repository,
  );
  console.log('STEP 2: Completed');

  // Filter out files that are not code files or files that were removed
  const relevantFiles = changedFiles.filter(
    (f: any) =>
      CodeExtensions.some((ext: any) => f.filename.endsWith(ext)) &&
      f.status !== 'removed',
  );

  if (relevantFiles.length === 0) {
    console.log('No relevant files found for auto-fix analysis.');
    return;
  }

  console.log('STEP 3: Fetching files contents in parallel');
  // Fetch file content for all relevant files concurrently for better performance
  const fileContents = await Promise.all(
    relevantFiles.map(async (file: any) => {
      const fileExtension = file.filename.split('.').pop();
      const language = getLanguageName(fileExtension) || fileExtension;
      const actualCode = await GetFileContent(file.raw_url);
      return {
        filename: file.filename,
        status: file.status,
        language,
        actualCode,
      };
    }),
  );
  console.log('STEP 3: Completed');

  console.log('STEP 4: Invoking AI Assistant to generate fixes');
  let filesSection = '';
  fileContents.forEach((file) => {
    filesSection += `File: ${file.filename}\nStatus: ${file.status}\n\`\`\`${file.language}\n${file.actualCode}\n\`\`\`\n\n`;
  });

  const prompt = GetPrompt(
    request,
    failedJob,
    stepDetails,
    relevantFiles.length,
    filesSection,
  );

  let aiResult: any;
  try {
    aiResult = await getAiAssistant(prompt);
  } catch (error) {
    console.error('Error calling AI assistant:', error);
    return;
  }
  console.log('STEP 4: Completed. AI fixes generated successfully.');
  console.log('AI Response:', aiResult);

  // Post comment to parent JIRA issue if found in Pull Request/branch
  if (parentJiraKey) {
    try {
      console.log(
        `[Auto-Fix] Posting comment to parent JIRA task: ${parentJiraKey}`,
      );
      let commentBody = `h3. ❌ CI/CD Build Failure Detected\n\n`;
      commentBody += `A build failure occurred in the workflow: *${request.workflow}*\n`;
      commentBody += `*Commit:* [${request.commit.substring(0, 7)}|https://github.com/${request.repository}/commit/${request.commit}]\n`;
      commentBody += `*Workflow Run:* [Run #${request.run_number}|https://github.com/${request.repository}/actions/runs/${request.run_id}]\n\n`;

      commentBody += `h4. Failed Steps:\n`;
      failedSteps.forEach((s: any) => {
        commentBody += `- *${s.name}* (Status: ${s.conclusion || s.status})\n`;
      });

      commentBody += `\nh4. 🤖 AI Proposed Plan & Fixes:\n`;
      if (aiResult && aiResult.fixes) {
        aiResult.fixes.forEach((fix: any) => {
          commentBody += `- *File:* \`${fix.file_path}\`\n`;
          commentBody += `  *AI Action Plan:* ${fix.explanation || 'Applying automatic correction'}\n`;
        });
      }

      await addJiraComment(parentJiraKey, commentBody);
    } catch (err: any) {
      console.error(
        `[Auto-Fix] Failed to post comment on parent issue ${parentJiraKey}:`,
        err.message,
      );
    }
  }

  // Resolve actual writable branch (extract source branch for PRs like "3/merge" or "pull/3/merge")
  const branch = request.branch || '';
  let branchName = branch;
  let isPrBranch = false;
  let prNumber: number | null = null;

  const prMergeMatch = branch.match(/^(?:pull\/)?(\d+)\/(?:merge|head)$/);
  if (prMergeMatch) {
    prNumber = parseInt(prMergeMatch[1] || '', 10);
    isPrBranch = true;
  }

  if (isPrBranch && prNumber) {
    try {
      console.log(`[Auto-Fix] Resolving source branch for PR #${prNumber}...`);
      const prDetails = await getPullRequest(request.repository, prNumber);
      branchName = prDetails.head.ref;
      console.log(`[Auto-Fix] Resolved PR source branch: "${branchName}"`);
    } catch (e: any) {
      console.error(
        `[Auto-Fix] Failed to fetch PR details for #${prNumber}:`,
        e.message,
      );
    }
  }

  // Determine if this is a protected branch
  const isProtectedBranch = ['main', 'develop', 'devlop'].includes(branchName);

  if (isProtectedBranch) {
    // Determine branch name and create it off the failed commit
    const proposedBranchName =
      aiResult.branch_name || `auto-fix/${request.run_number}`;
    branchName = proposedBranchName;

    if (jiraKey) {
      // Strip common prefixes and replace remaining slashes with hyphens
      const cleanBranchSuffix = proposedBranchName
        .replace(/^(fix|auto-fix|branch)\//i, '')
        .replace(/\//g, '-');
      branchName = `fix/${jiraKey.toLowerCase()}-${cleanBranchSuffix}`;
    }

    console.log(
      `[Auto-Fix] Creating new fix branch: ${branchName} off commit ${request.commit}`,
    );
    await createBranch(request.repository, branchName, request.commit);
  } else {
    console.log(
      `[Auto-Fix] Non-protected branch "${branchName}". Committing fix directly to the same branch.`,
    );
  }

  console.log(`[Auto-Fix] Committing corrected files to branch ${branchName}`);
  const prPrefix = jiraKey ? `[${jiraKey}] : ` : '';
  const prTitle = `${prPrefix}${aiResult.pr_title || 'Auto-fix for build failures'}`;

  // Commit all updated files in a single push operation
  await commitMultipleFiles(
    request.repository,
    branchName,
    aiResult.fixes.map((fix: any) => ({
      path: fix.file_path,
      content: fix.base64_content,
    })),
    prTitle,
  );

  if (isProtectedBranch) {
    console.log(`[Auto-Fix] Opening PR targeting ${branch}`);
    // Open a single Pull Request targeting the failed protected branch
    await createPullRequest(
      request.repository,
      branchName,
      branch,
      prTitle,
      aiResult.pr_body || `This pull request fixes build failures.`,
    );
    console.log('[Auto-Fix] Pull Request successfully created.');
  } else {
    console.log(
      `[Auto-Fix] Direct fix committed to branch "${branchName}". No PR created.`,
    );
  }
};
