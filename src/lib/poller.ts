// Polling engine: walks every enabled Watch and records new under-priced listings.
//
// Two ways to drive it:
//   1. Long-running mode: `startPoller()` spins up a setInterval inside the Node
//      process. Good for `next dev` and self-hosted/VPS deploys.
//   2. Cron mode: hit `POST /api/poll` from an external scheduler (Vercel Cron,
//      GitHub Actions, etc.). Calls `pollOnce()` and returns.

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

  for (const w of watches) {
    try {
      const listings = await fetchRecentListings(w.slug);
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

        // Only fire notifications on a fresh DETECTED row.
        if (created.status === 'DETECTED' && created.detectedAt.getTime() > Date.now() - 60_000) {
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
            data: { status: 'NOTIFIED' },
          });
          summary.newHits += 1;

          // Auto-buy if the watch opted in. Fire-and-forget so one slow buy
          // doesn't block the rest of the poll cycle.
          if (w.autoBuy) {
            void executeBuy(created.id).catch((err) => {
              console.error(`[poller] auto-buy ${created.id} failed:`, err);
            });
          }
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
  const interval = Number(process.env.POLL_INTERVAL_MS ?? 5000);
  console.log(`[poller] starting, interval=${interval}ms`);
  // Fire immediately, then on a timer.
  void pollOnce();
  globalForPoller.__doggyPoller = setInterval(() => {
    void pollOnce();
  }, interval);
}
