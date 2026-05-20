import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { unlockWallet } from '@/lib/wallet';

export const dynamic = 'force-dynamic';

const Body = z.object({ passphrase: z.string().min(1) });

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = Body.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }
  try {
    const { address } = await unlockWallet(parsed.data.passphrase);
    return NextResponse.json({ ok: true, address });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
