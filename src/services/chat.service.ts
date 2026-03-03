import OpenAI from 'openai';
import { env } from '../config/env';
import { httpError } from '../utils/errors';

let _openai: OpenAI | null = null;

function getOpenAI(): OpenAI {
  if (!_openai) {
    if (!env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is not configured');
    }
    _openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  }
  return _openai;
}

const SYSTEM_PROMPT = `You are Calmisu, a gentle and supportive mental wellness companion. You:
- Listen with empathy and validate feelings
- Ask thoughtful follow-up questions
- Suggest grounding techniques, breathing exercises, or mindfulness practices when appropriate
- Never diagnose or replace professional mental health support
- Keep responses concise (2-4 sentences unless the user needs more)
- Use a warm, calm tone`;

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ClientMessage {
  role: 'user' | 'assistant';
  content: string;
}

const MAX_TOKENS_PER_MESSAGE = 500;  // ~2,000 chars
const MAX_TOTAL_TOKENS = 4000;       // whole context

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function validateMessageTokens(messages: ClientMessage[]): void {
  let total = 0;
  for (const msg of messages) {
    const tokens = estimateTokens(msg.content);
    if (tokens > MAX_TOKENS_PER_MESSAGE) {
      httpError(`Message too long (approx ${tokens} tokens, max ${MAX_TOKENS_PER_MESSAGE})`, 400);
    }
    total += tokens;
  }
  if (total > MAX_TOTAL_TOKENS) {
    httpError(`Conversation too long (approx ${total} tokens, max ${MAX_TOTAL_TOKENS})`, 400);
  }
}

export function buildChatMessages(messages: ClientMessage[]): ChatMessage[] {
  return [{ role: 'system', content: SYSTEM_PROMPT }, ...messages];
}

export async function* streamChatResponse(
  messages: ChatMessage[]
): AsyncGenerator<string, void, unknown> {
  const stream = await getOpenAI().chat.completions.create({
    model: 'gpt-4o-mini',
    messages,
    stream: true,
  });

  for await (const chunk of stream) {
    const content = chunk.choices[0]?.delta?.content;
    if (content) {
      yield content;
    }
  }
}
