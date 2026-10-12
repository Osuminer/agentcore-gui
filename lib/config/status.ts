import type { Graph, GraphNode, NodeStatus, NodeType } from './types';
import type { StatusResource } from '@/lib/cli/parsers';

const TYPE_MAP: Record<string, NodeType> = {
  agent: 'runtime', memory: 'memory', credential: 'credential', gateway: 'gateway', evaluator: 'evaluator',
  'online-eval': 'onlineEval', payment: 'paymentManager', 'policy-engine': 'policyEngine', policy: 'policy',
  'config-bundle': 'configBundle', dataset: 'dataset', 'knowledge-base': 'knowledgeBase', harness: 'harness',
  'capacity-provider': 'capacityProvider',
};

function mapState(s: string): NodeStatus {
  if (s === 'deployed') return 'deployed';
  if (s === 'local-only') return 'not-deployed';
  if (s === 'pending-removal') return 'pending-removal';
  return 'unknown';
}

export function applyStatus(
  graph: Graph,
  status: StatusResource[] | null,
  validate: { ok: true } | { ok: false; error: string } | null,
): Graph {
  const nodes: GraphNode[] = graph.nodes.map((n) => ({ ...n, warnings: [...n.warnings] }));
  const warnings = [...graph.warnings];

  if (status) {
    for (const r of status) {
      const type = TYPE_MAP[r.resourceType];
      if (!type) continue;
      const node = nodes.find((n) => n.type === type && n.name === r.name);
      if (node) { node.status = mapState(r.deploymentState); node.statusDetail = r.detail; }
    }
    for (const n of nodes) {
      if (n.type === 'gatewayTarget' && n.parent) {
        const gw = nodes.find((x) => x.id === n.parent);
        if (gw) n.status = gw.status;
      }
    }
  }

  if (validate && !validate.ok) {
    warnings.push({ scope: 'validate', message: validate.error });
    for (const n of nodes) {
      if (validate.error.includes(`"${n.name}"`) || validate.error.includes(`'${n.name}'`)) {
        n.status = 'error';
        n.warnings.push(validate.error);
      }
    }
  }
  return { ...graph, nodes, warnings };
}
