import { findProfile, getIdentity } from '@/lib/aws/identity';
import { handle, json, readJson } from '@/lib/server/http';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const POST = (req: Request) => handle(async () => {
  const b = await readJson(req);
  const name = String(b.profile ?? '');
  const prof = await findProfile(name);
  return json(await getIdentity(name, prof?.region));
});
