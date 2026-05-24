// Polling engine: walks every enabled Watch and records new under-priced listings.
//
// SPEED OPTIMIZATIONS:
//   1. Collections fetched in parallel (Promise.allSettled)
//   2. listingIds pre-cached in the BACKGROUND for the cheapest N listings
//      in each collection — so when one drops below max, executeBuy can skip
//      the fetchInscription roundtrip (saves ~150-300ms per buy).
//   3. Auto-buy fires immediately on detection (before notification/DB write)
//   4. HTTP keepalive via undici Agent in doggy.ts (saves ~150ms per call)

import { prisma } from './prisma';
import { fetchRecentListings, fetchInscription, getCachedListingId } from './doggy';
import { notifyHit } from './notify';
import { executeBuy } from './executor';

export interface PollSummary {
  checkedAt: string;
  watches: number;
  newHits: number;
  errors: { slug: string; message: string }[];
}

// How many of the cheapest listings per collection to pre-cache listingIds for.
// More = faster sniping, more API calls. 5 is a good balance.
const PRECACHE_TOP_N = 5;

export async function pollOnce(): Promise<PollSummary> {
  const watches = await prisma.watch.findMany({ where: { enabled: true } });
  const summary: PollSummary = {
    checkedAt: new Date().toISOString(),
    watches: watches.length,
    newHits: 0,
    errors: [],
  };

  // Fetch ALL collections in parallel
  const results = await Promise.allSettled(
    watches.map(async (w) => {
      const listings = await fetchRecentListings(w.slug);
      return { watch: w, listings };
    }),
  );

  for (const result of results) {
    if (result.status === 'rejected') {
      summary.errors.push({ slug: '?', message: String(result.reason) });
      continue;
    }
    const { watch: w, listings } = result.value;

    // Background pre-cache of listingIds for the cheapest N listings.
    // This way, if any of them drop below maxPrice in a future poll, we
    // already have the listingId and can skip fetchInscription entirely.
    const cheapest = [...listings]
      .sort((a, b) => a.price - b.price)
      .slice(0, PRECACHE_TOP_N);
    for (const l of cheapest) {
      if (!getCachedListingId(l.inscriptionId)) {
        // Fire-and-forget — don't block polling
        void fetchInscription(l.inscriptionId).catch(() => {});
      }
    }

    try {
      for (const l of listings) {
        const price = BigInt(l.price);
        if (price > w.maxPriceShibes) continue;

        // Upsert by (watchId, inscriptionId)
        const created = await prisma.hit.upsert({
          where: {
            watchId_inscriptionId: { watchId: w.id, inscriptionId: l.inscriptionId },
          },
          create: {
            watchId: w.id,
            inscriptionId: l.inscriptionId,
            inscriptionNumber: l.inscriptionNumber ?? null,
            priceShibes: price,
            sellerAddress: l.sellerAddress,
            listedAt: new Date(l.listedAt),
            status: 'DETECTED',
          },
          update: {},
        });

        if (created.status === 'DETECTED' && created.detectedAt.getTime() > Date.now() - 60_000) {
          summary.newHits += 1;

          // FIRE BUY IMMEDIATELY — speed is critical
          if (w.autoBuy) {
            void executeBuy(created.id).catch((err) => {
              console.error(`[poller] auto-buy ${created.id} failed:`, err);
            });
          }

          // Notification in background
          void (async () => {
            try {
              await notifyHit({
                slug: w.slug,
                inscriptionId: l.inscriptionId,
                inscriptionNumber: l.inscriptionNumber,
                priceShibes: price,
                maxPriceShibes: w.maxPriceShibes,
                sellerAddress: l.sellerAddress,
              });
              await prisma.hit.update({
                where: { id: created.id },
                data: { status: w.autoBuy ? created.status : 'NOTIFIED' },
              });
            } catch (e) {
              console.error('[poller] notify failed:', e);
            }
          })();
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      summary.errors.push({ slug: w.slug, message });
      console.error(`poll error for ${w.slug}:`, message);
    }
  }

  return summary;
}

// ---- Long-running mode ----
const globalForPoller = globalThis as unknown as { __doggyPoller?: NodeJS.Timeout };

export function startPoller(): void {
  if (globalForPoller.__doggyPoller) return;
  const interval = Number(process.env.POLL_INTERVAL_MS ?? 1000);
  console.log(`[poller] starting, interval=${interval}ms`);
  void pollOnce();
  globalForPoller.__doggyPoller = setInterval(() => {
    void pollOnce();
  }, interval);
}
