import { buildProjectGraph } from '@/lib/server/project';
import { addRecent } from '@/lib/store/recent';
import { handle, json, readJson } from '@/lib/server/http';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const POST = (req: Request) => handle(async () => {
  const b = await readJson(req);
  const r = await buildProjectGraph(String(b.path ?? ''), typeof b.profile === 'string' && b.profile ? b.profile : undefined);
  await addRecent({ path: r.graph.root, name: r.graph.projectName });
  return json({ root: r.graph.root, ...r });
});
