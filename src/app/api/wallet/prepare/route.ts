import { NextRequest, NextResponse } from 'next/server';
import { getUnlockedSigner } from '@/lib/wallet';
import { createDummyPSBT, broadcastViaDoggy } from '@/lib/doggy';
import { bitcoin, dogecoinNetwork } from '@/lib/dogecoin';

export const dynamic = 'force-dynamic';

// POST /api/wallet/prepare — creates dummy UTXOs via doggy.market's own
// createDummyPSBT endpoint. This is the ONLY way to create dummy UTXOs
// that doggy.market's indexer will recognize for buying.
export async function POST(req: NextRequest) {
  try {
    const signer = getUnlockedSigner();

    // 1. Get dummy PSBT from doggy.market
    console.log(`[prepare] calling createDummyPSBT for ${signer.address}`);
    const dummyQuote = await createDummyPSBT(signer.address);

    // 2. Sign all buyer inputs
    const psbt = bitcoin.Psbt.fromBase64(dummyQuote.psbtBase64, { network: dogecoinNetwork });
    const ourPayment = bitcoin.payments.p2pkh({
      pubkey: signer.keyPair.publicKey,
      network: dogecoinNetwork,
    });
    const ourScript = Buffer.from(ourPayment.output as Uint8Array).toString('hex');

    let signed = 0;
    for (let i = 0; i < psbt.data.inputs.length; i++) {
      const input = psbt.data.inputs[i];
      let scriptHex: string | null = null;
      if (input.witnessUtxo) {
        scriptHex = Buffer.from(input.witnessUtxo.script).toString('hex');
      } else if (input.nonWitnessUtxo) {
        const prevTx = bitcoin.Transaction.fromBuffer(Buffer.from(input.nonWitnessUtxo));
        const vout = psbt.txInputs[i].index;
        scriptHex = Buffer.from(prevTx.outs[vout].script).toString('hex');
      }
      if (scriptHex === ourScript) {
        psbt.signInput(i, signer.keyPair);
        psbt.finalizeInput(i);
        signed += 1;
      }
    }

    if (signed === 0) {
      return NextResponse.json({ error: 'no inputs to sign — wrong wallet?' }, { status: 400 });
    }

    // 3. Extract raw TX and broadcast via doggy.market
    const tx = psbt.extractTransaction(true);
    const txHex = tx.toHex();
    const txId = await broadcastViaDoggy(txHex);

    return NextResponse.json({
      ok: true,
      txId,
      message: `Dummy UTXOs created and broadcast via doggy.market (txId: ${txId}). Wait ~1 min for confirmation, then buying will work.`,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

// GET /api/wallet/prepare — just try createBuyingPSBT on a known listing to check readiness
export async function GET() {
  try {
    const signer = getUnlockedSigner();
    return NextResponse.json({
      address: signer.address,
      message: 'Click "Prepare dummy UTXOs" to create them via doggy.market',
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
