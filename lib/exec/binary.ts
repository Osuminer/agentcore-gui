import fs from 'node:fs';
import path from 'node:path';

/** npm's Windows .cmd shims end with: "%_prog%"  "%dp0%\node_modules\...\cli.mjs" %* */
export function parseNpmCmdShim(text: string, dir: string): string | null {
  const m = text.match(/"%dp0%\\([^"]+?\.(?:m?js|cjs))"/i) ?? text.match(/"%~dp0\\([^"]+?\.(?:m?js|cjs))"/i);
  return m ? path.join(dir, m[1]) : null;
}

export function resolveBinary(name: string, env: NodeJS.ProcessEnv = process.env): { file: string; prefixArgs: string[] } {
  if (process.platform !== 'win32') return { file: name, prefixArgs: [] };
  // Node >= 18.20 refuses to spawn .cmd/.bat without a shell (EINVAL), so unwrap npm shims.
  const dirs = (env.PATH ?? env.Path ?? '').split(';').filter(Boolean);
  for (const dir of dirs) {
    const exe = path.join(dir, `${name}.exe`);
    if (fs.existsSync(exe)) return { file: exe, prefixArgs: [] };
    const cmd = path.join(dir, `${name}.cmd`);
    if (fs.existsSync(cmd)) {
      const script = parseNpmCmdShim(fs.readFileSync(cmd, 'utf8'), dir);
      if (script && fs.existsSync(script)) return { file: process.execPath, prefixArgs: [script] };
    }
  }
  throw Object.assign(new Error(`'${name}' was not found on PATH`), { code: 'ENOENT' });
}
