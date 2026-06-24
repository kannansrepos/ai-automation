import axios from 'axios';

const GITHUB_API_URL = 'https://api.github.com';
const GITHUB_API_TOKEN = process.env.GITHUB_API_TOKEN!;

const client = axios.create({
  baseURL: GITHUB_API_URL,
  headers: {
    Authorization: `bearer ${GITHUB_API_TOKEN}`,
    Accept: 'application/vnd.github.v3+json',
  },
});

const validateGitHubToken = (): void => {
  if (!GITHUB_API_TOKEN) {
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
      `/repos/${repo}/compare/${commit}~1...${commit}`,
    );
    const changedFiles = response.data.files;
    return changedFiles;
  } catch (error) {
    console.error('Error fetching changed files:', error);
    throw new Error('Failed to fetch changed files.');
  }
};

const GetFileContent = async (filePath: string): Promise<string> => {
  validateGitHubToken();
  try {
    const fileClient = await axios.create({
      baseURL: filePath,
      headers: {
        Authorization: `bearer ${GITHUB_API_TOKEN}`,
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

export {
  GetGithubBuildErrors,
  GetChangedFiles,
  GetFileContent,
  createBranch,
  createFile,
  createPullRequest,
  commitMultipleFiles,
  getPullRequest,
};
