/**
 * Minimal Gemini REST client (generateContent with structured JSON output).
 *
 * BYOK: the key comes from the user's browser storage and is sent ONLY to
 * Google's endpoint, in the `x-goog-api-key` header (never in the URL, so it
 * does not end up in logs or history).
 */
export const DEFAULT_MODEL = 'gemini-2.5-flash';
const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

export interface GeminiContent {
  role: 'user' | 'model';
  parts: { text: string }[];
}

/** OpenAPI-subset schema accepted by `responseSchema`. */
export type GeminiSchema =
  | { type: 'STRING'; description?: string; enum?: string[] }
  | { type: 'NUMBER' | 'INTEGER' | 'BOOLEAN'; description?: string }
  | { type: 'ARRAY'; items: GeminiSchema; description?: string }
  | { type: 'OBJECT'; properties: Record<string, GeminiSchema>; required?: string[]; propertyOrdering?: string[]; description?: string };

export class GeminiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export interface GeminiCall {
  apiKey: string;
  model: string;
  system: string;
  contents: GeminiContent[];
  schema: GeminiSchema;
  temperature?: number;
  /** 0 disables thinking (faster); undefined lets the model decide. */
  thinkingBudget?: number;
  signal?: AbortSignal;
}

export async function generateJson<T>(call: GeminiCall): Promise<T> {
  const body = {
    systemInstruction: { parts: [{ text: call.system }] },
    contents: call.contents,
    generationConfig: {
      temperature: call.temperature ?? 0.1,
      responseMimeType: 'application/json',
      responseSchema: call.schema,
      ...(call.thinkingBudget !== undefined ? { thinkingConfig: { thinkingBudget: call.thinkingBudget } } : {}),
    },
  };

  let res: Response;
  try {
    res = await fetch(`${ENDPOINT}/${encodeURIComponent(call.model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': call.apiKey },
      body: JSON.stringify(body),
      signal: call.signal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new GeminiError('Network error — could not reach the Gemini API. Check your connection.');
  }

  const json = (await res.json().catch(() => null)) as {
    error?: { message?: string; status?: string };
    candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
    promptFeedback?: { blockReason?: string };
  } | null;

  if (!res.ok) {
    const msg = json?.error?.message ?? res.statusText;
    if (res.status === 400 && /api key/i.test(msg)) throw new GeminiError('The Gemini API key is invalid. Update it in settings.', 400);
    if (res.status === 403) throw new GeminiError(`Gemini refused the request (403): ${msg}`, 403);
    if (res.status === 404) throw new GeminiError(`Model "${call.model}" was not found for this key (404).`, 404);
    if (res.status === 429) throw new GeminiError('Gemini rate limit or quota reached (429). Wait a moment, or use Demo mode.', 429);
    throw new GeminiError(`Gemini API error ${res.status}: ${msg}`, res.status);
  }
  if (json?.promptFeedback?.blockReason) throw new GeminiError(`Gemini blocked the prompt: ${json.promptFeedback.blockReason}`);

  const cand = json?.candidates?.[0];
  const text = (cand?.content?.parts ?? [])
    .filter((p) => !p.thought && typeof p.text === 'string')
    .map((p) => p.text)
    .join('');
  if (!text) throw new GeminiError(`Gemini returned no content (finish reason: ${cand?.finishReason ?? 'unknown'}).`);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new GeminiError('Gemini returned malformed JSON.');
  }
}
