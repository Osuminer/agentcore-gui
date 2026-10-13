import { listRecent } from '@/lib/store/recent';
import { handle, json } from '@/lib/server/http';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = () => handle(async () => json({ recent: await listRecent() }));
