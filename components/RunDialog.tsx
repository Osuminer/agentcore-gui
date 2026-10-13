'use client';
import { useEffect, useState } from 'react';
import type { FieldDef } from '@/lib/cli/catalog';
import type { IdentityResult } from '@/lib/aws/identity';
import { ApiError, postJson } from '@/lib/ui/api';

interface Preview {
  display: string; label: string; description: string; touchesAws: boolean; longRunning: boolean;
  fields: FieldDef[]; identity?: IdentityResult; problem?: string;
}
interface Props {
  action: { commandId: string; params: Record<string, string> } | null;
  projectPath: string; profile: string;
  onCancel: () => void;
  onStarted: (runId: string, title: string) => void;
  onSwitch?: (commandId: string, params: Record<string, string>) => void;
}

export default function RunDialog({ action, projectPath, profile, onCancel, onStarted, onSwitch }: Props) {
  const [params, setParams] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<Preview | null>(null);
  const [typed, setTyped] = useState('');
  const [need, setNeed] = useState<{ resources: string[]; projectName: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setParams(action?.params ?? {}); setPreview(null); setNeed(null); setTyped(''); setErr(null); setAck(false);
  }, [action]);

  useEffect(() => {
    if (!action) return;
    let live = true;
    postJson<Preview>('/api/run/preview', { commandId: action.commandId, params, projectPath: projectPath || undefined, profile: profile || undefined })
      .then((p) => live && setPreview(p)).catch((e) => live && setErr(e.message));
    return () => { live = false; };
  }, [action, params, projectPath, profile]);

  if (!action) return null;
  const ident = preview?.identity;
  const identOk = ident?.ok ? ident : null;
  const isDeploy = action.commandId === 'deploy';
  const region = identOk?.region;
  const blocked = (preview?.touchesAws && !profile) || (preview?.touchesAws && ident && !ident.ok) || !!preview?.problem
    || (isDeploy && !ack) || (!!need && typed !== need.projectName);

  async function run() {
    setBusy(true); setErr(null);
    try {
      const r = await postJson<{ runId: string; display: string }>('/api/run', {
        commandId: action!.commandId, params, projectPath: projectPath || undefined, profile: profile || undefined,
        confirm: isDeploy && identOk ? { account: identOk.account, region, typedName: need ? typed : undefined } : undefined,
      });
      onStarted(r.runId, r.display);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        const b = e.body as { resources: string[]; projectName: string };
        setNeed({ resources: b.resources, projectName: b.projectName });
      } else setErr((e as Error).message);
    } finally { setBusy(false); }
  }

  const set = (k: string, v: string) => setParams({ ...params, [k]: v });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label={preview?.label ?? 'Run command'}>
      <div className="w-full max-w-xl rounded-lg border border-slate-600 bg-slate-900 p-4 shadow-xl">
        <h2 className="text-lg font-semibold">{preview?.label ?? 'Run command'}</h2>
        {preview && <p className="text-sm text-slate-400">{preview.description}</p>}

        {preview?.fields.map((f) => (
          <label key={f.key} className="mt-3 block text-sm">
            <span className="text-slate-300">{f.label}{f.required && ' *'}</span>
            {f.kind === 'enum' ? (
              <select className="mt-1 w-full rounded border border-slate-600 bg-slate-800 px-2 py-1" value={params[f.key] ?? ''} onChange={(e) => set(f.key, e.target.value)}>
                <option value="">—</option>{f.options!.map((o) => <option key={o}>{o}</option>)}
              </select>
            ) : f.key === 'prompt' ? (
              <textarea className="mt-1 w-full rounded border border-slate-600 bg-slate-800 px-2 py-1" rows={3} value={params[f.key] ?? ''} onChange={(e) => set(f.key, e.target.value)} />
            ) : (
              <input className="mt-1 w-full rounded border border-slate-600 bg-slate-800 px-2 py-1 font-mono" value={params[f.key] ?? ''} onChange={(e) => set(f.key, e.target.value)} />
            )}
          </label>
        ))}

        <div className="mt-3 text-xs text-slate-400">Exact command</div>
        <pre className="mt-1 overflow-x-auto rounded bg-black/50 p-2 font-mono text-xs text-emerald-300" data-testid="exact-command">{preview?.display ?? '…'}</pre>
        {preview?.problem && <p className="mt-1 text-xs text-amber-300">{preview.problem}</p>}

        {preview?.touchesAws && (
          <div className="mt-3 rounded border border-slate-700 p-2 text-sm">
            {!profile && <span className="text-amber-300">Select an AWS profile first.</span>}
            {ident && !ident.ok && <span className="text-amber-300">{ident.message} Log in from the top bar, then retry.</span>}
            {identOk && <span>Will run against account <b>{identOk.account}</b>, region <b>{region ?? 'unknown'}</b>, as <b>{identOk.role ?? identOk.arn}</b>.</span>}
          </div>
        )}
        {isDeploy && (
          <label className="mt-3 flex items-start gap-2 text-sm">
            <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-1" />
            <span>I confirm deploying to account <b>{identOk?.account ?? '?'}</b> in <b>{region ?? '?'}</b>.</span>
          </label>
        )}
        {need && (
          <div className="mt-3 rounded border border-red-600/60 bg-red-500/10 p-2 text-sm">
            <p className="text-red-300">This deploy will remove: <b>{need.resources.join(', ')}</b>.</p>
            <p className="mt-1">Type <b className="font-mono">{need.projectName}</b> to confirm.</p>
            <input className="mt-1 w-full rounded border border-red-700 bg-slate-800 px-2 py-1 font-mono" value={typed} onChange={(e) => setTyped(e.target.value)} />
          </div>
        )}
        {err && <p className="mt-2 text-sm text-red-400" role="alert">{err}</p>}

        <div className="mt-4 flex justify-end gap-2">
          <button className="rounded border border-slate-600 px-3 py-1 hover:bg-slate-800" onClick={onCancel}>Cancel</button>
          {action.commandId === 'createDryRun' && onSwitch && (
            <button className="rounded border border-blue-500 px-3 py-1 text-blue-300 hover:bg-blue-900/30" onClick={() => onSwitch('create', params)}>Continue to real create…</button>
          )}
          <button className="rounded bg-blue-600 px-3 py-1 font-medium hover:bg-blue-500 disabled:opacity-40" disabled={blocked || busy || !preview} onClick={run}>{busy ? 'Starting…' : 'Run'}</button>
        </div>
      </div>
    </div>
  );
}
