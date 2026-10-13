export class ApiError extends Error {
  constructor(public status: number, public body: unknown, message: string) { super(message); }
}

async function parse<T>(res: Response): Promise<T> {
  const text = await res.text();
  let body: unknown = undefined;
  try { body = text ? JSON.parse(text) : undefined; } catch { body = text; }
  if (!res.ok) {
    const msg = (body as { error?: string } | undefined)?.error ?? `Request failed (${res.status})`;
    throw new ApiError(res.status, body, msg);
  }
  return body as T;
}

export const getJson = <T,>(url: string) => fetch(url, { cache: 'no-store' }).then((r) => parse<T>(r));
export const postJson = <T,>(url: string, body: unknown) =>
  fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => parse<T>(r));
