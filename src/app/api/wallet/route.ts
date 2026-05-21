import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getWalletStatus, setupWallet } from '@/lib/wallet';

export const dynamic = 'force-dynamic';

const SetupBody = z.object({
  wif: z.string().min(20).optional(),
  mnemonic: z.string().min(10).optional(),
  passphrase: z.string().min(8),
}).refine(
  (d) => d.wif || d.mnemonic,
  { message: 'Provide either wif (private key) or mnemonic (seed phrase)' },
);

export async function GET() {
  return NextResponse.json(await getWalletStatus());
}

// Configure (or replace) the encrypted hot wallet.
// Accepts EITHER:
//   { wif: "Q...", passphrase: "..." }         — raw WIF private key
//   { mnemonic: "word1 word2 ...", passphrase: "..." }  — 12/24-word seed phrase
// WARNING: replacing overwrites the previous key. The plaintext key goes through
// memory only; it is never logged.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = SetupBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join('; ') },
      { status: 400 },
    );
  }
  try {
    const { address } = await setupWallet(
      { wif: parsed.data.wif, mnemonic: parsed.data.mnemonic },
      parsed.data.passphrase,
    );
    return NextResponse.json({ address });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
