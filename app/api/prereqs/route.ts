import { detectPrereqs } from '@/lib/server/project';
import { handle, json } from '@/lib/server/http';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = () => handle(async () => json(await detectPrereqs()));
