import type { NodeStatus, NodeType } from '@/lib/config/types';

export const TYPE_STYLE: Record<NodeType, { label: string; color: string }> = {
  runtime: { label: 'Runtime', color: '#3b82f6' },
  harness: { label: 'Harness', color: '#6366f1' },
  gateway: { label: 'Gateway', color: '#f59e0b' },
  gatewayTarget: { label: 'Gateway target', color: '#fbbf24' },
  memory: { label: 'Memory', color: '#10b981' },
  knowledgeBase: { label: 'Knowledge base', color: '#14b8a6' },
  credential: { label: 'Credential', color: '#ef4444' },
  evaluator: { label: 'Evaluator', color: '#a855f7' },
  onlineEval: { label: 'Online eval', color: '#c084fc' },
  policyEngine: { label: 'Policy engine', color: '#ec4899' },
  policy: { label: 'Policy', color: '#f472b6' },
  configBundle: { label: 'Config bundle', color: '#06b6d4' },
  abTest: { label: 'A/B test', color: '#0ea5e9' },
  dataset: { label: 'Dataset', color: '#84cc16' },
  capacityProvider: { label: 'Capacity provider', color: '#78716c' },
  mcpRuntimeTool: { label: 'MCP runtime tool', color: '#d97706' },
  paymentManager: { label: 'Payment manager', color: '#f97316' },
  paymentConnector: { label: 'Payment connector', color: '#fb923c' },
  external: { label: 'External', color: '#94a3b8' },
  other: { label: 'Other', color: '#64748b' },
};

export const STATUS_STYLE: Record<NodeStatus, { label: string; className: string }> = {
  deployed: { label: 'deployed', className: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' },
  'not-deployed': { label: 'not deployed', className: 'bg-slate-500/20 text-slate-300 border-slate-500/40' },
  'pending-removal': { label: 'pending removal', className: 'bg-amber-500/20 text-amber-300 border-amber-500/40' },
  error: { label: 'error', className: 'bg-red-500/20 text-red-300 border-red-500/40' },
  unknown: { label: 'status unknown', className: 'bg-slate-700/30 text-slate-400 border-slate-600/40' },
};
