import axios from 'axios';
import { clearResponse } from './helpers.js';

const callOpenRouter = async (prompt: string): Promise<any> => {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const model = process.env.OPENROUTER_API_MODEL || 'google/gemini-2.5-pro';

  if (!apiKey) {
    throw new Error(
      'OPENROUTER_API_KEY is not configured in environment variables.',
    );
  }

  let retries = 3;
  let delayMs = 1000;
  for (let attempt = 1; attempt <= retries; attempt++) {
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
      const status =
        error.status ||
        error.statusCode ||
        (error.response && error.response.status);
      const isTransient =
        status === 429 ||
        (error.message && error.message.includes('429'));
      if (isTransient && attempt < retries) {
        console.warn(
          `OpenRouter API returned transient error. Retrying in ${delayMs}ms... (Attempt ${attempt} of ${retries})`,
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        delayMs *= 2;
      } else {
        console.error(
          'Error calling OpenRouter assistant:',
          error.response?.data || error.message,
        );
        throw new Error(`OpenRouter API failed: ${error.message}`);
      }
    }
  }
  throw new Error('OpenRouter query failed.');
};

const queryOpenRouterGeneral = async (prompt: string): Promise<string> => {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const model = process.env.OPENROUTER_API_MODEL || 'google/gemini-2.5-pro';
  if (!apiKey) {
    throw new Error(
      'OPENROUTER_API_KEY is not configured in environment variables.',
    );
  }

  let retries = 3;
  let delayMs = 1000;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await axios.post(
        'https://openrouter.ai/api/v1/chat/completions',
        {
          model: model,
          messages: [{ role: 'user', content: prompt }],
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
      if (!content) throw new Error('No content returned from OpenRouter API');
      return content;
    } catch (error: any) {
      const status =
        error.status ||
        error.statusCode ||
        (error.response && error.response.status);
      const isTransient =
        status === 429 ||
        (error.message && error.message.includes('429'));
      if (isTransient && attempt < retries) {
        console.warn(
          `OpenRouter API returned transient error. Retrying in ${delayMs}ms... (Attempt ${attempt} of ${retries})`,
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        delayMs *= 2;
      } else {
        throw error;
      }
    }
  }
  throw new Error('OpenRouter query failed.');
};

export { callOpenRouter, queryOpenRouterGeneral };
