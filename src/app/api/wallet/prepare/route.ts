import { NextRequest, NextResponse } from 'next/server';
import { getUnlockedSigner } from '@/lib/wallet';
import { hasDummyUtxos, createDummySplit, hasUnconfirmedDummies } from '@/lib/utxo';

export const dynamic = 'force-dynamic';

// POST /api/wallet/prepare — creates dummy UTXOs by splitting a large UTXO
// into several small ones (0.001 DOGE each). Required before buying.
// Pass ?force=true to re-split even if unconfirmed dummies exist (e.g. stuck TX).
export async function POST(req: NextRequest) {
  try {
    const signer = getUnlockedSigner();
    const force = req.nextUrl.searchParams.get('force') === 'true';

    // Check if we already have confirmed dummies
    const hasDummies = await hasDummyUtxos(signer.address);
    if (hasDummies) {
      return NextResponse.json({ ok: true, message: 'already have confirmed dummy UTXOs — ready to buy' });
    }

    // Check if we have unconfirmed ones (from a previous split)
    if (!force) {
      const hasUnconfirmed = await hasUnconfirmedDummies(signer.address);
      if (hasUnconfirmed) {
        return NextResponse.json({
          ok: false,
          message: 'dummy UTXOs exist but unconfirmed. If stuck for >5 min, the fee was too low. Click "Force re-prepare" to broadcast a higher-fee replacement.',
          canForce: true,
        });
      }
    }

    const result = await createDummySplit(signer.address, signer.keyPair);
    return NextResponse.json({
      ok: true,
      txId: result.txId,
      dummyCount: result.dummyCount,
      message: `Created ${result.dummyCount} dummy UTXOs (fee: 0.5 DOGE). Should confirm in ~1 min.`,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

// GET /api/wallet/prepare — check if dummy UTXOs exist
export async function GET() {
  try {
    const signer = getUnlockedSigner();
    const confirmed = await hasDummyUtxos(signer.address);
    const unconfirmed = !confirmed && await hasUnconfirmedDummies(signer.address);
    return NextResponse.json({
      ready: confirmed,
      pendingConfirmation: unconfirmed,
      address: signer.address,
      message: confirmed
        ? 'ready to buy'
        : unconfirmed
          ? 'dummy UTXOs pending confirmation (~1 min)'
          : 'no dummy UTXOs — click Prepare',
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
