import { callGemini, queryGeminiGeneral } from './gemini.client.js';
import { callOpenRouter, queryOpenRouterGeneral } from './openrouter.client.js';

export const getAiAssistant = async (prompt: string): Promise<any> => {
  const provider = (process.env.AI_PROVIDER || 'gemini').toLowerCase();
  if (provider === 'openrouter') {
    return callOpenRouter(prompt);
  }
  // Default to Gemini
  return callGemini(prompt);
};

export const queryAiGeneral = async (prompt: string): Promise<string> => {
  const provider = (process.env.AI_PROVIDER || 'gemini').toLowerCase();
  if (provider === 'openrouter') {
    return queryOpenRouterGeneral(prompt);
  }
  // Default to Gemini
  return queryGeminiGeneral(prompt);
};
