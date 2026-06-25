import { GoogleGenAI } from '@google/genai';
import { clearResponse } from './helpers.js';

let aiInstance: GoogleGenAI | null = null;
const getAi = (): GoogleGenAI => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY is not configured in environment variables.',
    );
  }
  if (!aiInstance) {
    aiInstance = new GoogleGenAI({ apiKey });
  }
  return aiInstance;
};

const ai = {
  get models() {
    return getAi().models;
  },
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
      const isTransient =
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
  throw new Error('Gemini API call failed.');
};

const queryGeminiGeneral = async (prompt: string): Promise<string> => {
  let retries = 3;
  let delayMs = 1000;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await ai.models.generateContent({
        model: process.env.GEMINI_API_MODEL || 'gemini-3.5-flash',
        contents: prompt,
      });
      return response.text || '';
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
          `Gemini API returned transient error. Retrying in ${delayMs}ms... (Attempt ${attempt} of ${retries})`,
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        delayMs *= 2;
      } else {
        throw error;
      }
    }
  }
  throw new Error('Gemini query failed.');
};

export { callGemini, queryGeminiGeneral };
