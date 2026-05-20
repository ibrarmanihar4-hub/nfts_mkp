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
  return postJson<DoggyBuyingPSBT>('/buyer/createBuyingPSBT', {
    listingId: input.listingId,
    buyerAddress: input.buyerAddress,
    buyerTokenReceiveAddress: input.buyerTokenReceiveAddress ?? input.buyerAddress,
  });
}

export async function buyListing(input: {
  listingId: string;
  buyerAddress: string;
  buyerTokenReceiveAddress?: string;
  signedBuyingPSBTBase64: string;
}): Promise<DoggyBuyResult> {
  return postJson<DoggyBuyResult>('/buyer/buyListing', {
    listingId: input.listingId,
    buyerAddress: input.buyerAddress,
    buyerTokenReceiveAddress: input.buyerTokenReceiveAddress ?? input.buyerAddress,
    signedBuyingPSBTBase64: input.signedBuyingPSBTBase64,
  });
}
