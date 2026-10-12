import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PathEscapeError, resolveProjectRoot, safeReadText } from '@/lib/fs/safe-read';

let base: string;
let project: string;
let outside: string;
let linkWorks = true;

beforeAll(async () => {
  base = await fs.mkdtemp(path.join(os.tmpdir(), 'acgui-'));
  project = path.join(base, 'proj');
  outside = path.join(base, 'outside');
  await fs.mkdir(path.join(project, 'agentcore'), { recursive: true });
  await fs.mkdir(outside, { recursive: true });
  await fs.writeFile(path.join(project, 'agentcore', 'agentcore.json'), '{"name":"p"}');
  await fs.writeFile(path.join(project, 'agentcore', '.env.local'), 'SECRET=1');
  await fs.writeFile(path.join(outside, 'secret.txt'), 'top secret');
  try {
    await fs.symlink(outside, path.join(project, 'link'), 'junction');
  } catch {
    linkWorks = false;
  }
});
afterAll(async () => { await fs.rm(base, { recursive: true, force: true }); });

describe('resolveProjectRoot', () => {
  it('accepts a project directory', async () => {
    expect(await resolveProjectRoot(project)).toBe(await fs.realpath(project));
  });
  it('rejects a directory without agentcore/agentcore.json', async () => {
    await expect(resolveProjectRoot(outside)).rejects.toThrow(/Not an AgentCore project/);
  });
  it('rejects a missing path', async () => {
    await expect(resolveProjectRoot(path.join(base, 'nope'))).rejects.toThrow();
  });
});

describe('safeReadText', () => {
  it('reads a file inside the project', async () => {
    const root = await resolveProjectRoot(project);
    expect(await safeReadText(root, 'agentcore/agentcore.json')).toBe('{"name":"p"}');
  });
  it('rejects ../ traversal', async () => {
    const root = await resolveProjectRoot(project);
    await expect(safeReadText(root, '../outside/secret.txt')).rejects.toBeInstanceOf(PathEscapeError);
  });
  it('rejects nested traversal that normalises outside', async () => {
    const root = await resolveProjectRoot(project);
    await expect(safeReadText(root, 'agentcore/../../outside/secret.txt')).rejects.toBeInstanceOf(PathEscapeError);
  });
  it('rejects absolute paths', async () => {
    const root = await resolveProjectRoot(project);
    await expect(safeReadText(root, path.join(outside, 'secret.txt'))).rejects.toBeInstanceOf(PathEscapeError);
  });
  it('rejects a symlink/junction that points outside', async () => {
    if (!linkWorks) return;
    const root = await resolveProjectRoot(project);
    await expect(safeReadText(root, 'link/secret.txt')).rejects.toBeInstanceOf(PathEscapeError);
  });
  it('never reads .env files', async () => {
    const root = await resolveProjectRoot(project);
    await expect(safeReadText(root, 'agentcore/.env.local')).rejects.toBeInstanceOf(PathEscapeError);
  });
  it('enforces a size cap', async () => {
    const root = await resolveProjectRoot(project);
    await expect(safeReadText(root, 'agentcore/agentcore.json', { maxBytes: 3 })).rejects.toThrow(/too large/i);
  });
});
