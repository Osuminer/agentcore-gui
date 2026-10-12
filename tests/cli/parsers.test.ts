import { describe, expect, it } from 'vitest';
import { parseStatusOutput, parseValidateOutput } from '@/lib/cli/parsers';

describe('parseStatusOutput', () => {
  it('parses the --json shape', () => {
    const out = JSON.stringify({ success: true, resources: [{ resourceType: 'agent', name: 'a', deploymentState: 'local-only' }] });
    expect(parseStatusOutput(out)).toEqual({ ok: true, resources: [{ resourceType: 'agent', name: 'a', deploymentState: 'local-only' }] });
  });
  it('tolerates log noise around the JSON', () => {
    const out = 'Loading...\n' + JSON.stringify({ success: true, resources: [] }) + '\nDone\n';
    expect(parseStatusOutput(out)).toEqual({ ok: true, resources: [] });
  });
  it('reports success:false', () => {
    expect(parseStatusOutput(JSON.stringify({ success: false, error: 'boom' }))).toEqual({ ok: false, error: 'boom' });
  });
  it('reports non-JSON output', () => {
    expect(parseStatusOutput('garbage').ok).toBe(false);
  });
  it('drops malformed resource entries', () => {
    const out = JSON.stringify({ success: true, resources: [{ name: 'x' }, { resourceType: 'agent', name: 'a', deploymentState: 'deployed' }] });
    const r = parseStatusOutput(out);
    expect(r.ok && r.resources.length).toBe(1);
  });
});

describe('parseValidateOutput', () => {
  it('ok', () => expect(parseValidateOutput('{"success":true}', 0)).toEqual({ ok: true }));
  it('error message', () => {
    expect(parseValidateOutput('{"success":false,"error":"bad gateway"}', 1)).toEqual({ ok: false, error: 'bad gateway' });
  });
  it('non-JSON non-zero exit', () => {
    const r = parseValidateOutput('something broke', 1);
    expect(r.ok).toBe(false);
  });
});
