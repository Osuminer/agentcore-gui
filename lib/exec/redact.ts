const RULES: [RegExp, string][] = [
  [/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g, '[redacted-jwt]'],
  [/\b(AKIA|ASIA)[A-Z0-9]{16}\b/g, '[redacted-key-id]'],
  [/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1[redacted]'],
  [/((?:aws_)?secret_?access_?key["']?\s*[:=]\s*["']?)[^\s"',}]+/gi, '$1[redacted]'],
  [/((?:client_?secret|secret|password|passwd|(?:access|refresh|id|session)_?token|api_?key)["']?\s*[:=]\s*["']?)[^\s"',}]+/gi, '$1[redacted]'],
];

export function redact(text: string): string {
  let out = text;
  for (const [re, rep] of RULES) out = out.replace(re, rep);
  return out;
}
