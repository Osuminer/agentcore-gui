export interface StatusResource {
  resourceType: string;
  name: string;
  deploymentState: string;
  detail?: string;
}

function extractJson(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('No JSON object found in output');
  return JSON.parse(text.slice(start, end + 1));
}

export function parseStatusOutput(stdout: string):
  { ok: true; resources: StatusResource[] } | { ok: false; error: string } {
  let data: unknown;
  try { data = extractJson(stdout); } catch (e) { return { ok: false, error: `Could not parse status output: ${(e as Error).message}` }; }
  const d = data as { success?: boolean; error?: string; resources?: unknown };
  if (d.success === false) return { ok: false, error: d.error ?? 'status failed' };
  if (!Array.isArray(d.resources)) return { ok: false, error: 'status output has no resources array' };
  const resources: StatusResource[] = [];
  for (const r of d.resources) {
    const o = r as Record<string, unknown>;
    if (typeof o?.resourceType === 'string' && typeof o?.name === 'string' && typeof o?.deploymentState === 'string') {
      const res: StatusResource = { resourceType: o.resourceType, name: o.name, deploymentState: o.deploymentState };
      if (typeof o.detail === 'string') res.detail = o.detail;
      resources.push(res);
    }
  }
  return { ok: true, resources };
}

export function parseValidateOutput(stdout: string, code: number | null):
  { ok: true } | { ok: false; error: string } {
  try {
    const d = extractJson(stdout) as { success?: boolean; error?: string };
    if (d.success === true) return { ok: true };
    return { ok: false, error: d.error ?? 'validation failed' };
  } catch {
    return code === 0 ? { ok: true } : { ok: false, error: stdout.trim().slice(0, 2000) || `validate exited with code ${code}` };
  }
}
