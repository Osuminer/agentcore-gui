import type { parseStatusOutput } from '@/lib/cli/parsers';

export type GateResult =
  | { kind: 'allow' }
  | { kind: 'needs-typed'; resources: string[]; projectName: string };

/**
 * Decides whether a deploy may proceed. Fails closed: if status could not be determined we cannot
 * rule out removals, so the project name must be typed just as for known pending removals.
 */
export function deployGate(
  status: ReturnType<typeof parseStatusOutput>,
  typedName: string | undefined,
  projectName: string,
): GateResult {
  let resources: string[];
  if (status.ok) {
    resources = status.resources.filter((r) => r.deploymentState === 'pending-removal').map((r) => `${r.resourceType}:${r.name}`);
    if (resources.length === 0) return { kind: 'allow' };
  } else {
    resources = [`(could not determine pending removals: ${status.error})`];
  }
  if (typedName === projectName) return { kind: 'allow' };
  return { kind: 'needs-typed', resources, projectName };
}
