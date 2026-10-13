import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { addRecent, listRecent } from '@/lib/store/recent';

let dir: string;
beforeAll(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'acgui-recent-')); });
afterAll(async () => { await fs.rm(dir, { recursive: true, force: true }); });

describe('recent projects', () => {
  it('starts empty', async () => { expect(await listRecent(dir)).toEqual([]); });
  it('adds newest first and dedupes by path', async () => {
    await addRecent({ path: '/a', name: 'a' }, dir);
    await addRecent({ path: '/b', name: 'b' }, dir);
    await addRecent({ path: '/a', name: 'a' }, dir);
    expect((await listRecent(dir)).map((r) => r.path)).toEqual(['/a', '/b']);
  });
  it('caps at 10', async () => {
    for (let i = 0; i < 15; i++) await addRecent({ path: `/p${i}`, name: `p${i}` }, dir);
    expect(await listRecent(dir)).toHaveLength(10);
  });
  it('recovers from a corrupt file', async () => {
    await fs.writeFile(path.join(dir, 'recent.json'), '{{{');
    expect(await listRecent(dir)).toEqual([]);
  });
  it('stores only path, name and timestamp', async () => {
    await addRecent({ path: '/x', name: 'x' }, dir);
    const raw = JSON.parse(await fs.readFile(path.join(dir, 'recent.json'), 'utf8'));
    expect(Object.keys(raw[0]).sort()).toEqual(['lastOpened', 'name', 'path']);
  });
});
