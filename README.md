# Doggy Sniper

A monitoring + auto-buy bot for [doggy.market](https://doggy.market) doginal NFT
collections. You configure max prices per collection; it polls doggy.market's
listings API and (optionally) auto-buys when a listing drops below your
threshold by signing a PSBT with a hot Dogecoin wallet.

## Status

- **Stage 1** — poll listings, record matches, web dashboard, optional Telegram
  alerts. Working.
- **Stage 2** — full auto-buy via the doggy.market `createBuyingPSBT` /
  `buyListing` flow with a local hot wallet. Built and unit-tested against
  synthetic Dogecoin transactions; needs a real on-chain test before trusting
  with significant funds.

## Stack

Next.js 14 (App Router) + TypeScript + Prisma + SQLite +
`bitcoinjs-lib` + `tiny-secp256k1` (configured for Dogecoin: `pubKeyHash=0x1e`,
`wif=0x9e`).

## Quick start

```bash
cp .env.example .env
npm install
npx prisma db push
npm run dev   # http://localhost:3000
```

## How it works

```
┌─────────────────────────┐
│  Watch (slug, maxPrice) │   user-configured rule
└────────────┬────────────┘
             │ every 5s
             ▼
┌─────────────────────────────────────┐
│ poller.ts                            │
│  GET /nfts/{slug}                    │   doggy.market API
│  → recentlyListed[] (price in shibes)│
└────────────┬────────────────────────┘
             │ price ≤ maxPriceShibes ?
             ▼
┌─────────────────────────┐    Telegram / console
│ Hit (DETECTED→NOTIFIED) │ ──────────────────────►
└────────────┬────────────┘
             │ watch.autoBuy && !settings.dryRun ?
             ▼
┌─────────────────────────────────────────────────────────┐
│ executor.ts                                              │
│  1. GET  /inscriptions/{id}      → listingId             │
│  2. POST /buyer/createBuyingPSBT → seller-pre-signed PSBT│
│  3. for each input where outScript == our P2PKH:         │
│       psbt.signInput(i, key); psbt.finalizeInput(i)      │
│  4. POST /buyer/buyListing { signedBuyingPSBTBase64 }    │
│  5. record txId on Hit (BOUGHT)                          │
└─────────────────────────────────────────────────────────┘
```

## Wallet & safety

- Private key is stored AES-256-GCM-encrypted with a scrypt-derived key. The
  passphrase never touches disk.
- Wallet is **locked on startup**. You must POST `/api/wallet/unlock` (or use
  the dashboard) to put the decrypted key in memory before auto-buy can fire.
- `Settings.dryRun` defaults to **true** — no transactions are submitted, only
  logged. Flip it via the dashboard or `PATCH /api/settings { dryRun: false }`
  when you're ready.
- `Settings.dailyCapShibes` caps total spend per rolling 24h. `0` = unlimited.
- Every buy is gated by a per-Hit lock so duplicate poll cycles can't
  double-submit.
- Live price is re-checked against `maxPriceShibes` right before signing — if
  the seller bumped the price, we skip.

## API surface

| route                          | what                                              |
| ------------------------------ | ------------------------------------------------- |
| `GET  /api/watches`            | list watches                                      |
| `POST /api/watches`            | `{ slug, maxPriceDoge }`                          |
| `PATCH /api/watches/[id]`      | `{ enabled?, autoBuy?, maxPriceDoge? }`           |
| `DELETE /api/watches/[id]`     | remove                                            |
| `GET  /api/hits`               | last 50 hits w/ status, txId, notes               |
| `POST /api/buy/[hitId]`        | manually trigger executor for one hit             |
| `POST /api/poll`               | external-cron-friendly trigger (use `POLL_SECRET`)|
| `GET/POST /api/wallet`         | status / setup `{ wif, passphrase }`              |
| `POST /api/wallet/unlock`      | `{ passphrase }` → key in memory                  |
| `POST /api/wallet/lock`        | wipe in-memory key                                |
| `GET/PATCH /api/settings`      | dryRun + dailyCapDoge                             |

## Going live — checklist

1. `npm run build && npm start` on a small VPS close to doggy.market
   (sniping latency matters).
2. Create the watch from the dashboard. Leave `autoBuy=off` and `dryRun=on`
   for the first hour.
3. Setup wallet with a fresh Dogecoin WIF holding only what you're willing to
   lose. Unlock with the passphrase.
4. Verify a few Hits land in the dashboard with `[DRY RUN]` notes — that
   means the full path (lookup → PSBT → sign) ran successfully.
5. Set `dailyCapDoge` to a sane number.
6. Flip `dryRun=off`. Toggle `autoBuy=on` for the watch.
7. Watch the first real buy carefully. Confirm txid lands on dogechain.info.

## Risks

- doggy.market's API is **undocumented**. Endpoints can change without
  notice and silently break the bot.
- Hot-wallet on a server = real risk. Treat the host as compromised by
  default. Small balances only.
- Other snipers exist. You will lose races on truly-cheap drops; don't chase.
- The `createBuyingPSBT` response shape (`buyingPSBTBase64` vs `psbtBase64`)
  is best-guess from observation. If the first real run fails with "no psbt
  in response", inspect the actual response and adjust `DoggyBuyingPSBT` in
  `src/types.ts`.

## Roadmap

- [ ] Replace SQLite with Postgres for multi-instance HA
- [ ] Per-collection floor-price tracker with auto-suggested max
- [ ] WebSocket push from server → dashboard instead of 5s poll
- [ ] Discord webhook in addition to Telegram



---

## Deploy to Fly.io (free tier)

Fly.io's free tier gives you 3 always-on shared VMs + 3GB persistent storage.
Unlike Vercel, Fly runs persistent processes — perfect for this bot's poller.

### 1. Install flyctl

```bash
# macOS:    brew install flyctl
# Linux:    curl -L https://fly.io/install.sh | sh
# Windows:  iwr https://fly.io/install.ps1 -useb | iex
```

### 2. Sign up & login

```bash
flyctl auth signup     # or: flyctl auth login
```

### 3. Configure your app

Edit `fly.toml`:
- Change `app = "doggy-sniper"` to a unique name (e.g. `app = "doggy-sniper-yourname"`)
- Pick a region close to doggy.market: `iad` (US-East) or `ewr` (NJ) is good

### 4. Create the app and persistent volume

```bash
flyctl launch --copy-config --no-deploy --name <your-app-name>
flyctl volumes create sniper_data --size 1 --region iad   # match primary_region
```

### 5. Set secrets (these are encrypted, never in git)

**REQUIRED**: a strong password to protect your dashboard from the public:
```bash
flyctl secrets set BASIC_AUTH_PASSWORD="$(openssl rand -base64 32)"
```
Save the password — you'll need it to log into the dashboard.

Optional Telegram alerts:
```bash
flyctl secrets set TELEGRAM_BOT_TOKEN="your-token"
flyctl secrets set TELEGRAM_CHAT_ID="your-chat-id"
```

### 6. Deploy

```bash
flyctl deploy
```

After ~2 minutes you'll get a URL like `https://doggy-sniper-yourname.fly.dev`.

Open it — your browser will prompt for credentials:
- **Username**: `admin` (any value works — only password is checked)
- **Password**: the `BASIC_AUTH_PASSWORD` you set

### 7. Use the dashboard

Same as local: setup wallet → unlock → add watches → toggle Auto-buy.

### Useful commands

```bash
flyctl logs                       # live logs
flyctl status                     # is it running?
flyctl ssh console                # shell into the VM
flyctl secrets list               # see which secrets are set (values hidden)
flyctl deploy                     # redeploy after code changes
flyctl scale memory 1024          # bump RAM if you watch many collections
flyctl machine restart            # restart (locks wallet — must re-unlock)
```

### Limits & costs (free tier)

| Resource | Free | Note |
|---|---|---|
| VMs | 3× shared-cpu-1x | We use 1 |
| RAM | 256MB-1GB per VM | 512MB plenty |
| Volume | 3GB total | We use 1GB |
| Outbound traffic | 160GB/mo | Way more than enough |

**Stays free** as long as you don't exceed these. Polling 1×/sec uses ~10MB/day of bandwidth.

### Security on a public deploy

- ✅ Dashboard requires basic auth (set above)
- ✅ Wallet locks on every deploy/restart — you must re-enter the passphrase
- ✅ Encrypted seed phrase only on the persistent volume (not in git, not in logs)
- ✅ HTTPS automatic (Fly's edge does TLS)
- ⚠️ Use a STRONG `BASIC_AUTH_PASSWORD` — anyone who guesses it can manipulate your watches/buys
- ⚠️ Use a STRONG wallet passphrase — anyone with the basic-auth password could try to brute force this
- ⚠️ Use a SEPARATE snipe wallet with limited funds — never your main DOGE holdings

### Latency

Fly.io VMs are in real datacenters — much faster than your home internet to
doggy.market (typically 50-150ms vs 200-400ms residential).
