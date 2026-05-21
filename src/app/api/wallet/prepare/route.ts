import { NextResponse } from 'next/server';
import { getUnlockedSigner } from '@/lib/wallet';
import { hasDummyUtxos, createDummySplit } from '@/lib/utxo';

export const dynamic = 'force-dynamic';

// POST /api/wallet/prepare — creates dummy UTXOs by splitting a large UTXO
// into several small ones (0.001 DOGE each). Required before buying.
export async function POST() {
  try {
    const signer = getUnlockedSigner();

    // Check if we already have dummies
    const hasDummies = await hasDummyUtxos(signer.address);
    if (hasDummies) {
      return NextResponse.json({ ok: true, message: 'already have dummy UTXOs' });
    }

    const result = await createDummySplit(signer.address, signer.keyPair);
    return NextResponse.json({
      ok: true,
      txId: result.txId,
      dummyCount: result.dummyCount,
      message: `Created ${result.dummyCount} dummy UTXOs. Wait ~1 min for confirmation before buying.`,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

// GET /api/wallet/prepare — check if dummy UTXOs exist
export async function GET() {
  try {
    const signer = getUnlockedSigner();
    const ready = await hasDummyUtxos(signer.address);
    return NextResponse.json({ ready, address: signer.address });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
