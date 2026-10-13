import { readProfiles } from '@/lib/aws/config';
import { handle, json } from '@/lib/server/http';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = () => handle(async () => json({ profiles: await readProfiles() }));
