import { safeReadText } from '@/lib/fs/safe-read';
import { parseAgentCore } from './parser';
import type { Graph } from './types';

export async function loadProject(root: string): Promise<Graph> {
  let agentcore: unknown;
  try {
    agentcore = JSON.parse(await safeReadText(root, 'agentcore/agentcore.json'));
  } catch (e) {
    return {
      projectName: '(unreadable)', root, nodes: [], edges: [],
      warnings: [{ scope: 'agentcore.json', message: `Could not read or parse agentcore/agentcore.json: ${(e as Error).message}` }],
    };
  }
  const harnesses: Record<string, unknown> = {};
  const list = (agentcore as { harnesses?: unknown })?.harnesses;
  if (Array.isArray(list)) {
    for (const h of list) {
      const name = (h as { name?: unknown })?.name;
      const p = (h as { path?: unknown })?.path;
      if (typeof name !== 'string') continue;
      if (typeof p !== 'string') { harnesses[name] = { __error: 'harness has no path' }; continue; }
      try {
        harnesses[name] = JSON.parse(await safeReadText(root, `${p.replace(/\/+$/, '')}/harness.json`));
      } catch (e) {
        harnesses[name] = { __error: (e as Error).message };
      }
    }
  }
  return parseAgentCore({ root, agentcore, harnesses });
}
