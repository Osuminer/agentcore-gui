import { getRun } from '@/lib/exec/run';
import { json } from '@/lib/server/http';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const run = getRun(id);
  if (!run) return json({ error: 'Not found' }, 404);
  run.cancel();
  return json({ ok: true });
}
