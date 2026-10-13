import { buildProjectGraph } from '@/lib/server/project';
import { handle, json, readJson } from '@/lib/server/http';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const POST = (req: Request) => handle(async () => {
  const b = await readJson(req);
  return json(await buildProjectGraph(String(b.path ?? ''), typeof b.profile === 'string' && b.profile ? b.profile : undefined));
});
