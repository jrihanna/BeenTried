/**
 * Thin wrapper over the OpenAI REST API using fetch, so there is no SDK dependency.
 * Any OpenAI-compatible endpoint works via OPENAI_BASE_URL.
 */

const baseUrl = () => (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');

export function aiEnabled(): boolean {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${baseUrl()}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    throw new Error(`OpenAI ${path} failed with ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

export const EMBEDDING_DIMENSIONS = 1536;

export async function embed(text: string): Promise<number[]> {
  const data = await post<{ data: { embedding: number[] }[] }>('/embeddings', {
    model: process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small',
    input: text.slice(0, 8000),
    dimensions: EMBEDDING_DIMENSIONS,
  });
  return data.data[0].embedding;
}

export async function chatJson<T>(system: string, user: string): Promise<T> {
  const data = await post<{ choices: { message: { content: string } }[] }>('/chat/completions', {
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    temperature: 0.3,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  });
  return JSON.parse(data.choices[0].message.content) as T;
}
