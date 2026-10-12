export type NodeType =
  | 'runtime' | 'memory' | 'knowledgeBase' | 'credential' | 'evaluator' | 'onlineEval'
  | 'gateway' | 'gatewayTarget' | 'mcpRuntimeTool' | 'policyEngine' | 'policy'
  | 'configBundle' | 'abTest' | 'harness' | 'dataset' | 'capacityProvider'
  | 'paymentManager' | 'paymentConnector' | 'external' | 'other';

export type NodeStatus = 'not-deployed' | 'deployed' | 'pending-removal' | 'error' | 'unknown';

export interface GraphNode {
  id: string;                 // `${type}:${name}`; targets: `gatewayTarget:${gateway}/${name}`
  type: NodeType;
  name: string;
  status: NodeStatus;
  statusDetail?: string;
  config: Record<string, unknown>;   // sanitized
  envVarNames: string[];
  sourcePath?: string;        // project-relative
  warnings: string[];
  parent?: string;            // node id (target -> gateway)
}

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  kind: 'declared' | 'inferred';
  label: string;
  source: string;             // where it came from, e.g. "agentCoreGateways[].targets[].httpRuntime"
}

export interface GraphWarning { scope: string; message: string }

export interface Graph {
  projectName: string;
  root: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  warnings: GraphWarning[];
}
