import { getRun } from '@/lib/exec/run';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const run = getRun(id);
  if (!run) return new Response('Not found', { status: 404 });
  const enc = new TextEncoder();
  let off = () => {};
  const stream = new ReadableStream({
    start(c) {
      off = run.subscribe((e) => {
        try {
          c.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
          if (e.type === 'exit') c.close();
        } catch { /* stream already closed */ }
      });
    },
    cancel() { off(); },
  });
  req.signal.addEventListener('abort', () => off());
  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' },
  });
}
