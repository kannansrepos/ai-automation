export const clearResponse = (rawText: string): any => {
  const cleanedText = rawText.replace(/```json|```/g, '').trim();
  try {
    const parsed = JSON.parse(cleanedText);
    if (!parsed.fixes || !Array.isArray(parsed.fixes))
      throw new Error('Parsed JSON does not contain fixes array');
    console.log('AI response', parsed);

    return {
      branch_name: parsed.branch_name,
      pr_title: parsed.pr_title,
      pr_body: parsed.pr_body,
      fixes: parsed.fixes.map((fix: any) => ({
        file_path: fix.file_path,
        fixed_code: fix.fixed_code,
        base64_content: Buffer.from(fix.fixed_code || '').toString('base64'),
        explanation: fix.explanation,
      })),
    };
  } catch (e) {
    throw new Error('AI did not return valid JSON: ' + rawText);
  }
};
