import fs from 'node:fs/promises';
import path from 'node:path';

export class PathEscapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PathEscapeError';
  }
}

const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;

function isInside(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  if (rel === '') return true;
  return rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel);
}

export async function resolveProjectRoot(p: string): Promise<string> {
  if (typeof p !== 'string' || p.length === 0 || p.includes('\0')) throw new Error('Invalid project path');
  const real = await fs.realpath(path.resolve(p));
  const st = await fs.stat(real);
  if (!st.isDirectory()) throw new Error(`Not a directory: ${p}`);
  try {
    await fs.access(path.join(real, 'agentcore', 'agentcore.json'));
  } catch {
    throw new Error(`Not an AgentCore project: ${p} (missing agentcore/agentcore.json)`);
  }
  return real;
}

export async function safeReadText(root: string, rel: string, opts: { maxBytes?: number } = {}): Promise<string> {
  if (rel.includes('\0')) throw new PathEscapeError('Invalid path');
  if (path.isAbsolute(rel)) throw new PathEscapeError('Absolute paths are not allowed');
  const resolved = path.resolve(root, rel);
  if (!isInside(root, resolved)) throw new PathEscapeError(`Path escapes project: ${rel}`);
  if (/^\.env/i.test(path.basename(resolved))) throw new PathEscapeError('Environment files are never read');
  const real = await fs.realpath(resolved);
  if (!isInside(root, real)) throw new PathEscapeError(`Path resolves outside project: ${rel}`);
  if (/^\.env/i.test(path.basename(real))) throw new PathEscapeError('Environment files are never read');
  const st = await fs.stat(real);
  const max = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  if (st.size > max) throw new Error(`File too large (${st.size} bytes, max ${max}): ${rel}`);
  return fs.readFile(real, 'utf8');
}
