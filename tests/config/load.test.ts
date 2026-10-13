import { describe, expect, it } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { loadProject } from '@/lib/config/load';
import { resolveProjectRoot } from '@/lib/fs/safe-read';

const fx = path.join(__dirname, '../../fixtures/demo-project');

describe('loadProject', () => {
  it('loads the fixture including its harness', async () => {
    const g = await loadProject(await resolveProjectRoot(fx));
    expect(g.projectName).toBe('demo');
    expect(g.nodes.some((n) => n.id === 'harness:support_h')).toBe(true);
    expect(g.edges.some((e) => e.from === 'harness:support_h' && e.to === 'memory:ordersMemory')).toBe(true);
  });
  it('turns invalid JSON into a warning, not a throw', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'acgui-bad-'));
    await fs.mkdir(path.join(dir, 'agentcore'));
    await fs.writeFile(path.join(dir, 'agentcore', 'agentcore.json'), '{ not json');
    const g = await loadProject(await resolveProjectRoot(dir));
    expect(g.nodes).toEqual([]);
    expect(g.warnings.some((w) => /agentcore\.json/.test(w.scope))).toBe(true);
    await fs.rm(dir, { recursive: true, force: true });
  });
  it('does not leak the content of a non-JSON agentcore.json into warnings', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'acgui-leak-'));
    await fs.mkdir(path.join(dir, 'agentcore'));
    await fs.writeFile(path.join(dir, 'agentcore', 'agentcore.json'), 'OPENAI_KEY=sk-abc123');
    const g = await loadProject(await resolveProjectRoot(dir));
    expect(JSON.stringify(g.warnings)).not.toContain('sk-abc123');
    expect(g.warnings.some((w) => /not valid JSON/i.test(w.message))).toBe(true);
    await fs.rm(dir, { recursive: true, force: true });
  });
  it('does not leak the content of a non-JSON harness.json into warnings', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'acgui-leak2-'));
    await fs.mkdir(path.join(dir, 'agentcore'));
    await fs.mkdir(path.join(dir, 'app', 'h'), { recursive: true });
    await fs.writeFile(path.join(dir, 'agentcore', 'agentcore.json'), JSON.stringify({ name: 'x', harnesses: [{ name: 'h', path: 'app/h' }] }));
    await fs.writeFile(path.join(dir, 'app', 'h', 'harness.json'), 'SECRET_TOKEN=sk-zzz999');
    const g = await loadProject(await resolveProjectRoot(dir));
    expect(JSON.stringify(g)).not.toContain('sk-zzz999');
    await fs.rm(dir, { recursive: true, force: true });
  });
  it('does not follow a harness path that escapes the project', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'acgui-esc-'));
    await fs.mkdir(path.join(dir, 'agentcore'));
    await fs.writeFile(path.join(dir, 'agentcore', 'agentcore.json'),
      JSON.stringify({ name: 'x', harnesses: [{ name: 'h', path: '../../etc' }] }));
    const g = await loadProject(await resolveProjectRoot(dir));
    expect(g.warnings.some((w) => /h/.test(w.message) && /escape|outside/i.test(w.message))).toBe(true);
    await fs.rm(dir, { recursive: true, force: true });
  });
});
