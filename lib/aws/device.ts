/** Client-safe: pulls a device-authorization URL and user code out of CLI output. */
export function extractDeviceInfo(text: string): { url?: string; code?: string } {
  const out: { url?: string; code?: string } = {};
  const urls = text.match(/https?:\/\/[^\s"'<>]+/g) ?? [];
  const url = urls.find((u) => /user_code=/.test(u)) ?? urls[0];
  if (url) out.url = url;
  const code = text.match(/\b[A-Z0-9]{4}-[A-Z0-9]{4}\b/);
  if (code) out.code = code[0];
  return out;
}
