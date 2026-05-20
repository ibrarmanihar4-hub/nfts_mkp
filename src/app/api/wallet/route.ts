import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getWalletStatus, setupWallet } from '@/lib/wallet';

export const dynamic = 'force-dynamic';

const SetupBody = z.object({
  wif: z.string().min(20),
  passphrase: z.string().min(8),
});

export async function GET() {
  return NextResponse.json(await getWalletStatus());
}

// Configure (or replace) the encrypted hot wallet.
// WARNING: replacing overwrites the previous key. The plaintext WIF goes through
// memory only; it is never logged.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = SetupBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }
  try {
    const { address } = await setupWallet(parsed.data.wif, parsed.data.passphrase);
    return NextResponse.json({ address });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
