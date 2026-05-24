import type {
  DoggyCollectionResponse,
  DoggyListing,
  DoggyInscription,
  DoggyBuyingPSBT,
  DoggyBuyResult,
} from '@/types';
import { Agent, request as undiciRequest, setGlobalDispatcher } from 'undici';

// Persistent connection pool to api.doggy.market — reuses TLS sessions
// instead of opening a fresh handshake on every request. Saves ~100-200ms
// per call compared to default fetch.
const dispatcher = new Agent({
  keepAliveTimeout: 30_000,
  keepAliveMaxTimeout: 60_000,
  connections: 10,
  pipelining: 1,
});
setGlobalDispatcher(dispatcher);

const BASE = 'https://api.doggy.market';
const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

// In-memory cache: inscriptionId -> listingId. Populated by the poller's
// background pre-fetch so executeBuy doesn't need to wait for fetchInscription.
const listingIdCache = new Map<string, string>();

export function cacheListingId(inscriptionId: string, listingId: string): void {
  listingIdCache.set(inscriptionId, listingId);
  if (listingIdCache.size > 1000) {
    const firstKey = listingIdCache.keys().next().value;
    if (firstKey) listingIdCache.delete(firstKey);
  }
}

export function getCachedListingId(inscriptionId: string): string | undefined {
  return listingIdCache.get(inscriptionId);
}

async function get(path: string): Promise<{ status: number; text: string }> {
  const { statusCode, body } = await undiciRequest(`${BASE}${path}`, {
    method: 'GET',
    headers: { accept: 'application/json', 'user-agent': UA },
  });
  const text = await body.text();
  return { status: statusCode, text };
}

async function post(
  path: string,
  body: string,
  contentType = 'application/json',
): Promise<{ status: number; text: string }> {
  const { statusCode, body: respBody } = await undiciRequest(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      accept: '*/*',
      'content-type': contentType,
      'user-agent': UA,
      origin: 'https://doggy.market',
      referer: 'https://doggy.market/',
    },
    body,
  });
  const text = await respBody.text();
  return { status: statusCode, text };
}

export async function fetchCollection(slug: string): Promise<DoggyCollectionResponse | null> {
  const { status, text } = await get(`/nfts/${encodeURIComponent(slug)}`);
  if (status === 404) return null;
  if (status >= 400) throw new Error(`doggy.market /nfts/${slug} returned ${status}`);
  if (!text || text === 'null') return null;
  return JSON.parse(text);
}

export async function fetchRecentListings(slug: string): Promise<DoggyListing[]> {
  const data = await fetchCollection(slug);
  if (!data) return [];
  return (data.recentlyListed ?? []).filter((l) => l.status === 'listed');
}

export async function fetchInscription(inscriptionId: string): Promise<DoggyInscription | null> {
  const { status, text } = await get(`/inscriptions/${encodeURIComponent(inscriptionId)}`);
  if (status === 404) return null;
  if (status >= 400) throw new Error(`doggy.market /inscriptions returned ${status}`);
  if (!text || text === 'null') return null;
  const data = JSON.parse(text) as DoggyInscription;
  if (data?.listed?.listingId) {
    cacheListingId(inscriptionId, data.listed.listingId);
  }
  return data;
}

export async function createBuyingPSBT(input: {
  listingId: string;
  buyerAddress: string;
  buyerTokenReceiveAddress?: string;
}): Promise<DoggyBuyingPSBT> {
  const { status, text } = await post(
    '/buyer/createBuyingPSBT',
    JSON.stringify({
      listingId: input.listingId,
      buyerAddress: input.buyerAddress,
      buyerTokenReceiveAddress: input.buyerTokenReceiveAddress ?? input.buyerAddress,
    }),
  );
  if (status >= 400) {
    throw new Error(`doggy.market POST /buyer/createBuyingPSBT returned ${status}: ${text.slice(0, 300)}`);
  }
  try {
    return JSON.parse(text) as DoggyBuyingPSBT;
  } catch {
    return { buyingPSBTBase64: text.trim() } as DoggyBuyingPSBT;
  }
}

export async function buyListing(input: {
  listingId: string;
  buyerAddress: string;
  buyerTokenReceiveAddress?: string;
  signedBuyingPSBTBase64: string;
}): Promise<DoggyBuyResult> {
  const { status, text } = await post(
    '/buyer/buyListing',
    JSON.stringify({
      listingId: input.listingId,
      buyerAddress: input.buyerAddress,
      buyerTokenReceiveAddress: input.buyerTokenReceiveAddress ?? input.buyerAddress,
      signedBuyingPSBTBase64: input.signedBuyingPSBTBase64,
    }),
  );
  if (status >= 400) {
    throw new Error(`doggy.market POST /buyer/buyListing returned ${status}: ${text.slice(0, 300)}`);
  }
  try {
    return JSON.parse(text) as DoggyBuyResult;
  } catch {
    return { txId: text.trim() } as DoggyBuyResult;
  }
}

export async function createDummyPSBT(buyerAddress: string): Promise<{ psbtBase64: string }> {
  const { status, text } = await post(
    '/buyer/createDummyPSBT',
    JSON.stringify({ buyerAddress }),
  );
  if (status >= 400) {
    throw new Error(`doggy.market createDummyPSBT returned ${status}: ${text.slice(0, 300)}`);
  }
  try {
    const data = JSON.parse(text);
    const psbt = data.psbtBase64 ?? data.buyingPSBTBase64 ?? data.psbt ?? data.dummyPSBTBase64;
    if (psbt) return { psbtBase64: psbt };
    if (typeof data === 'string') return { psbtBase64: data };
    throw new Error(`no psbt field in response: ${JSON.stringify(data).slice(0, 200)}`);
  } catch (e) {
    if (text.startsWith('cHNi')) {
      return { psbtBase64: text.trim() };
    }
    throw new Error(`createDummyPSBT unexpected response: ${text.slice(0, 200)}`);
  }
}

export async function broadcastViaDoggy(txHex: string): Promise<string> {
  const { status, text } = await post('/broadcast', txHex, 'text/plain;charset=UTF-8');
  if (status >= 400) {
    throw new Error(`doggy.market broadcast returned ${status}: ${text.slice(0, 300)}`);
  }
  return text.trim().replace(/"/g, '');
}
