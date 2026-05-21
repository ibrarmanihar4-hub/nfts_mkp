// Polling engine: walks every enabled Watch and records new under-priced listings.
//
// Optimized for SPEED:
//   - Collections fetched in parallel
//   - Auto-buy fires IMMEDIATELY on detection (before notification)
//   - No unnecessary DB writes before buy attempt
//   - Poll interval can be as low as 500ms

import { prisma } from './prisma';
import { fetchRecentListings } from './doggy';
import { notifyHit } from './notify';
import { executeBuy } from './executor';

export interface PollSummary {
  checkedAt: string;
  watches: number;
  newHits: number;
  errors: { slug: string; message: string }[];
}

export async function pollOnce(): Promise<PollSummary> {
  const watches = await prisma.watch.findMany({ where: { enabled: true } });
  const summary: PollSummary = {
    checkedAt: new Date().toISOString(),
    watches: watches.length,
    newHits: 0,
    errors: [],
  };

  // Fetch ALL collections in parallel for maximum speed
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

    try {
      for (const l of listings) {
        const price = BigInt(l.price);
        if (price > w.maxPriceShibes) continue;

        // Upsert by (watchId, inscriptionId) — duplicates from re-polling are no-ops.
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
          update: {}, // never overwrite — we only care about the first sighting
        });

        // Only act on fresh DETECTED rows (within last 60s).
        if (created.status === 'DETECTED' && created.detectedAt.getTime() > Date.now() - 60_000) {
          summary.newHits += 1;

          // AUTO-BUY FIRST — speed is critical. Fire immediately, don't wait for notification.
          if (w.autoBuy) {
            void executeBuy(created.id).catch((err) => {
              console.error(`[poller] auto-buy ${created.id} failed:`, err);
            });
          }

          // Notification in background — don't block the buy
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
  if (globalForPoller.__doggyPoller) return; // already running
  const interval = Number(process.env.POLL_INTERVAL_MS ?? 2000);
  console.log(`[poller] starting, interval=${interval}ms`);
  // Fire immediately, then on a timer.
  void pollOnce();
  globalForPoller.__doggyPoller = setInterval(() => {
    void pollOnce();
  }, interval);
}
