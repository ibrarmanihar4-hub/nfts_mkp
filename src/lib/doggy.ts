import type {
  DoggyCollectionResponse,
  DoggyListing,
  DoggyInscription,
  DoggyBuyingPSBT,
  DoggyBuyResult,
} from '@/types';

// Doggy.market exposes an undocumented JSON API. Confirmed endpoints (May 2026):
//   GET  /nfts/{slug}                 — recentlyListed[], recentlySold[], stats
//   GET  /inscriptions/{inscriptionId} — inscription detail incl. listed.listingId
//   POST /buyer/createBuyingPSBT      — { listingId, buyerAddress, buyerTokenReceiveAddress }
//                                       returns the PSBT pre-signed by the seller
//   POST /buyer/buyListing            — same body + signedBuyingPSBTBase64 -> broadcast
//
// Prices are shibes (1 DOGE = 100_000_000 shibes).
const BASE = 'https://api.doggy.market';

// Browser-ish UA to dodge any default-block on programmatic clients.
const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

async function getJson<T>(path: string): Promise<T | null> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { accept: 'application/json', 'user-agent': UA },
    cache: 'no-store',
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`doggy.market GET ${path} returned ${res.status}`);
  return (await res.json()) as T | null;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      accept: '*/*',
      'content-type': 'application/json',
      'user-agent': UA,
      origin: 'https://doggy.market',
      referer: 'https://doggy.market/',
    },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`doggy.market POST ${path} returned ${res.status}: ${text.slice(0, 300)}`);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`doggy.market POST ${path} returned non-JSON: ${text.slice(0, 300)}`);
  }
}

export async function fetchCollection(slug: string): Promise<DoggyCollectionResponse | null> {
  return getJson<DoggyCollectionResponse>(`/nfts/${encodeURIComponent(slug)}`);
}

export async function fetchRecentListings(slug: string): Promise<DoggyListing[]> {
  const data = await fetchCollection(slug);
  if (!data) return [];
  return (data.recentlyListed ?? []).filter((l) => l.status === 'listed');
}

export async function fetchInscription(inscriptionId: string): Promise<DoggyInscription | null> {
  return getJson<DoggyInscription>(`/inscriptions/${encodeURIComponent(inscriptionId)}`);
}

export async function createBuyingPSBT(input: {
  listingId: string;
  buyerAddress: string;
  buyerTokenReceiveAddress?: string;
}): Promise<DoggyBuyingPSBT> {
  const res = await fetch(`${BASE}/buyer/createBuyingPSBT`, {
    method: 'POST',
    headers: {
      accept: '*/*',
      'content-type': 'application/json',
      'user-agent': UA,
      origin: 'https://doggy.market',
      referer: 'https://doggy.market/',
    },
    body: JSON.stringify({
      listingId: input.listingId,
      buyerAddress: input.buyerAddress,
      buyerTokenReceiveAddress: input.buyerTokenReceiveAddress ?? input.buyerAddress,
    }),
    cache: 'no-store',
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`doggy.market POST /buyer/createBuyingPSBT returned ${res.status}: ${text.slice(0, 300)}`);
  }
  // Response can be either JSON or plain PSBT base64 string
  try {
    return JSON.parse(text) as DoggyBuyingPSBT;
  } catch {
    // Plain text = the PSBT base64 itself
    return { buyingPSBTBase64: text.trim() } as DoggyBuyingPSBT;
  }
}

export async function buyListing(input: {
  listingId: string;
  buyerAddress: string;
  buyerTokenReceiveAddress?: string;
  signedBuyingPSBTBase64: string;
}): Promise<DoggyBuyResult> {
  const res = await fetch(`${BASE}/buyer/buyListing`, {
    method: 'POST',
    headers: {
      accept: '*/*',
      'content-type': 'application/json',
      'user-agent': UA,
      origin: 'https://doggy.market',
      referer: 'https://doggy.market/',
    },
    body: JSON.stringify({
      listingId: input.listingId,
      buyerAddress: input.buyerAddress,
      buyerTokenReceiveAddress: input.buyerTokenReceiveAddress ?? input.buyerAddress,
      signedBuyingPSBTBase64: input.signedBuyingPSBTBase64,
    }),
    cache: 'no-store',
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`doggy.market POST /buyer/buyListing returned ${res.status}: ${text.slice(0, 300)}`);
  }
  // Response can be JSON or plain txId string
  try {
    return JSON.parse(text) as DoggyBuyResult;
  } catch {
    // Plain text = the txId itself
    return { txId: text.trim() } as DoggyBuyResult;
  }
}

// Create dummy UTXOs via doggy.market's own endpoint.
// Returns a PSBT that the buyer must sign and broadcast.
export async function createDummyPSBT(buyerAddress: string): Promise<{ psbtBase64: string }> {
  const res = await fetch(`${BASE}/buyer/createDummyPSBT`, {
    method: 'POST',
    headers: {
      accept: '*/*',
      'content-type': 'application/json',
      'user-agent': UA,
      origin: 'https://doggy.market',
      referer: 'https://doggy.market/',
    },
    body: JSON.stringify({ buyerAddress }),
    cache: 'no-store',
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`doggy.market createDummyPSBT returned ${res.status}: ${text.slice(0, 300)}`);
  }
  // Response can be JSON or plain PSBT base64 string
  try {
    const data = JSON.parse(text);
    const psbt = data.psbtBase64 ?? data.buyingPSBTBase64 ?? data.psbt ?? data.dummyPSBTBase64;
    if (psbt) return { psbtBase64: psbt };
    // Maybe the JSON itself is just a string
    if (typeof data === 'string') return { psbtBase64: data };
    throw new Error(`no psbt field in response: ${JSON.stringify(data).slice(0, 200)}`);
  } catch (e) {
    // Not JSON — the text IS the PSBT base64
    if (text.startsWith('cHNi')) {
      return { psbtBase64: text.trim() };
    }
    throw new Error(`createDummyPSBT unexpected response: ${text.slice(0, 200)}`);
  }
}

// Broadcast a signed raw TX hex via doggy.market's broadcast endpoint.
export async function broadcastViaDoggy(txHex: string): Promise<string> {
  const res = await fetch(`${BASE}/broadcast`, {
    method: 'POST',
    headers: {
      'content-type': 'text/plain;charset=UTF-8',
      'user-agent': UA,
      origin: 'https://doggy.market',
      referer: 'https://doggy.market/',
    },
    body: txHex,
    cache: 'no-store',
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`doggy.market broadcast returned ${res.status}: ${text.slice(0, 300)}`);
  }
  // Response is likely the txid
  return text.trim().replace(/"/g, '');
}
