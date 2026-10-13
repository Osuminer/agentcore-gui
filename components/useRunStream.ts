'use client';
import { useEffect, useRef, useState } from 'react';
import type { RunEvent } from '@/lib/exec/run';

export interface Line { stream: 'stdout' | 'stderr' | 'system'; text: string }

export function useRunStream(runId: string | null, onExit?: (code: number | null) => void) {
  const [lines, setLines] = useState<Line[]>([]);
  const [exited, setExited] = useState(false);
  const [exitCode, setExitCode] = useState<number | null>(null);
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;

  useEffect(() => {
    setLines([]); setExited(false); setExitCode(null);
    if (!runId) return;
    const es = new EventSource(`/api/run/${runId}/events`);
    let finished = false;
    es.onmessage = (m) => {
      const e = JSON.parse(m.data) as RunEvent;
      if (e.type === 'start') setLines((l) => [...l, { stream: 'system', text: `$ ${e.command}` }]);
      else if (e.type === 'stdout' || e.type === 'stderr') setLines((l) => [...l, { stream: e.type as 'stdout' | 'stderr', text: e.data }]);
      else if (e.type === 'error') setLines((l) => [...l, { stream: 'stderr', text: `error: ${e.message}` }]);
      else if (e.type === 'exit') {
        finished = true;
        setExited(true); setExitCode(e.code);
        setLines((l) => [...l, { stream: 'system', text: `[exited with code ${e.code ?? 'none'}${e.signal ? `, signal ${e.signal}` : ''}]` }]);
        es.close();
        onExitRef.current?.(e.code);
      }
    };
    es.onerror = () => {
      es.close();
      if (!finished) {
        setLines((l) => [...l, { stream: 'system', text: '[connection to the run stream was lost]' }]);
        setExited(true);
      }
    };
    return () => es.close();
  }, [runId]);

  return { lines, exited, exitCode };
}
