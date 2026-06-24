import { GoogleGenAI } from '@google/genai';
import axios from 'axios';

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY!,
});

const callOpenRouter = async (prompt: string): Promise<any> => {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const model = process.env.OPENROUTER_API_MODEL;

  if (!apiKey) {
    throw new Error(
      'OPENROUTER_API_KEY is not configured in environment variables.',
    );
  }

  try {
    const response = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model: model,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://github.com/kannansrepos/cicd',
          'X-Title': 'Git Auto Fix',
        },
      },
    );

    const content = response.data?.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('No content returned from OpenRouter API');
    }

    return clearResponse(content);
  } catch (error: any) {
    console.error(
      'Error calling OpenRouter assistant:',
      error.response?.data || error.message,
    );
    throw new Error(`OpenRouter API failed: ${error.message}`);
  }
};

const callGemini = async (prompt: string): Promise<any> => {
  let retries = 3;
  let delayMs = 1000;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await ai.models.generateContent({
        model: process.env.GEMINI_API_MODEL || 'gemini-3.5-flash',
        contents: prompt,
      });
      return clearResponse(response?.text || 'No response from Gemini API');
    } catch (error: any) {
      const status =
        error.status ||
        error.statusCode ||
        (error.response && error.response.status);
      const is503 =
        status === 503 ||
        (error.message &&
          (error.message.includes('503') ||
            error.message.includes('UNAVAILABLE')));

      if (is503) {
        console.warn(
          `Gemini API returned 503. Attempting OpenRouter fallback...`,
        );
        try {
          return await callOpenRouter(prompt);
        } catch (fallbackError: any) {
          console.error('OpenRouter fallback failed:', fallbackError.message);
        }
      }

      const isTransient =
        is503 ||
        status === 429 ||
        (error.message && error.message.includes('429'));
      if (isTransient && attempt < retries) {
        console.warn(
          `Gemini API returned transient error. Retrying in ${delayMs}ms... (Attempt ${attempt} of ${retries})`,
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        delayMs *= 2; // Exponential backoff
      } else {
        throw error;
      }
    }
  }
};

const clearResponse = (rawText: string): any => {
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

export { callGemini };
