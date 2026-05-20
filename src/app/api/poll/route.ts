import { NextRequest, NextResponse } from 'next/server';
import { pollOnce } from '@/lib/poller';

export const dynamic = 'force-dynamic';

// External-cron-friendly poll trigger.
// Call: POST /api/poll  (with `Authorization: Bearer $POLL_SECRET` if set)
export async function POST(req: NextRequest) {
  const secret = process.env.POLL_SECRET;
  if (secret) {
    const auth = req.headers.get('authorization') ?? '';
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  }
  const summary = await pollOnce();
  return NextResponse.json(summary);
}
