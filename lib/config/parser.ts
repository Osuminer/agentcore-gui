import type { Graph, GraphEdge, GraphNode, GraphWarning, NodeType } from './types';
import { dig, isObj, sanitize, str } from './sanitize';

type Rec = Record<string, unknown>;

export const nodeId = (type: NodeType, name: string) => `${type}:${name}`;
const targetId = (gw: string | null, name: string) => `gatewayTarget:${gw ?? ''}/${name}`;
const policyId = (engine: string, name: string) => `policy:${engine}/${name}`;

const KNOWN_KEYS = new Set([
  '$schema', 'name', 'version', 'managedBy', 'tags', 'runtimes', 'memories', 'knowledgeBases', 'credentials',
  'evaluators', 'onlineEvalConfigs', 'agentCoreGateways', 'mcpRuntimeTools', 'unassignedTargets', 'policyEngines',
  'configBundles', 'abTests', 'harnesses', 'datasets', 'capacityProviders', 'payments',
]);

const SIMPLE: { key: string; type: NodeType }[] = [
  { key: 'runtimes', type: 'runtime' },
  { key: 'memories', type: 'memory' },
  { key: 'knowledgeBases', type: 'knowledgeBase' },
  { key: 'credentials', type: 'credential' },
  { key: 'evaluators', type: 'evaluator' },
  { key: 'onlineEvalConfigs', type: 'onlineEval' },
  { key: 'configBundles', type: 'configBundle' },
  { key: 'abTests', type: 'abTest' },
  { key: 'datasets', type: 'dataset' },
  { key: 'capacityProviders', type: 'capacityProvider' },
  { key: 'mcpRuntimeTools', type: 'mcpRuntimeTool' },
];

export class Builder {
  nodes = new Map<string, GraphNode>();
  edges = new Map<string, GraphEdge>();
  warnings: GraphWarning[] = [];

  warn(scope: string, message: string, nodeIdForNode?: string) {
    this.warnings.push({ scope, message });
    if (nodeIdForNode) this.nodes.get(nodeIdForNode)?.warnings.push(message);
  }

  add(type: NodeType, name: string, raw: Rec, opts: {
    id?: string; omit?: string[]; sourcePath?: string; envVarNames?: string[]; parent?: string;
  } = {}): string {
    const id = opts.id ?? nodeId(type, name);
    if (this.nodes.has(id)) { this.warn(type, `Duplicate ${type} '${name}' ignored`); return id; }
    const cfg: Rec = { ...raw };
    for (const k of opts.omit ?? []) delete cfg[k];
    this.nodes.set(id, {
      id, type, name, status: 'unknown', config: sanitize(cfg) as Rec,
      envVarNames: opts.envVarNames ?? [], sourcePath: opts.sourcePath, warnings: [], parent: opts.parent,
    });
    return id;
  }

  has(id: string) { return this.nodes.has(id); }

  link(from: string, to: string, kind: 'declared' | 'inferred', label: string, source: string) {
    const id = `${from}->${to}:${label}`;
    if (!this.edges.has(id)) this.edges.set(id, { id, from, to, kind, label, source });
  }

  /** Link `from` to the node `toId` if it exists, else warn about the dangling reference. */
  ref(from: string, toId: string, shown: string, label: string, source: string, kind: 'declared' | 'inferred' = 'declared') {
    if (!this.has(toId)) {
      this.warn(source, `${source}: references '${shown}' which is not defined in this project`, from);
      return;
    }
    this.link(from, toId, kind, label, source);
  }
}

function listOf(b: Builder, root: Rec, key: string): Rec[] {
  const v = root[key];
  if (v === undefined) return [];
  if (!Array.isArray(v)) { b.warn(key, `Expected an array, got ${typeof v}`); return []; }
  const out: Rec[] = [];
  v.forEach((item, i) => {
    if (!isObj(item)) { b.warn(key, `${key}[${i}] is not an object`); return; }
    if (!str(item.name)) { b.warn(key, `${key}[${i}] is an item without a name and was skipped`); return; }
    out.push(item);
  });
  return out;
}

function envNames(v: unknown): string[] {
  return Array.isArray(v) ? v.flatMap((e) => (isObj(e) && str(e.name) ? [e.name as string] : [])) : [];
}

function extras(type: NodeType, item: Rec) {
  switch (type) {
    case 'runtime': return { sourcePath: str(item.codeLocation), envVarNames: envNames(item.envVars) };
    case 'evaluator': return { sourcePath: str(dig(item, 'config', 'codeBased', 'managed', 'codeLocation')) };
    case 'mcpRuntimeTool': return { sourcePath: str(dig(item, 'compute', 'implementation', 'path')) };
    case 'dataset': return { sourcePath: str(dig(item, 'config', 'managed', 'location')) };
    default: return {};
  }
}

function addTargets(b: Builder, gw: string | null, targets: unknown, gwNodeId?: string) {
  if (!Array.isArray(targets)) return;
  targets.forEach((t, i) => {
    if (!isObj(t) || !str(t.name)) { b.warn('targets', `${gw ?? 'unassigned'}.targets[${i}] is missing a name`); return; }
    const name = t.name as string;
    const id = b.add('gatewayTarget', name, t, {
      id: targetId(gw, name), parent: gwNodeId, sourcePath: str(dig(t, 'compute', 'implementation', 'path')),
    });
    if (gwNodeId) b.link(gwNodeId, id, 'declared', 'target', 'agentCoreGateways[].targets');
  });
}

function linkTargets(b: Builder, gw: string | null, targets: unknown) {
  if (!Array.isArray(targets)) return;
  for (const t of targets) {
    if (!isObj(t) || !str(t.name)) continue;
    const id = targetId(gw, t.name as string);
    const rt = str(dig(t, 'httpRuntime', 'runtime'));
    if (rt) {
      const ep = str(dig(t, 'httpRuntime', 'runtimeEndpoint'));
      b.ref(id, nodeId('runtime', rt), rt, ep ? `runtime (${ep})` : 'runtime', 'agentCoreGateways[].targets[].httpRuntime');
    }
    const cred = str(dig(t, 'outboundAuth', 'credentialName'));
    if (cred) b.ref(id, nodeId('credential', cred), cred, 'credential', 'agentCoreGateways[].targets[].outboundAuth');
  }
}

export function parseAgentCore(input: { root: string; agentcore: unknown; harnesses: Record<string, unknown> }): Graph {
  const b = new Builder();
  const doc = input.agentcore;
  const finish = (name: string): Graph => ({
    projectName: name, root: input.root, nodes: [...b.nodes.values()], edges: [...b.edges.values()], warnings: b.warnings,
  });
  if (!isObj(doc)) { b.warn('agentcore.json', 'Top-level value is not an object'); return finish('(unknown)'); }
  for (const k of Object.keys(doc)) {
    if (!KNOWN_KEYS.has(k)) b.warn(k, `Unrecognized section '${k}' (not rendered)`);
  }

  // ---- pass 1: nodes ----
  for (const { key, type } of SIMPLE) {
    for (const item of listOf(b, doc, key)) b.add(type, item.name as string, item, extras(type, item));
  }
  for (const gw of listOf(b, doc, 'agentCoreGateways')) {
    const gid = b.add('gateway', gw.name as string, gw, { omit: ['targets'] });
    addTargets(b, gw.name as string, gw.targets, gid);
  }
  addTargets(b, null, doc.unassignedTargets);
  for (const pe of listOf(b, doc, 'policyEngines')) {
    const eid = b.add('policyEngine', pe.name as string, pe, { omit: ['policies'] });
    if (Array.isArray(pe.policies)) {
      for (const p of pe.policies) {
        if (!isObj(p) || !str(p.name)) { b.warn('policyEngines', `${pe.name}.policies has an item without a name`); continue; }
        const pid = b.add('policy', p.name as string, p, { id: policyId(pe.name as string, p.name as string), parent: eid, sourcePath: str(p.sourceFile) });
        b.link(eid, pid, 'declared', 'policy', 'policyEngines[].policies');
      }
    }
  }
  for (const pm of listOf(b, doc, 'payments')) {
    const mid = b.add('paymentManager', pm.name as string, pm, { omit: ['connectors'] });
    if (Array.isArray(pm.connectors)) {
      for (const c of pm.connectors) {
        if (!isObj(c) || !str(c.name)) { b.warn('payments', `${pm.name}.connectors has an item without a name`); continue; }
        const cid = b.add('paymentConnector', c.name as string, c, { id: `paymentConnector:${pm.name}/${c.name}`, parent: mid });
        b.link(mid, cid, 'declared', 'connector', 'payments[].connectors');
        if (str(c.credentialName)) b.ref(cid, nodeId('credential', c.credentialName as string), c.credentialName as string, 'credential', 'payments[].connectors.credentialName');
      }
    }
  }
  for (const h of listOf(b, doc, 'harnesses')) {
    const name = h.name as string;
    const hc = input.harnesses[name];
    const id = b.add('harness', name, isObj(hc) && !('__error' in hc) ? { ...hc, path: h.path } : { path: h.path }, {
      sourcePath: str(h.path), envVarNames: isObj(hc) && isObj(hc.env) ? Object.keys(hc.env) : [],
    });
    if (isObj(hc) && typeof hc.__error === 'string') b.warn('harnesses', `Harness '${name}' could not be loaded: ${hc.__error}`, id);
    else if (hc === undefined) b.warn('harnesses', `Harness '${name}' has no harness.json loaded`, id);
  }

  // ---- pass 2: declared edges ----
  for (const gw of listOf(b, doc, 'agentCoreGateways')) {
    const gid = nodeId('gateway', gw.name as string);
    const pe = str(dig(gw, 'policyEngineConfiguration', 'policyEngineName'));
    if (pe) b.ref(gid, nodeId('policyEngine', pe), pe, 'policy engine', 'agentCoreGateways[].policyEngineConfiguration');
    linkTargets(b, gw.name as string, gw.targets);
  }
  linkTargets(b, null, doc.unassignedTargets);
  for (const kb of listOf(b, doc, 'knowledgeBases')) {
    if (str(kb.gateway)) b.ref(nodeId('knowledgeBase', kb.name as string), nodeId('gateway', kb.gateway as string), kb.gateway as string, 'gateway', 'knowledgeBases[].gateway');
  }
  for (const rt of listOf(b, doc, 'runtimes')) {
    const cp = str(dig(rt, 'capacityProviderConfiguration', 'capacityProviderName'));
    if (cp) b.ref(nodeId('runtime', rt.name as string), nodeId('capacityProvider', cp), cp, 'capacity provider', 'runtimes[].capacityProviderConfiguration');
  }
  for (const oe of listOf(b, doc, 'onlineEvalConfigs')) {
    const id = nodeId('onlineEval', oe.name as string);
    if (str(oe.agent)) b.ref(id, nodeId('runtime', oe.agent as string), oe.agent as string, str(oe.endpoint) ? `agent (${oe.endpoint})` : 'agent', 'onlineEvalConfigs[].agent');
    for (const ev of Array.isArray(oe.evaluators) ? oe.evaluators : []) {
      if (typeof ev === 'string') b.ref(id, nodeId('evaluator', ev), ev, 'evaluator', 'onlineEvalConfigs[].evaluators');
    }
  }
  for (const t of listOf(b, doc, 'mcpRuntimeTools')) {
    const id = nodeId('mcpRuntimeTool', t.name as string);
    for (const bind of Array.isArray(t.bindings) ? t.bindings : []) {
      if (isObj(bind) && str(bind.runtimeName)) b.ref(id, nodeId('runtime', bind.runtimeName as string), bind.runtimeName as string, 'binding', 'mcpRuntimeTools[].bindings');
    }
  }
  for (const ab of listOf(b, doc, 'abTests')) {
    const id = nodeId('abTest', ab.name as string);
    if (str(ab.gatewayRef)) b.ref(id, nodeId('gateway', ab.gatewayRef as string), ab.gatewayRef as string, 'gateway', 'abTests[].gatewayRef');
    for (const v of Array.isArray(ab.variants) ? ab.variants : []) {
      const tn = str(dig(v, 'variantConfiguration', 'target', 'targetName'));
      if (!tn) continue;
      const matches = [...b.nodes.values()].filter((n) => n.type === 'gatewayTarget' && n.name === tn);
      if (matches.length === 0) b.warn('abTests', `abTests[].variants references target '${tn}' which is not defined`, id);
      for (const m of matches) b.link(id, m.id, matches.length === 1 ? 'declared' : 'inferred', 'variant target', 'abTests[].variants');
    }
  }
  for (const h of listOf(b, doc, 'harnesses')) {
    const hc = input.harnesses[h.name as string];
    if (isObj(hc) && isObj(hc.memory) && str(hc.memory.name) && hc.memory.mode !== 'disabled') {
      b.ref(nodeId('harness', h.name as string), nodeId('memory', hc.memory.name as string), hc.memory.name as string, 'memory', 'harness.json memory.name');
    }
  }

  inferEdges(b, doc, input.harnesses);
  return finish(str(doc.name) ?? '(unnamed)');
}

function matchByArn(b: Builder, type: NodeType, arn: string): string | null {
  const seg = arn.split(/[/:]/).filter(Boolean).pop() ?? '';
  let best: GraphNode | undefined;
  for (const n of b.nodes.values()) {
    if (n.type !== type) continue;
    if (seg === n.name || seg.startsWith(n.name + '-')) {
      if (!best || n.name.length > best.name.length) best = n;
    }
  }
  return best?.id ?? null;
}

function externalNode(b: Builder, kind: string, arn: string | undefined): string {
  const key = arn ?? kind;
  const id = `external:${key}`;
  if (!b.has(id)) b.add('external', arn ? `${kind} (external)` : kind, { type: kind, arn }, { id });
  return id;
}

const CONNECTION_TYPES: Record<string, NodeType> = { memory: 'memory', gateway: 'gateway', runtime: 'runtime' };

export function inferEdges(b: Builder, doc: Rec, harnesses: Record<string, unknown>): void {
  const runtimes = Array.isArray(doc.runtimes) ? doc.runtimes : [];
  for (const rt of runtimes) {
    if (!isObj(rt) || !str(rt.name)) continue;
    const from = nodeId('runtime', rt.name as string);
    for (const c of Array.isArray(rt.connections) ? rt.connections : []) {
      if (!isObj(c) || !isObj(c.to) || !str(c.to.type)) continue;
      const kind = c.to.type as string;
      const arn = str(c.to.arn);
      const label = str(c.id) ?? kind;
      const nodeType = CONNECTION_TYPES[kind];
      const matched = nodeType && arn ? matchByArn(b, nodeType, arn) : null;
      if (matched) b.link(from, matched, 'inferred', label, 'runtimes[].connections (ARN matched to project resource)');
      else b.link(from, externalNode(b, kind, arn), 'declared', label, 'runtimes[].connections');
    }
    // naming convention: <runtime>Memory
    const memId = nodeId('memory', `${rt.name}Memory`);
    const alreadyLinked = [...b.edges.values()].some((e) => e.from === from && e.to === memId);
    if (b.has(memId) && !alreadyLinked) b.link(from, memId, 'inferred', 'memory (by name)', 'naming convention <runtime>Memory');
  }

  for (const [name, hc] of Object.entries(harnesses)) {
    if (!isObj(hc)) continue;
    const from = nodeId('harness', name);
    for (const t of Array.isArray(hc.tools) ? hc.tools : []) {
      if (isObj(t) && t.type === 'agentcore_gateway' && str(t.gatewayArn)) {
        const m = matchByArn(b, 'gateway', t.gatewayArn as string);
        if (m) b.link(from, m, 'inferred', 'gateway tool', 'harness.json tools[].gatewayArn (ARN matched)');
      }
    }
  }

  // connector targets that mention a project KB by name
  const kbNames = new Set([...b.nodes.values()].filter((n) => n.type === 'knowledgeBase').map((n) => n.name));
  for (const n of b.nodes.values()) {
    if (n.type !== 'gatewayTarget' || n.config.connectorId !== 'bedrock-knowledge-bases') continue;
    const cfgs = Array.isArray(n.config.configurations) ? n.config.configurations : [];
    for (const c of cfgs) {
      const pv = isObj(c) && isObj(c.parameterValues) ? c.parameterValues : {};
      for (const v of Object.values(pv)) {
        if (typeof v === 'string' && kbNames.has(v)) b.link(n.id, nodeId('knowledgeBase', v), 'inferred', 'knowledge base', 'connector configurations[].parameterValues');
      }
    }
  }
}
