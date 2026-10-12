import { NextResponse, type NextRequest } from 'next/server';
import { checkRequest } from '@/lib/security/guard';

export function middleware(req: NextRequest) {
  const result = checkRequest({
    host: req.headers.get('host'),
    origin: req.headers.get('origin'),
    method: req.method,
  });
  if (!result.ok) return new NextResponse(`Forbidden: ${result.reason}`, { status: 403 });
  return NextResponse.next();
}

export const config = { matcher: '/((?!_next/static|_next/image|favicon.ico).*)' };
