import { queryAiGeneral } from './index.js';


export const parseCleanJson = (str: string): any => {
  const cleaned = str.replace(/```json|```/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    // Try to find the start index of the JSON structure
    const firstBrace = cleaned.indexOf('{');
    const firstBracket = cleaned.indexOf('[');
    let startChar = '{';
    let endChar = '}';
    let startIndex = firstBrace;

    if (firstBracket !== -1 && (firstBrace === -1 || firstBracket < firstBrace)) {
      startChar = '[';
      endChar = ']';
      startIndex = firstBracket;
    }

    if (startIndex === -1) {
      throw e;
    }

    let sub = cleaned.slice(startIndex);
    let index = sub.lastIndexOf(endChar);
    while (index > 0) {
      const candidate = sub.slice(0, index + 1);
      try {
        return JSON.parse(candidate);
      } catch (err) {
        sub = candidate.slice(0, index);
        index = sub.lastIndexOf(endChar);
      }
    }
    throw e;
  }
};

/**
 * Stage 1: Select relevant files from the project file tree that are necessary for generating test cases.
 */
export const selectRelevantFilesForTesting = async (
  summary: string,
  description: string,
  acceptanceCriteria: string,
  fileTree: string[],
): Promise<string[]> => {
  const prompt = `
You are a test case engineer. We need to write tests for the following JIRA ticket:
JIRA Summary: ${summary}
JIRA Description: ${description}
JIRA Acceptance Criteria: ${acceptanceCriteria}

Here is the list of files in the target repository:
${fileTree.map(f => `- ${f}`).join('\n')}

Identify which of these existing source files (implementation files such as controllers, services, utilities, database models, etc.) are relevant and should be read to understand the requirements and write appropriate tests. Do not select existing test files unless they are config files (e.g. jest.config.js, playwright.config.ts) that show the test setups.
Return ONLY a valid JSON array of file paths.
Example:
[
  "src/controllers/user.controller.ts",
  "src/services/user.service.ts"
]
Do not include markdown blocks, backticks (like \`\`\`json), or notes. Return only the JSON array.
`;

  try {
    const rawResult = await queryAiGeneral(prompt);
    const files = parseCleanJson(rawResult);
    if (Array.isArray(files)) {
      // Filter out files that are not in the repository file tree
      return files.filter(f => fileTree.includes(f));
    }
    return [];
  } catch (error: any) {
    console.error('Error in selectRelevantFilesForTesting AI Stage 1:', error.message);
    return [];
  }
};

export interface TestFileDefinition {
  file_path: string;
  code: string;
  explanation: string;
}

/**
 * Stage 2: Generate all possible unit, integration, and E2E (e.g. Playwright) test files based on the requirements.
 */
export const generateTestFiles = async (
  summary: string,
  description: string,
  acceptanceCriteria: string,
  fileTree: string[],
  filesContent: { path: string; content: string }[],
  language: string,
): Promise<TestFileDefinition[]> => {
  let filesSection = '';
  filesContent.forEach(file => {
    filesSection += `File Path: ${file.path}\nContent:\n${file.content}\n\n========================================\n\n`;
  });

  const prompt = `
You are an expert software test developer. We need to create unit, integration, E2E, smoke, playwright, and other various test cases in ${language} for the following JIRA ticket requirements:
JIRA Summary: ${summary}
JIRA Description: ${description}
JIRA Acceptance Criteria: ${acceptanceCriteria}

Here is the list of all files in the project:
${fileTree.map(f => `- ${f}`).join('\n')}

Here is the contents of the relevant source files (both implementation code and existing test files) selected for your analysis:
${filesSection}

Please perform the test case generation by following these steps:
1. TEST PLANNING & GAP ANALYSIS:
   - Identify all necessary test scenarios (including positive, negative, and edge cases) to fully verify the JIRA ticket and acceptance criteria.
   - Carefully review the provided existing test files.
   - Verify which of these identified test scenarios are ALREADY covered in the existing tests.
   - If a test scenario is already covered, you MUST SKIP writing it (do not create duplicate test cases).
   
2. TEST IMPLEMENTATION:
   - For missing scenarios, determine what type of test to write: unit tests, integration tests, E2E tests, smoke tests, playwright tests, or other specialized tests.
   - If you are adding test cases to an existing test file, make sure to return the ENTIRE updated test file (incorporating the new test cases cleanly alongside the existing code).
   - If writing new test files, ensure they fit perfectly into the project structure.
   - Ensure the tests:
     - Maximize code coverage (aiming for 100% logic and branch coverage).
     - Match the programming language (${language}) and testing framework of the codebase.
     - Avoid dummy or trivial assertions. Write comprehensive checks.

CRITICAL: Do NOT ask any questions or output any conversational text, notes, explanations, or requests for details in the response. You are a fully autonomous agent. If the target repository or files are empty or lack implementation, you MUST assume the role of the developer and generate both the required implementation/helper files and the complete suite of test files (unit, integration, Playwright E2E, and configurations) required to fulfill the JIRA ticket and Acceptance Criteria.

Return the generated files in a JSON format:
{
  "files": [
    {
      "file_path": "path/to/test_file.spec.ts",
      "code": "entire code of the test file here",
      "explanation": "why this test file was created, what it tests, what plan was followed, and which duplicate tests were skipped"
    }
  ]
}
Do not include markdown blocks, backticks (like \`\`\`json), or notes outside the JSON structure. Return only the valid JSON.
`;

  try {
    const rawResult = await queryAiGeneral(prompt);
    console.log('[Test Generator DEBUG] Stage 2 AI rawResult:\n', rawResult);
    const parsed = parseCleanJson(rawResult);
    
    let filesList: any[] = [];
    if (parsed && Array.isArray(parsed.files)) {
      filesList = parsed.files;
    } else if (Array.isArray(parsed)) {
      filesList = parsed;
    } else if (parsed && typeof parsed === 'object') {
      if (parsed.file_path || parsed.code || parsed.content) {
        filesList = [parsed];
      }
    }
    
    return filesList.map((item: any) => {
      const code = item.code || item.content || '';
      const explanation = item.explanation || item.description || '';
      return {
        file_path: item.file_path || 'test.spec.ts',
        code: typeof code === 'string' ? code : JSON.stringify(code),
        explanation: typeof explanation === 'string' ? explanation : JSON.stringify(explanation)
      };
    }).filter(f => f.code.trim() !== '');

  } catch (error: any) {
    console.error('Error in generateTestFiles AI Stage 2:', error.message);
    throw new Error(`AI test generation failed: ${error.message}`);
  }
};

/**
 * Stage 3: Re-validate and refine the generated test cases to ensure syntax correctness, coverage, and robust scenarios.
 */
export const validateAndOptimizeTestFiles = async (
  summary: string,
  description: string,
  acceptanceCriteria: string,
  generatedFiles: TestFileDefinition[],
  language: string,
): Promise<TestFileDefinition[]> => {
  let filesSection = '';
  generatedFiles.forEach(file => {
    filesSection += `File Path: ${file.file_path}\nCode:\n${file.code}\n\n========================================\n\n`;
  });

  const prompt = `
You are a senior QA architect and AI code reviewer. Please re-validate and refine the following generated ${language} test files to make sure they:
1. Fully cover all possible test cases (positive, negative, edge cases) for the JIRA issue:
   JIRA Summary: ${summary}
   JIRA Description: ${description}
   JIRA Acceptance Criteria: ${acceptanceCriteria}
2. Compile and run without syntax errors, import errors, or type errors in ${language}.
3. Ensure 100% logic and branch code coverage. Review the implementation details of the original files and ensure every single branch, error condition, and code path in the target files is covered by the tests.
4. Do NOT mock objects unnecessarily if they are simple to initialize, but mock external network APIs, databases, or third-party dependencies properly.

Here are the generated test files:
${filesSection}

Return the final list of optimized test files in the same JSON format:
{
  "files": [
    {
      "file_path": "path/to/test_file.spec.ts",
      "code": "final verified and complete code of the test file here",
      "explanation": "explanation of refinement/verification done"
    }
  ]
}
Do not include markdown blocks, backticks (like \`\`\`json), or notes outside the JSON structure. Return only the valid JSON.
`;

  try {
    const rawResult = await queryAiGeneral(prompt);
    const parsed = parseCleanJson(rawResult);
    
    let filesList: any[] = [];
    if (parsed && Array.isArray(parsed.files)) {
      filesList = parsed.files;
    } else if (Array.isArray(parsed)) {
      filesList = parsed;
    } else if (parsed && typeof parsed === 'object') {
      if (parsed.file_path || parsed.code || parsed.content) {
        filesList = [parsed];
      }
    }
    
    if (filesList.length > 0) {
      return filesList.map((item: any) => {
        const code = item.code || item.content || '';
        const explanation = item.explanation || item.description || '';
        return {
          file_path: item.file_path || 'test.spec.ts',
          code: typeof code === 'string' ? code : JSON.stringify(code),
          explanation: typeof explanation === 'string' ? explanation : JSON.stringify(explanation)
        };
      }).filter(f => f.code.trim() !== '');
    }
    return generatedFiles; // Fallback to original files on empty array
  } catch (error: any) {
    console.error('Error in validateAndOptimizeTestFiles AI Stage 3:', error.message);
    return generatedFiles; // Fallback on failure
  }
};
