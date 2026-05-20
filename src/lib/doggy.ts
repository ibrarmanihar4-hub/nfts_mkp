import type { DoggyCollectionResponse, DoggyListing } from '@/types';

// Doggy.market exposes an undocumented JSON API. Confirmed working endpoint:
//   GET https://api.doggy.market/nfts/{slug}
// Returns volume stats + recentlyListed[] + recentlySold[].
// All prices are in shibes (1 DOGE = 100_000_000 shibes).
//
// If they ever rotate this path, only this file should need changing.
const BASE = 'https://api.doggy.market';

export async function fetchCollection(slug: string): Promise<DoggyCollectionResponse | null> {
  const url = `${BASE}/nfts/${encodeURIComponent(slug)}`;
  const res = await fetch(url, {
    headers: {
      accept: 'application/json',
      // Pretend to be a browser; doggy.market sometimes 403s on bare fetches.
      'user-agent':
        'Mozilla/5.0 (compatible; DoggySniper/0.1; +https://github.com/your/repo)',
    },
    // Don't cache — we need fresh listings.
    cache: 'no-store',
  });

  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`doggy.market ${slug} returned ${res.status}`);

  const data = (await res.json()) as DoggyCollectionResponse | null;
  return data;
}

export async function fetchRecentListings(slug: string): Promise<DoggyListing[]> {
  const data = await fetchCollection(slug);
  if (!data) return [];
  return (data.recentlyListed ?? []).filter((l) => l.status === 'listed');
}
