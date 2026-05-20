# Doggy Sniper

A monitoring & alerting bot for [doggy.market](https://doggy.market) doginal NFT
collections. You configure max prices per collection; it polls doggy.market's
listings API and notifies you (and eventually auto-buys) when a listing drops
below your threshold.

## Status

- **Stage 1 (working):** poll listings, record matches, log + Telegram alerts,
  web dashboard for managing watch rules and viewing hits.
- **Stage 2 (stub):** auto-buy via PSBT — needs doggy.market's buy flow
  reverse-engineered from a real test purchase. See
  `src/app/api/buy/[hitId]/route.ts`.

## Stack

Next.js 14 (App Router) + TypeScript + Prisma + SQLite. One process serves the
UI, the API, and the background poller.

## Quick start

```bash
cp .env.example .env
npm install
npx prisma db push       # creates dev.db
npm run dev              # http://localhost:3000
```

Add a watch from the dashboard, e.g.:

- collection: `doginal-primes`
- max price: `100` (DOGE)

The poller will check every `POLL_INTERVAL_MS` (default 5s) and surface any
listing at or below your max.

## How it works

1. `src/lib/doggy.ts` — `GET https://api.doggy.market/nfts/{slug}` returns
   `recentlyListed[]` items with prices in **shibes** (1 DOGE = 100,000,000).
2. `src/lib/poller.ts` — every interval, walks each enabled `Watch`, fetches
   listings, upserts a `Hit` for any whose price ≤ max, fires `notifyHit` once.
3. `src/lib/notify.ts` — logs to console; if `TELEGRAM_BOT_TOKEN` and
   `TELEGRAM_CHAT_ID` are set, also pushes a Markdown message there.
4. `src/app/page.tsx` — dashboard, polls `/api/watches` and `/api/hits` every
   5s.

## Deploying

- **Self-hosted / VPS:** `npm run build && npm start`. The in-process poller
  starts on first API request and runs forever.
- **Serverless (e.g. Vercel):** the in-process poller won't survive between
  requests. Instead, schedule a cron that hits `POST /api/poll` (set
  `POLL_SECRET` and pass it as `Authorization: Bearer <secret>`).

## Roadmap to Stage 2 (auto-buy)

To make this actually buy NFTs, we need:

1. **Capture doggy.market's buy flow.** Open DevTools → Network on
   doggy.market, complete one real purchase, and save the requests/responses
   between "Buy now" and the on-chain broadcast. We're looking for:
   - the endpoint that returns the **seller-signed PSBT** for an inscription
   - the endpoint that **submits the fully-signed PSBT** for broadcast
2. **Hot wallet integration.** Add encrypted private-key storage and a
   `bitcore-lib-doge` signer that funds the PSBT with UTXOs from your wallet
   and signs the buyer-side inputs.
3. **Safety rails.** Daily spend cap, per-tx cap, dry-run mode, kill switch.

Until then, the dashboard's hit list is the actionable signal — click through
to doggy.market and buy manually before the listing disappears.

## Risks

- doggy.market's API is undocumented and can change without notice.
- Hot-wallet sniping = a private key on a server. Treat the host as compromised
  by default: small balances only, hardware-wallet-signed transfers in.
- Other snipers exist; latency to doggy.market matters.
