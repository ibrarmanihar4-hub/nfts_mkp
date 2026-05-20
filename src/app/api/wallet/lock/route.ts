import { NextResponse } from 'next/server';
import { lockWallet } from '@/lib/wallet';

export const dynamic = 'force-dynamic';

export async function POST() {
  lockWallet();
  return NextResponse.json({ ok: true });
}
