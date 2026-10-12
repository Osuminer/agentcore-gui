const ALLOWED_HOSTNAMES = new Set(['127.0.0.1', 'localhost']);
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function hostnameOf(hostHeader: string): string {
  return hostHeader.replace(/:\d+$/, '').toLowerCase();
}

export type GuardResult = { ok: true } | { ok: false; reason: string };

export function checkRequest(input: { host: string | null; origin: string | null; method: string }): GuardResult {
  if (!input.host) return { ok: false, reason: 'Missing Host header' };
  if (!ALLOWED_HOSTNAMES.has(hostnameOf(input.host))) {
    return { ok: false, reason: `Host '${input.host}' is not allowed` };
  }
  if (SAFE_METHODS.has(input.method.toUpperCase())) return { ok: true };
  if (!input.origin) return { ok: false, reason: 'Missing Origin header' };
  let originHost: string;
  try {
    originHost = new URL(input.origin).host.toLowerCase();
  } catch {
    return { ok: false, reason: 'Malformed Origin header' };
  }
  if (originHost !== input.host.toLowerCase()) {
    return { ok: false, reason: `Origin '${input.origin}' does not match Host` };
  }
  return { ok: true };
}
