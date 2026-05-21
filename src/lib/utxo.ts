// UTXO management: fetch UTXOs, create dummy UTXOs (splits), and broadcast.
//
// Doggy.market's createBuyingPSBT requires the buyer wallet to have small
// "dummy" UTXOs (100,000 shibes each = 0.001 DOGE). These are padding inputs
// the marketplace uses to construct the buy transaction.
//
// If the wallet only has large UTXOs, we need to "split" by broadcasting a
// self-transfer that creates multiple small outputs.
//
// Flow:
//   1. fetchUtxos(address) — get current UTXOs from blockcypher
//   2. hasDummyUtxos(address) — check if we already have enough small ones
//   3. createDummySplit(address, keyPair) — build, sign & broadcast a split TX

import { bitcoin, dogecoinNetwork } from './dogecoin';
import type { ECPairInterface } from 'ecpair';

const BLOCKCYPHER_BASE = 'https://api.blockcypher.com/v1/doge/main';

// Dummy UTXO size: 100,000 shibes (0.001 DOGE) — standard for ordinals marketplaces
const DUMMY_VALUE = 100_000n;
// How many dummy UTXOs to create per split
const DUMMY_COUNT = 5;
// Fee for a split TX. Dogecoin miners currently require ~0.5-2.4 DOGE/KB.
// A split TX is ~300 bytes, so we need at least 0.15-0.7 DOGE.
// Using 0.5 DOGE (50,000,000 shibes) to guarantee fast confirmation.
const SPLIT_FEE = 50_000_000n; // 0.5 DOGE

export interface Utxo {
  txHash: string;
  vout: number;
  value: bigint;
  confirmations: number;
}

export async function fetchUtxos(address: string): Promise<Utxo[]> {
  const url = `${BLOCKCYPHER_BASE}/addrs/${address}?unspentOnly=true&includeScript=false`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`blockcypher UTXOs returned ${res.status}`);
  const data = await res.json();
  const txrefs: any[] = data.txrefs ?? [];
  const unconfirmed: any[] = data.unconfirmed_txrefs ?? [];
  return [...txrefs, ...unconfirmed].map((r: any) => ({
    txHash: r.tx_hash,
    vout: r.tx_output_n,
    value: BigInt(r.value),
    confirmations: r.confirmations ?? 0,
  }));
}

export async function hasDummyUtxos(address: string): Promise<boolean> {
  const utxos = await fetchUtxos(address);
  // Need at least 2 CONFIRMED UTXOs with value == DUMMY_VALUE
  // doggy.market only accepts confirmed UTXOs
  const confirmedDummies = utxos.filter((u) => u.value === DUMMY_VALUE && u.confirmations >= 1);
  return confirmedDummies.length >= 2;
}

export async function hasUnconfirmedDummies(address: string): Promise<boolean> {
  const utxos = await fetchUtxos(address);
  const unconfirmedDummies = utxos.filter((u) => u.value === DUMMY_VALUE && u.confirmations === 0);
  return unconfirmedDummies.length >= 2;
}

export async function createDummySplit(
  address: string,
  keyPair: ECPairInterface,
): Promise<{ txId: string; dummyCount: number }> {
  const utxos = await fetchUtxos(address);
  if (utxos.length === 0) throw new Error('no UTXOs available to split');

  // IMPORTANT: Only use CONFIRMED UTXOs as source. This also acts as a
  // "replace by fee" mechanism — if a previous low-fee TX spent the same
  // confirmed UTXO but is stuck unconfirmed, broadcasting a new TX spending
  // it with a higher fee via a different node will replace it.
  const confirmed = utxos.filter((u) => u.confirmations >= 1 && u.value > totalNeededForSplit());
  
  if (confirmed.length === 0) {
    // No confirmed UTXOs large enough — check if there are ANY confirmed UTXOs
    const anyConfirmed = utxos.filter((u) => u.confirmations >= 1);
    if (anyConfirmed.length === 0) {
      throw new Error(
        'no confirmed UTXOs available. If you have stuck unconfirmed TXs, ' +
        'either wait 24-72h for them to expire, or send fresh DOGE to this address from an exchange.'
      );
    }
    throw new Error(
      `largest confirmed UTXO (${anyConfirmed[0].value} shibes) is too small. ` +
      `Need at least ${totalNeededForSplit()} shibes. Send more DOGE to ${address}.`
    );
  }

  const source = confirmed.sort((a, b) => (b.value > a.value ? 1 : -1))[0];

  // Fetch the raw prev TX for nonWitnessUtxo
  const rawTxHex = await fetchRawTx(source.txHash);
  const prevTxBuf = Buffer.from(rawTxHex, 'hex');

  // Build the split TX
  const psbt = new bitcoin.Psbt({ network: dogecoinNetwork });
  psbt.addInput({
    hash: source.txHash,
    index: source.vout,
    nonWitnessUtxo: prevTxBuf,
  });

  // Add dummy outputs
  for (let i = 0; i < DUMMY_COUNT; i++) {
    psbt.addOutput({
      address,
      value: DUMMY_VALUE,
    });
  }

  // Change output (remaining after dummies + fee)
  const change = source.value - DUMMY_VALUE * BigInt(DUMMY_COUNT) - SPLIT_FEE;
  if (change > 100_000n) {
    psbt.addOutput({ address, value: change });
  }

  // Sign all inputs
  psbt.signInput(0, keyPair);
  psbt.finalizeInput(0);

  // Extract and broadcast
  const tx = psbt.extractTransaction(true); // true = skip fee rate check
  const txHex = tx.toHex();
  const txId = await broadcastTx(txHex);

  console.log(`[utxo] split TX broadcast: ${txId} (${DUMMY_COUNT} dummy UTXOs created, fee=0.5 DOGE)`);
  return { txId, dummyCount: DUMMY_COUNT };
}

function totalNeededForSplit(): bigint {
  return DUMMY_VALUE * BigInt(DUMMY_COUNT) + SPLIT_FEE;
}

async function fetchRawTx(txHash: string): Promise<string> {
  // Blockcypher returns the raw hex at /txs/{hash}?includeHex=true
  const url = `${BLOCKCYPHER_BASE}/txs/${txHash}?includeHex=true`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`failed to fetch raw tx ${txHash}: ${res.status}`);
  const data = await res.json();
  if (!data.hex) throw new Error(`no hex in raw tx response for ${txHash}`);
  return data.hex;
}

async function broadcastTx(txHex: string): Promise<string> {
  // Try Blockchair first (doesn't share mempool with Blockcypher, better for RBF-like scenarios)
  try {
    const bcRes = await fetch('https://api.blockchair.com/dogecoin/push/transaction', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ data: txHex }),
    });
    const bcData = await bcRes.json();
    if (bcRes.ok && bcData?.data?.transaction_hash) {
      console.log(`[utxo] broadcast via Blockchair: ${bcData.data.transaction_hash}`);
      return bcData.data.transaction_hash;
    }
    // If Blockchair fails, fall through to Blockcypher
    console.log(`[utxo] Blockchair failed: ${JSON.stringify(bcData).slice(0, 200)}, trying Blockcypher...`);
  } catch (e) {
    console.log(`[utxo] Blockchair error: ${e}, trying Blockcypher...`);
  }

  // Fallback: Blockcypher
  const url = `${BLOCKCYPHER_BASE}/txs/push`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tx: txHex }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`broadcast failed: ${JSON.stringify(data).slice(0, 300)}`);
  }
  const txId = data.tx?.hash ?? data.hash ?? null;
  if (!txId) throw new Error(`broadcast response missing txid: ${JSON.stringify(data).slice(0, 200)}`);
  return txId;
}
