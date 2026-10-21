import OpenAI from 'openai';

// Groq та інші провайдери з OpenAI-сумісним API — один клієнт і для тексту, і для розпізнавання мови
export const LLM_CLIENT = Symbol('LLM_CLIENT');

export function createLlmClient(): OpenAI {
  const apiKey = process.env.LLM_API_KEY;
  if (!apiKey) {
    throw new Error(
      'LLM_API_KEY не задано в .env — візьми безплатний ключ на https://console.groq.com/keys',
    );
  }
  return new OpenAI({
    apiKey,
    baseURL: process.env.LLM_BASE_URL || 'https://api.groq.com/openai/v1',
  });
}
