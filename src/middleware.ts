// Basic-auth gate on the entire app, controlled by BASIC_AUTH_PASSWORD env.
// If unset, the app is OPEN — only safe on localhost.
// On Fly.io / any public deploy, ALWAYS set BASIC_AUTH_PASSWORD.

import { NextRequest, NextResponse } from 'next/server';

export const config = {
  // Protect everything except Next internals / static assets.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};

export function middleware(req: NextRequest) {
  const password = process.env.BASIC_AUTH_PASSWORD;
  if (!password) return NextResponse.next(); // no auth configured (dev mode)

  // Allow the cron poll endpoint to use its own POLL_SECRET instead.
  if (req.nextUrl.pathname === '/api/poll') return NextResponse.next();

  const auth = req.headers.get('authorization') ?? '';
  if (!auth.startsWith('Basic ')) {
    return new NextResponse('Authentication required', {
      status: 401,
      headers: { 'WWW-Authenticate': 'Basic realm="Doggy Sniper"' },
    });
  }

  const decoded = atob(auth.slice('Basic '.length));
  const sep = decoded.indexOf(':');
  if (sep < 0) {
    return new NextResponse('Bad credentials', { status: 401 });
  }
  const provided = decoded.slice(sep + 1);

  // Constant-time compare to prevent timing attacks.
  if (provided.length !== password.length) {
    return new NextResponse('Bad credentials', {
      status: 401,
      headers: { 'WWW-Authenticate': 'Basic realm="Doggy Sniper"' },
    });
  }
  let mismatch = 0;
  for (let i = 0; i < provided.length; i++) {
    mismatch |= provided.charCodeAt(i) ^ password.charCodeAt(i);
  }
  if (mismatch !== 0) {
    return new NextResponse('Bad credentials', {
      status: 401,
      headers: { 'WWW-Authenticate': 'Basic realm="Doggy Sniper"' },
    });
  }

  return NextResponse.next();
}
