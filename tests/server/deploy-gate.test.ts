import { describe, expect, it } from 'vitest';
import { deployGate } from '@/lib/server/deploy-gate';

const ok = (resources: { resourceType: string; name: string; deploymentState: string }[]) => ({ ok: true as const, resources });

describe('deployGate', () => {
  it('allows when nothing is pending removal', () => {
    expect(deployGate(ok([{ resourceType: 'agent', name: 'a', deploymentState: 'deployed' }]), undefined, 'proj')).toEqual({ kind: 'allow' });
  });
  it('requires the project name when resources are pending removal', () => {
    const r = deployGate(ok([{ resourceType: 'memory', name: 'm', deploymentState: 'pending-removal' }]), undefined, 'proj');
    expect(r).toEqual({ kind: 'needs-typed', resources: ['memory:m'], projectName: 'proj' });
  });
  it('allows pending removal once the project name is typed', () => {
    expect(deployGate(ok([{ resourceType: 'memory', name: 'm', deploymentState: 'pending-removal' }]), 'proj', 'proj')).toEqual({ kind: 'allow' });
  });
  it('fails closed when status could not be determined', () => {
    const r = deployGate({ ok: false, error: 'timed out' }, undefined, 'proj');
    expect(r.kind).toBe('needs-typed');
    if (r.kind === 'needs-typed') expect(r.resources.join(' ')).toMatch(/could not determine/i);
  });
  it('allows an unknown-status deploy once the project name is typed', () => {
    expect(deployGate({ ok: false, error: 'timed out' }, 'proj', 'proj')).toEqual({ kind: 'allow' });
  });
  it('rejects a wrong typed name', () => {
    expect(deployGate({ ok: false, error: 'x' }, 'nope', 'proj').kind).toBe('needs-typed');
  });
});
