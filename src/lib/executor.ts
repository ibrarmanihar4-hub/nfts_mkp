// Buy executor: turns a detected Hit into an on-chain purchase.
//
// Flow:
//   1. Resolve listingId via GET /inscriptions/{inscriptionId}.
//   2. POST /buyer/createBuyingPSBT to get the seller-pre-signed PSBT.
//   3. Decode it, sign every input we own, finalize those inputs.
//   4. POST /buyer/buyListing with the resulting base64.
//   5. Record txId + status on the Hit row.
//
// Safety rails:
//   - dryRun (Settings.dryRun) — short-circuits before submission, just logs the
//     intended call and the size of the unsigned PSBT.
//   - dailyCapShibes — sum of priceShibes for hits with status BOUGHT or BUYING
//     in the last 24h is checked before each buy.
//   - per-hit lock — uses an in-memory Set so we don't double-submit if the
//     poller fires twice while a buy is in flight.

import { prisma } from './prisma';
import { bitcoin, dogecoinNetwork } from './dogecoin';
import { getUnlockedSigner } from './wallet';
import { fetchInscription, createBuyingPSBT, buyListing, createDummyPSBT, broadcastViaDoggy } from './doggy';
import { shibesToDoge } from './units';

const inFlight = new Set<string>();

export interface ExecuteResult {
  ok: boolean;
  status: 'BOUGHT' | 'FAILED' | 'SKIPPED';
  txId?: string;
  error?: string;
  dryRun?: boolean;
}

export async function executeBuy(hitId: string): Promise<ExecuteResult> {
  if (inFlight.has(hitId)) {
    return { ok: false, status: 'SKIPPED', error: 'already in flight' };
  }
  inFlight.add(hitId);

  try {
    const hit = await prisma.hit.findUnique({ where: { id: hitId }, include: { watch: true } });
    if (!hit) return { ok: false, status: 'FAILED', error: 'hit not found' };
    if (hit.status === 'BOUGHT' || hit.status === 'BUYING') {
      return { ok: false, status: 'SKIPPED', error: `hit already ${hit.status}` };
    }

    // Settings + caps
    const settings = await prisma.settings.upsert({
      where: { id: 'default' },
      create: { id: 'default' },
      update: {},
    });
    const dryRun = settings.dryRun;

    if (settings.dailyCapShibes > 0n) {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const recent = await prisma.hit.findMany({
        where: { detectedAt: { gte: since }, status: { in: ['BUYING', 'BOUGHT'] } },
        select: { priceShibes: true },
      });
      const spent = recent.reduce((sum, h) => sum + h.priceShibes, 0n);
      if (spent + hit.priceShibes > settings.dailyCapShibes) {
        await prisma.hit.update({
          where: { id: hit.id },
          data: { status: 'SKIPPED', notes: `daily cap exceeded (spent ${shibesToDoge(spent)} DOGE)` },
        });
        return { ok: false, status: 'SKIPPED', error: 'daily cap exceeded' };
      }
    }

    // Wallet
    const signer = (() => {
      try {
        return getUnlockedSigner();
      } catch (e) {
        return null;
      }
    })();
    if (!signer) {
      await prisma.hit.update({
        where: { id: hit.id },
        data: { status: 'FAILED', notes: 'wallet locked — POST /api/wallet/unlock' },
      });
      return { ok: false, status: 'FAILED', error: 'wallet locked' };
    }

    // Mark BUYING up front so concurrent pollers skip it.
    await prisma.hit.update({ where: { id: hit.id }, data: { status: 'BUYING' } });

    // 1. Resolve listingId from inscriptionId.
    const insc = await fetchInscription(hit.inscriptionId);
    if (!insc?.listed?.listingId) {
      await prisma.hit.update({
        where: { id: hit.id },
        data: { status: 'FAILED', notes: 'listing already gone (no listingId)' },
      });
      return { ok: false, status: 'FAILED', error: 'listing gone' };
    }
    const listingId = insc.listed.listingId;

    // Verify price hasn't moved up since detection.
    const livePrice = BigInt(insc.listed.price);
    if (livePrice > hit.watch.maxPriceShibes) {
      await prisma.hit.update({
        where: { id: hit.id },
        data: {
          status: 'SKIPPED',
          notes: `price changed to ${shibesToDoge(livePrice)} DOGE (above max)`,
        },
      });
      return { ok: false, status: 'SKIPPED', error: 'price increased' };
    }

    // 2. Get the seller-pre-signed PSBT.
    let quote = await createBuyingPSBT({
      listingId,
      buyerAddress: signer.address,
      buyerTokenReceiveAddress: signer.address,
    }).catch((err) => ({ error: err instanceof Error ? err.message : String(err) } as any));

    // Handle "no dummy utxos" error by using doggy.market's own createDummyPSBT
    const quoteError = typeof quote === 'object' && 'error' in quote ? (quote as any).error : null;
    if (quoteError && /dummy.?utxo/i.test(quoteError)) {
      console.log(`[executor] no dummy utxos — calling createDummyPSBT for ${signer.address}`);
      try {
        // 1. Get dummy PSBT from doggy.market
        const dummyQuote = await createDummyPSBT(signer.address);

        // 2. Sign all buyer inputs in the dummy PSBT
        const dummyPsbt = bitcoin.Psbt.fromBase64(dummyQuote.psbtBase64, { network: dogecoinNetwork });
        const ourPaymentDummy = bitcoin.payments.p2pkh({
          pubkey: signer.keyPair.publicKey,
          network: dogecoinNetwork,
        });
        const ourScriptDummy = Buffer.from(ourPaymentDummy.output as Uint8Array).toString('hex');

        for (let i = 0; i < dummyPsbt.data.inputs.length; i++) {
          const input = dummyPsbt.data.inputs[i];
          let scriptHex: string | null = null;
          if (input.witnessUtxo) {
            scriptHex = Buffer.from(input.witnessUtxo.script).toString('hex');
          } else if (input.nonWitnessUtxo) {
            const prevTx = bitcoin.Transaction.fromBuffer(Buffer.from(input.nonWitnessUtxo));
            const vout = dummyPsbt.txInputs[i].index;
            scriptHex = Buffer.from(prevTx.outs[vout].script).toString('hex');
          }
          if (scriptHex === ourScriptDummy) {
            dummyPsbt.signInput(i, signer.keyPair);
            dummyPsbt.finalizeInput(i);
          }
        }

        // 3. Extract the raw TX and broadcast via doggy.market's own endpoint
        const dummyTx = dummyPsbt.extractTransaction(true);
        const dummyTxHex = dummyTx.toHex();
        const dummyTxId = await broadcastViaDoggy(dummyTxHex);
        console.log(`[executor] dummy UTXO TX broadcast via doggy.market: ${dummyTxId}, waiting 65s...`);

        // 4. Wait for confirmation
        await new Promise((r) => setTimeout(r, 65_000));

        // 5. Retry createBuyingPSBT
        quote = await createBuyingPSBT({
          listingId,
          buyerAddress: signer.address,
          buyerTokenReceiveAddress: signer.address,
        });
      } catch (splitErr) {
        const msg = splitErr instanceof Error ? splitErr.message : String(splitErr);
        await prisma.hit.update({
          where: { id: hit.id },
          data: { status: 'FAILED', notes: `dummy UTXO creation failed: ${msg}` },
        });
        return { ok: false, status: 'FAILED', error: `dummy creation failed: ${msg}` };
      }
    } else if (quoteError) {
      throw new Error(quoteError);
    }

    const psbtBase64 = (quote as any).buyingPSBTBase64 ?? (quote as any).psbtBase64;
    if (!psbtBase64) {
      throw new Error(`createBuyingPSBT returned no psbt: ${JSON.stringify(quote).slice(0, 200)}`);
    }

    // 3. Sign buyer-controlled inputs.
    const psbt = bitcoin.Psbt.fromBase64(psbtBase64, { network: dogecoinNetwork });

    // Compute our P2PKH script for matching inputs we own.
    const ourPayment = bitcoin.payments.p2pkh({
      pubkey: signer.keyPair.publicKey,
      network: dogecoinNetwork,
    });
    const ourScript = Buffer.from(ourPayment.output as Uint8Array).toString('hex');

    let signedCount = 0;
    for (let i = 0; i < psbt.data.inputs.length; i++) {
      const input = psbt.data.inputs[i];
      // Determine the prev-output script.
      let scriptHex: string | null = null;
      if (input.witnessUtxo) {
        scriptHex = Buffer.from(input.witnessUtxo.script).toString('hex');
      } else if (input.nonWitnessUtxo) {
        const prevTx = bitcoin.Transaction.fromBuffer(Buffer.from(input.nonWitnessUtxo));
        const vout = psbt.txInputs[i].index;
        scriptHex = Buffer.from(prevTx.outs[vout].script).toString('hex');
      }
      if (scriptHex !== ourScript) continue; // not ours (e.g. seller's input)
      psbt.signInput(i, signer.keyPair);
      // DO NOT finalize — doggy.market expects partial signatures in PSBT format.
      // They finalize + extract on their server before broadcasting.
      signedCount += 1;
    }

    if (signedCount === 0) {
      await prisma.hit.update({
        where: { id: hit.id },
        data: {
          status: 'FAILED',
          notes: `PSBT had no inputs owned by ${signer.address} — wrong wallet?`,
        },
      });
      return { ok: false, status: 'FAILED', error: 'no buyer inputs to sign' };
    }

    const signedB64 = psbt.toBase64();

    // 4. Submit (or dry-run).
    if (dryRun) {
      await prisma.hit.update({
        where: { id: hit.id },
        data: {
          status: 'SKIPPED',
          notes: `DRY RUN — would buy ${shibesToDoge(livePrice)} DOGE, signed ${signedCount} inputs (psbt ${signedB64.length}b)`,
        },
      });
      return { ok: true, status: 'SKIPPED', dryRun: true };
    }

    const result = await buyListing({
      listingId,
      buyerAddress: signer.address,
      buyerTokenReceiveAddress: signer.address,
      signedBuyingPSBTBase64: signedB64,
    });
    const txId = result.txId ?? result.txid ?? null;

    await prisma.hit.update({
      where: { id: hit.id },
      data: {
        status: txId ? 'BOUGHT' : 'FAILED',
        txId: txId ?? undefined,
        notes: txId ? null : `submit returned no txId: ${JSON.stringify(result).slice(0, 200)}`,
      },
    });

    return txId
      ? { ok: true, status: 'BOUGHT', txId }
      : { ok: false, status: 'FAILED', error: 'no txId returned' };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await prisma.hit.update({
      where: { id: hitId },
      data: { status: 'FAILED', notes: msg.slice(0, 500) },
    });
    return { ok: false, status: 'FAILED', error: msg };
  } finally {
    inFlight.delete(hitId);
  }
}
