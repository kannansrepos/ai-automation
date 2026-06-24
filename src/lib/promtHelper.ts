import type { GitFailureRequest } from '../types/gitFailureRequest.js';

const GetPrompt = (
  payload: GitFailureRequest,
  failedJob: any,
  stepDetails: any,
  releventFilesCount: number,
  filesSection: any,
): string => {
  const prompt = `
  CI/CDE Pipeline Failure Report
================================
Repository: ${payload.repository}
Branch: ${payload.branch}
Commit: ${payload.commit}
Triggered By: ${payload.actor}
Run ID: ${payload.run_id}
Run URL: https://github.com/${payload.repository}/actions/runs/${payload.run_id}

Failed Job: ${failedJob?.name || 'Unknown'}

Failed Steps:
${stepDetails || 'Unknown'}

All Steps Summary:
${failedJob?.steps?.map((s: any) => `- ${s.name}:${s.conclusion}`).join('\n') || 'None'}

Changed Files in This Commit (${releventFilesCount} files):
================================
${filesSection}
================================

IMPORTANT INSTRUCTIONS:
- The "file_path" must be the exact path of the REAL file from the list of changed files above that needs fixing.
- The "fixed_code" must contain the ENTIRE updated file content with the bug fix applied. Do NOT truncate, use comments like "// rest of code", or omit any parts of the file. It must be a complete drop-in replacement for the original file.
- Do NOT output stubs, new test suites, or unrelated placeholder code (such as dummy addition tests). The fix must be directly relevant to the build error and target the actual file.
- Preserve all existing working code, imports, styles, and logic, only modifying the parts necessary to fix the build/pipeline failure.
- Return ONLY valid JSON in this format:
{
  "branch_name": "branch-name-here",
  "pr_title": "Pull Request Title here",
  "pr_body": "Pull Request Body here",
  "fixes": [
    {
      "file_path": "actual/file/path.js",
      "fixed_code": "complete corrected code here",
      "explanation": "brief explanation of what was the fix"
    }
  ]
}
`;
  return prompt;
};

export { GetPrompt };
