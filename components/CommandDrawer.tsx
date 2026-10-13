'use client';
import { useEffect, useMemo, useRef } from 'react';
import { extractDeviceInfo } from '@/lib/aws/device';
import { useRunStream } from './useRunStream';

interface Props { run: { id: string; title: string } | null; onClose: () => void; onExit: (code: number | null) => void }

export default function CommandDrawer({ run, onClose, onExit }: Props) {
  const { lines, exited, exitCode } = useRunStream(run?.id ?? null, onExit);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [lines]);
  const device = useMemo(() => extractDeviceInfo(lines.map((l) => l.text).join('\n')), [lines]);
  if (!run) return null;

  async function cancel() { await fetch(`/api/run/${run!.id}`, { method: 'DELETE' }); }

  return (
    <section className="flex h-64 flex-col border-t border-slate-700 bg-slate-950" aria-label="Command output">
      <header className="flex items-center gap-3 border-b border-slate-800 px-3 py-1 text-sm">
        <span className="truncate font-mono text-slate-300">{run.title}</span>
        <span className={`rounded px-1.5 text-xs ${!exited ? 'bg-blue-500/20 text-blue-300' : exitCode === 0 ? 'bg-emerald-500/20 text-emerald-300' : 'bg-red-500/20 text-red-300'}`}>
          {!exited ? 'running' : exitCode === 0 ? 'succeeded' : 'failed'}
        </span>
        <span className="ml-auto flex gap-2">
          {!exited && <button className="rounded border border-red-600 px-2 text-red-300 hover:bg-red-900/30" onClick={cancel}>Stop</button>}
          <button className="rounded border border-slate-600 px-2 hover:bg-slate-800" onClick={onClose}>Close</button>
        </span>
      </header>
      {(device.url || device.code) && !exited && (
        <div className="border-b border-amber-700/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-100" data-testid="device-info">
          Complete sign-in{device.url && <> at <a className="underline" href={device.url} target="_blank" rel="noreferrer noopener">{device.url}</a></>}
          {device.code && <> and enter code <b className="font-mono text-base tracking-widest">{device.code}</b></>}
        </div>
      )}
      <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap px-3 py-2 font-mono text-xs">
        {lines.map((l, i) => (
          <span key={i} className={l.stream === 'stderr' ? 'text-red-300' : l.stream === 'system' ? 'text-slate-500' : 'text-slate-200'}>{l.text.endsWith('\n') ? l.text : l.text + '\n'}</span>
        ))}
        <div ref={endRef} />
      </pre>
    </section>
  );
}
