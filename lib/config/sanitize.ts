export const MASK = '••••';
const SECRET_KEY = /(secret|password|passwd|token|apikey|api_key|api-key|private_?key)/i;

export function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

export function dig(v: unknown, ...keys: string[]): unknown {
  let cur: unknown = v;
  for (const k of keys) {
    if (!isObj(cur)) return undefined;
    cur = cur[k];
  }
  return cur;
}

/** Deep-clones `value`, masking env var values and string fields whose key looks secret. */
export function sanitize(value: unknown, key = ''): unknown {
  if (Array.isArray(value)) return value.map((v) => sanitize(v, key));
  if (isObj(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (k === 'envVars' && Array.isArray(v)) {
        out[k] = v.map((e) => (isObj(e) ? { ...e, value: MASK } : e));
      } else if (k === 'env' && isObj(v)) {
        out[k] = Object.fromEntries(Object.keys(v).map((name) => [name, MASK]));
      } else {
        out[k] = sanitize(v, k);
      }
    }
    return out;
  }
  if (typeof value === 'string' && SECRET_KEY.test(key)) return MASK;
  return value;
}
