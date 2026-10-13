'use client';
import type { Graph, GraphNode } from '@/lib/config/types';
import { commandsForNode, COMMANDS, type CommandId } from '@/lib/cli/catalog';
import { STATUS_STYLE, TYPE_STYLE } from './theme';
import { MASK } from '@/lib/config/sanitize';

interface Props {
  graph: Graph; node: GraphNode;
  onSelect: (id: string) => void;
  onRun: (a: { commandId: CommandId; params: Record<string, string> }) => void;
  onClose: () => void;
}

/** vscode://file/<abs path>; POSIX absolute paths already start with "/" so no extra slash is added. */
export function vscodeHref(root: string, rel: string): string {
  const abs = (root + '/' + rel).replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '');
  return abs.startsWith('/') ? `vscode://file${encodeURI(abs)}` : `vscode://file/${encodeURI(abs)}`;
}

export default function NodePanel({ graph, node, onSelect, onRun, onClose }: Props) {
  const out = graph.edges.filter((e) => e.from === node.id);
  const inn = graph.edges.filter((e) => e.to === node.id);
  const name = (id: string) => graph.nodes.find((n) => n.id === id)?.name ?? id;
  const t = TYPE_STYLE[node.type];
  const s = STATUS_STYLE[node.status];
  const cmds = commandsForNode(node);

  const row = (key: string, other: string, label: string, kind: string, dir: '→' | '←') => (
    <li key={key} className="flex items-center gap-2">
      <span className="text-slate-500">{dir}</span>
      <button className="truncate text-blue-300 hover:underline" onClick={() => onSelect(other)}>{name(other)}</button>
      <span className="text-xs text-slate-500">{label}</span>
      <span className={`rounded px-1 text-[10px] ${kind === 'inferred' ? 'bg-amber-500/20 text-amber-300' : 'bg-slate-700 text-slate-300'}`}>{kind}</span>
    </li>
  );

  return (
    <aside className="flex w-[26rem] shrink-0 flex-col overflow-y-auto border-l border-slate-700 bg-slate-900 p-4 text-sm" aria-label="Resource details">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-xs uppercase" style={{ color: t.color }}>{t.label}</div>
          <h2 className="break-all text-lg font-semibold">{node.name}</h2>
          <span className={`mt-1 inline-block rounded border px-1.5 py-0.5 text-xs ${s.className}`}>{s.label}{node.statusDetail ? ` · ${node.statusDetail}` : ''}</span>
        </div>
        <button className="rounded border border-slate-600 px-2 hover:bg-slate-800" onClick={onClose} aria-label="Close panel">✕</button>
      </div>

      {node.warnings.length > 0 && (
        <ul className="mt-3 list-disc rounded border border-amber-700/40 bg-amber-500/10 p-2 pl-6 text-xs text-amber-200">{node.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
      )}

      {node.sourcePath && (
        <p className="mt-3 text-xs">Source: <code>{node.sourcePath}</code>{' '}
          <a className="text-blue-300 underline" href={vscodeHref(graph.root, node.sourcePath)}>Open in VS Code</a></p>
      )}

      <h3 className="mt-4 font-semibold">Connections</h3>
      {out.length + inn.length === 0 && <p className="text-slate-500">None</p>}
      <ul className="mt-1 space-y-1">
        {out.map((e) => row(e.id, e.to, e.label, e.kind, '→'))}
        {inn.map((e) => row(e.id, e.from, e.label, e.kind, '←'))}
      </ul>

      {node.envVarNames.length > 0 && (
        <>
          <h3 className="mt-4 font-semibold">Environment variables</h3>
          <ul className="mt-1 font-mono text-xs">{node.envVarNames.map((n) => <li key={n}>{n} = {MASK}</li>)}</ul>
        </>
      )}

      <h3 className="mt-4 font-semibold">Commands</h3>
      <div className="mt-1 flex flex-wrap gap-2">
        {cmds.map((c) => (
          <button key={c.id} className="rounded border border-slate-600 px-2 py-1 hover:bg-slate-800" title={COMMANDS[c.id].description} onClick={() => onRun({ commandId: c.id, params: c.params })}>
            {COMMANDS[c.id].label}
          </button>
        ))}
      </div>

      <h3 className="mt-4 font-semibold">Configuration</h3>
      <pre className="mt-1 max-h-96 overflow-auto rounded bg-black/40 p-2 text-xs">{JSON.stringify(node.config, null, 2)}</pre>
    </aside>
  );
}
