import {
  extractJiraWebhookFields,
  createJiraSubtask,
  getDefaultBranch,
  getRepositoryFileTree,
  getFileContentByPath,
  createBranch,
  commitMultipleFiles,
  createPullRequest,
  selectRelevantFilesForTesting,
  generateTestFiles,
  validateAndOptimizeTestFiles,
} from '@git-auto-fix/shared';

const detectLanguageFromFileTree = (files: string[]): string => {
  let tsCount = 0;
  let jsCount = 0;
  let pyCount = 0;
  let goCount = 0;
  let javaCount = 0;
  let rsCount = 0;

  files.forEach(f => {
    if (f.endsWith('.ts') || f.endsWith('.tsx')) tsCount++;
    else if (f.endsWith('.js') || f.endsWith('.jsx') || f.endsWith('.mjs')) jsCount++;
    else if (f.endsWith('.py')) pyCount++;
    else if (f.endsWith('.go')) goCount++;
    else if (f.endsWith('.java')) javaCount++;
    else if (f.endsWith('.rs')) rsCount++;
  });

  if (tsCount > 0) return 'TypeScript';
  if (jsCount > 0) return 'JavaScript';
  if (pyCount > 0) return 'Python';
  if (goCount > 0) return 'Go';
  if (javaCount > 0) return 'Java';
  if (rsCount > 0) return 'Rust';
  return 'JavaScript'; // Default fallback
};

const findRelatedTestFiles = (implementationFile: string, fileTree: string[]): string[] => {
  const baseName = implementationFile.split('/').pop()?.split('.')[0] || '';
  if (!baseName) return [];
  
  return fileTree.filter(path => {
    const filename = path.split('/').pop() || '';
    const isTest = path.includes('/test/') || path.includes('/tests/') || path.includes('/__tests__/') || filename.includes('.test.') || filename.includes('.spec.');
    return isTest && filename.toLowerCase().includes(baseName.toLowerCase());
  });
};

/**
 * Automates the test generation pipeline when a new JIRA issue is created:
 * 1. Resolves repository coordinates from the ticket.
 * 2. Fetches the file tree layout.
 * 3. Inspects relevant source code files selected by AI.
 * 4. Generates comprehensive tests (unit, integration, Playwright E2E) matching project context.
 * 5. Re-validates test cases to ensure correct syntax and high coverage.
 * 6. Commits changes to a new branch and opens a Pull Request on the target repository.
 * 7. Logs a JIRA subtask tracking the progress.
 */
export const generateTestsForJiraIssue = async (payload: any): Promise<void> => {
  const issueKey = payload?.issue?.key;
  if (!issueKey) {
    console.error('[Test Generator] Webhook payload does not contain issue key. Aborting.');
    return;
  }

  const isSubtask = payload?.issue?.fields?.issuetype?.subtask || false;
  if (isSubtask) {
    console.log(`[Test Generator] Issue ${issueKey} is a subtask. Skipping automated test generation.`);
    return;
  }

  const fields = payload?.issue?.fields || {};
  const summary = fields.summary || '';

  console.log(`[Test Generator] Initializing automated test generation for ${issueKey}: "${summary}"`);

  // 1. Extract the Description, Acceptance Criteria, and Repository fields
  const { description, acceptanceCriteria, repository } = await extractJiraWebhookFields(payload);

  if (!repository || repository === 'None') {
    console.warn(`[Test Generator] No target Repository specified for ${issueKey}. Aborting.`);
    return;
  }

  // 2. Parse GitHub repository coordinates (owner/repo)
  const repoName = repository
    .replace(/https?:\/\/github\.com\//i, '')
    .replace(/\.git$/i, '')
    .trim();

  console.log(`[Test Generator] Target repository identified: "${repoName}"`);

  try {
    // 3. Retrieve default branch name and repository file tree
    const defaultBranch = await getDefaultBranch(repoName);
    console.log(`[Test Generator] Default branch: "${defaultBranch}"`);

    const rawTree = await getRepositoryFileTree(repoName, defaultBranch);
    const fileTreePaths = rawTree.map((node: any) => node.path);
    console.log(`[Test Generator] Retrieved ${fileTreePaths.length} files from repository tree.`);

    // Auto-detect programming language from repository file tree
    const language = detectLanguageFromFileTree(fileTreePaths);
    console.log(`[Test Generator] Identified repository language: "${language}"`);

const isSourceCodeFile = (path: string): boolean => {
  const excludedDirs = ['.git', '.github', 'node_modules', 'dist', 'build', 'coverage'];
  const excludedFiles = ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', '.gitignore', 'README.md'];
  
  const parts = path.split('/');
  if (parts.some(p => excludedDirs.includes(p))) return false;
  
  const filename = parts[parts.length - 1];
  if (!filename || excludedFiles.includes(filename)) return false;
  
  const codeExtensions = ['.js', '.jsx', '.ts', '.tsx', '.json', '.py', '.java', '.go', '.rs', '.c', '.cpp', '.h', '.cs', '.php', '.rb', '.yml', '.yaml'];
  return codeExtensions.some(ext => filename.endsWith(ext));
};

    // 4. Select relevant implementation files
    let selectedFiles = fileTreePaths.filter(isSourceCodeFile);
    console.log(`[Test Generator] Filtered ${selectedFiles.length} source code files from tree.`);

    if (selectedFiles.length > 25) {
      console.log('[Test Generator] AI Stage 1: Selecting relevant implementation files from large tree...');
      selectedFiles = await selectRelevantFilesForTesting(
        summary,
        description,
        acceptanceCriteria,
        selectedFiles,
      );
      console.log(`[Test Generator] AI selected ${selectedFiles.length} files for analysis:`, selectedFiles);
    } else {
      console.log(`[Test Generator] Bypassing Stage 1 AI selection (small tree). Using all ${selectedFiles.length} source files:`, selectedFiles);
    }

    // 5. Fetch contents of the selected files (including existing related test files)
    const allFilesToFetch = [...selectedFiles];
    selectedFiles.forEach(implFile => {
      const relatedTests = findRelatedTestFiles(implFile, fileTreePaths);
      relatedTests.forEach(testFile => {
        if (!allFilesToFetch.includes(testFile)) {
          allFilesToFetch.push(testFile);
        }
      });
    });

    console.log(`[Test Generator] Fetching contents of ${allFilesToFetch.length} files (including code files and existing test files)...`);
    const filesContent = await Promise.all(
      allFilesToFetch.map(async (path) => {
        try {
          const content = await getFileContentByPath(repoName, path, defaultBranch);
          return { path, content };
        } catch (err: any) {
          console.warn(`[Test Generator] Could not fetch content for ${path}:`, err.message);
          return { path, content: '' };
        }
      }),
    );
    // Filter out files that failed to fetch or are empty
    const validFilesContent = filesContent.filter(f => f.content !== '');

    // 6. AI Stage 2: Generate test cases
    console.log('[Test Generator] AI Stage 2: Generating test files...');
    const generatedTests = await generateTestFiles(
      summary,
      description,
      acceptanceCriteria,
      fileTreePaths,
      validFilesContent,
      language,
    );

    if (generatedTests.length === 0) {
      console.warn('[Test Generator] AI did not generate any test files. Aborting.');
      return;
    }

    console.log(`[Test Generator] AI generated ${generatedTests.length} test files.`);

    // 7. AI Stage 3: Validate and refine test files for syntax and coverage
    console.log('[Test Generator] AI Stage 3: Validating and optimizing test cases...');
    const validatedTests = await validateAndOptimizeTestFiles(
      summary,
      description,
      acceptanceCriteria,
      generatedTests,
      language,
    );

    // 8. Create Git branch
    const branchName = `fix/${issueKey.toLowerCase()}-test-cases`;
    console.log(`[Test Generator] Creating Git branch: "${branchName}"`);
    await createBranch(repoName, branchName, defaultBranch);

    // 9. Commit the test files (encoding code to base64)
    console.log('[Test Generator] Committing test files to GitHub...');
    const commitMessage = `[${issueKey}] Add unit, integration, and E2E test cases`;
    const filesToCommit = validatedTests.map(test => ({
      path: test.file_path,
      content: Buffer.from(test.code || '').toString('base64'),
    }));

    await commitMultipleFiles(repoName, branchName, filesToCommit, commitMessage);

    // 10. Open Pull Request targeting the default branch
    console.log('[Test Generator] Creating Pull Request...');
    const prTitle = `[${issueKey}] : Automated Test Cases Creation`;
    const prBody = `Automated PR generated by **Git Auto Fix** test suite creator.
    
### Summary
This Pull Request introduces unit, integration, and end-to-end tests based on the JIRA ticket:
- **JIRA Key:** [${issueKey}](${process.env.JIRA_HOST}/browse/${issueKey})
- **JIRA Summary:** ${summary}

### Generated Test Files:
${validatedTests.map(t => `- \`${t.file_path}\`: ${t.explanation}`).join('\n')}

Please review test coverage and syntax verification.`;

    await createPullRequest(repoName, branchName, defaultBranch, prTitle, prBody);
    console.log('[Test Generator] Pull Request successfully opened!');

    // 11. Create JIRA tracking sub-task
    console.log('[Test Generator] Logging subtask inside JIRA...');
    const subtaskSummary = `Test case creation based on ${issueKey}`;
    const subtaskDesc = `Automated unit, integration, and Playwright E2E test cases have been generated and validated for the requirements of ticket ${issueKey}.
    
- *Target Repository:* ${repoName}
- *Branch Name:* \`${branchName}\`
- *PR Title:* ${prTitle}`;
    
    const subtaskAC = `1. Pull Request has been opened in target repository.
2. Review the generated tests in the PR files list.
3. Validate that test execution completes cleanly and achieves high code coverage.`;

    const subtaskKey = await createJiraSubtask(issueKey, subtaskSummary, subtaskDesc, subtaskAC);
    console.log(`[Test Generator] Automated test generation flow completed. Created Subtask: ${subtaskKey}`);

  } catch (error: any) {
    console.error(`[Test Generator] Error during test generation flow for ${issueKey}:`, error.message);
  }
};
