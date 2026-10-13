import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export interface RecentProject { path: string; name: string; lastOpened: string }
const defaultDir = () => process.env.AGENTCORE_GUI_HOME ?? path.join(os.homedir(), '.agentcore-gui');

export async function listRecent(dir = defaultDir()): Promise<RecentProject[]> {
  try {
    const data = JSON.parse(await fs.readFile(path.join(dir, 'recent.json'), 'utf8'));
    if (!Array.isArray(data)) return [];
    return data
      .filter((r) => typeof r?.path === 'string' && typeof r?.name === 'string')
      .map((r) => ({ path: r.path, name: r.name, lastOpened: String(r.lastOpened ?? '') }));
  } catch { return []; }
}

export async function addRecent(entry: { path: string; name: string }, dir = defaultDir()): Promise<void> {
  const cur = (await listRecent(dir)).filter((r) => r.path !== entry.path);
  const next = [{ path: entry.path, name: entry.name, lastOpened: new Date().toISOString() }, ...cur].slice(0, 10);
  await fs.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `recent.json.${process.pid}.tmp`);
  await fs.writeFile(tmp, JSON.stringify(next, null, 2));
  await fs.rename(tmp, path.join(dir, 'recent.json'));
}
