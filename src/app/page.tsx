'use client';

import { useEffect, useState } from 'react';

interface Watch {
  id: string;
  slug: string;
  maxPriceDoge: string;
  enabled: boolean;
  autoBuy: boolean;
}
interface Hit {
  id: string;
  slug: string;
  inscriptionId: string;
  inscriptionNumber: number | null;
  priceDoge: string;
  sellerAddress: string;
  listedAt: string;
  detectedAt: string;
  status: string;
  txId: string | null;
  notes: string | null;
}
interface WalletInfo {
  configured: boolean;
  unlocked: boolean;
  address: string | null;
}
interface SettingsInfo {
  dryRun: boolean;
  dailyCapDoge: string;
}

export default function Home() {
  const [watches, setWatches] = useState<Watch[]>([]);
  const [hits, setHits] = useState<Hit[]>([]);
  const [wallet, setWallet] = useState<WalletInfo | null>(null);
  const [settings, setSettings] = useState<SettingsInfo | null>(null);
  const [slug, setSlug] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const [w, h, wal, s] = await Promise.all([
      fetch('/api/watches').then((r) => r.json()),
      fetch('/api/hits').then((r) => r.json()),
      fetch('/api/wallet').then((r) => r.json()),
      fetch('/api/settings').then((r) => r.json()),
    ]);
    setWatches(w);
    setHits(h);
    setWallet(wal);
    setSettings(s);
  }

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, []);

  async function addWatch(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch('/api/watches', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slug: slug.trim(), maxPriceDoge: maxPrice.trim() }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.error ?? `Failed (${res.status})`);
        return;
      }
      setSlug('');
      setMaxPrice('');
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function patchWatch(w: Watch, body: Partial<Watch>) {
    await fetch(`/api/watches/${w.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    await refresh();
  }

  async function deleteWatch(w: Watch) {
    if (!confirm(`Delete watch for ${w.slug}?`)) return;
    await fetch(`/api/watches/${w.id}`, { method: 'DELETE' });
    await refresh();
  }

  async function buyHit(h: Hit) {
    if (!confirm(`Buy ${h.slug} #${h.inscriptionNumber} for ${h.priceDoge} DOGE?`)) return;
    const res = await fetch(`/api/buy/${h.id}`, { method: 'POST' });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) alert(`Buy failed: ${j.error ?? res.status}`);
    else if (j.dryRun) alert('Dry run — no transaction submitted. See hit notes.');
    else if (j.txId) alert(`Submitted! txid: ${j.txId}`);
    await refresh();
  }

  return (
    <div className="container">
      <h1>🎯 Doggy Sniper</h1>
      <p className="subtitle">
        Auto-monitor doggy.market collections and snipe listings below your max price.
      </p>

      <WalletPanel wallet={wallet} settings={settings} onChange={refresh} />

      <h2>Add watch</h2>
      <div className="panel">
        <form onSubmit={addWatch} className="row">
          <input
            placeholder="collection slug (e.g. doginal-primes)"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            style={{ flex: 1, minWidth: 240 }}
            required
          />
          <input
            placeholder="max price in DOGE"
            value={maxPrice}
            onChange={(e) => setMaxPrice(e.target.value)}
            style={{ width: 180 }}
            required
            inputMode="decimal"
          />
          <button type="submit" disabled={busy}>
            {busy ? 'Adding…' : 'Add watch'}
          </button>
        </form>
      </div>

      <h2>Watches ({watches.length})</h2>
      <div className="panel" style={{ padding: 0 }}>
        {watches.length === 0 ? (
          <div className="empty">No watches yet. Add one above.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Collection</th>
                <th>Max price</th>
                <th>Status</th>
                <th>Auto-buy</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {watches.map((w) => (
                <tr key={w.id}>
                  <td>
                    <a
                      href={`https://doggy.market/nfts/${w.slug}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {w.slug}
                    </a>
                  </td>
                  <td>{w.maxPriceDoge} DOGE</td>
                  <td>
                    <span className={`badge ${w.enabled ? 'good' : 'muted'}`}>
                      {w.enabled ? 'enabled' : 'paused'}
                    </span>
                  </td>
                  <td>
                    <label className="row" style={{ gap: 6 }}>
                      <input
                        type="checkbox"
                        checked={w.autoBuy}
                        onChange={(e) => patchWatch(w, { autoBuy: e.target.checked })}
                      />
                      <span className="badge muted">{w.autoBuy ? 'on' : 'off'}</span>
                    </label>
                  </td>
                  <td className="row" style={{ justifyContent: 'flex-end' }}>
                    <button
                      className="secondary"
                      onClick={() => patchWatch(w, { enabled: !w.enabled })}
                    >
                      {w.enabled ? 'Pause' : 'Resume'}
                    </button>
                    <button className="danger" onClick={() => deleteWatch(w)}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <h2>Recent hits ({hits.length})</h2>
      <div className="panel" style={{ padding: 0 }}>
        {hits.length === 0 ? (
          <div className="empty">No matching listings detected yet.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Collection</th>
                <th>Inscription</th>
                <th>Price</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {hits.map((h) => (
                <tr key={h.id}>
                  <td>{new Date(h.detectedAt).toLocaleString()}</td>
                  <td>{h.slug}</td>
                  <td className="mono">
                    <a
                      href={`https://doggy.market/nfts/${h.slug}/${h.inscriptionId}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      #{h.inscriptionNumber ?? '?'}
                    </a>
                  </td>
                  <td>{h.priceDoge} DOGE</td>
                  <td>
                    <span className={`badge ${badgeClass(h.status)}`}>{h.status}</span>
                    {h.txId && (
                      <>
                        {' '}
                        <a
                          href={`https://dogechain.info/tx/${h.txId}`}
                          target="_blank"
                          rel="noreferrer"
                          className="mono"
                          style={{ fontSize: 11 }}
                        >
                          tx
                        </a>
                      </>
                    )}
                    {h.notes && (
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>{h.notes}</div>
                    )}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {(h.status === 'NOTIFIED' || h.status === 'FAILED' || h.status === 'SKIPPED') && (
                      <button className="secondary" onClick={() => buyHit(h)}>
                        Buy now
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function badgeClass(status: string): string {
  if (status === 'BOUGHT') return 'good';
  if (status === 'FAILED') return 'bad';
  return 'muted';
}

function WalletPanel({
  wallet,
  settings,
  onChange,
}: {
  wallet: WalletInfo | null;
  settings: SettingsInfo | null;
  onChange: () => void;
}) {
  const [wif, setWif] = useState('');
  const [mnemonic, setMnemonic] = useState('');
  const [keyMode, setKeyMode] = useState<'mnemonic' | 'wif'>('mnemonic');
  const [pass, setPass] = useState('');
  const [unlockPass, setUnlockPass] = useState('');
  const [dailyCap, setDailyCap] = useState('');

  if (!wallet || !settings) return null;

  async function setup() {
    const key = keyMode === 'mnemonic' ? mnemonic.trim() : wif.trim();
    if (!key || pass.length < 8) return alert('Provide key + passphrase (8+ chars)');
    if (!confirm('Save encrypted key? Existing key will be overwritten.')) return;
    const payload = keyMode === 'mnemonic'
      ? { mnemonic: key, passphrase: pass }
      : { wif: key, passphrase: pass };
    const res = await fetch('/api/wallet', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const j = await res.json();
    if (!res.ok) return alert(j.error ?? 'failed');
    alert(`Saved. Address: ${j.address}`);
    setWif('');
    setMnemonic('');
    setPass('');
    onChange();
  }

  async function unlock() {
    const res = await fetch('/api/wallet/unlock', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ passphrase: unlockPass }),
    });
    const j = await res.json();
    if (!res.ok) return alert(j.error ?? 'failed');
    setUnlockPass('');
    onChange();
  }

  async function lock() {
    await fetch('/api/wallet/lock', { method: 'POST' });
    onChange();
  }

  async function toggleDryRun() {
    await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dryRun: !settings!.dryRun }),
    });
    onChange();
  }

  async function saveCap() {
    await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dailyCapDoge: dailyCap || '0' }),
    });
    setDailyCap('');
    onChange();
  }

  async function prepareWallet() {
    if (!confirm('This will broadcast a TX (~0.5 DOGE fee) to create dummy UTXOs needed for buying. Continue?')) return;
    const res = await fetch('/api/wallet/prepare', { method: 'POST' });
    const j = await res.json();
    if (!res.ok) return alert(j.error ?? 'failed');
    if (j.canForce) {
      const doForce = confirm(j.message + '\n\nForce re-prepare with higher fee?');
      if (doForce) {
        const res2 = await fetch('/api/wallet/prepare?force=true', { method: 'POST' });
        const j2 = await res2.json();
        if (!res2.ok) return alert(j2.error ?? 'failed');
        alert(j2.message ?? `Done! txId: ${j2.txId}`);
      }
      return;
    }
    alert(j.message ?? `Done! txId: ${j.txId}`);
  }

  return (
    <>
      <h2>Wallet & safety</h2>
      <div className="panel">
        <div className="row" style={{ marginBottom: 12, justifyContent: 'space-between' }}>
          <div>
            <div>
              <span className="badge muted">address</span>{' '}
              <span className="mono">{wallet.address ?? '— not configured —'}</span>
            </div>
            <div style={{ marginTop: 4 }}>
              <span className={`badge ${wallet.unlocked ? 'good' : 'bad'}`}>
                {wallet.unlocked ? 'unlocked' : wallet.configured ? 'locked' : 'not configured'}
              </span>{' '}
              <span className={`badge ${settings.dryRun ? 'muted' : 'bad'}`}>
                {settings.dryRun ? 'DRY RUN' : 'LIVE'}
              </span>{' '}
              <span className="badge muted">
                daily cap:{' '}
                {settings.dailyCapDoge === '0' ? 'unlimited' : `${settings.dailyCapDoge} DOGE`}
              </span>
            </div>
          </div>
          <div className="row">
            <button className="secondary" onClick={toggleDryRun}>
              {settings.dryRun ? 'Go live' : 'Enable dry run'}
            </button>
            {wallet.unlocked && (
              <button className="secondary" onClick={lock}>
                Lock
              </button>
            )}
          </div>
        </div>

        {!wallet.configured ? (
          <div>
            <div className="row" style={{ marginBottom: 8 }}>
              <button
                className={keyMode === 'mnemonic' ? '' : 'secondary'}
                onClick={() => setKeyMode('mnemonic')}
                type="button"
                style={{ fontSize: 12, padding: '4px 10px' }}
              >
                Seed phrase
              </button>
              <button
                className={keyMode === 'wif' ? '' : 'secondary'}
                onClick={() => setKeyMode('wif')}
                type="button"
                style={{ fontSize: 12, padding: '4px 10px' }}
              >
                WIF key
              </button>
            </div>
            <div className="row">
              {keyMode === 'mnemonic' ? (
                <input
                  placeholder="12 or 24-word seed phrase"
                  value={mnemonic}
                  onChange={(e) => setMnemonic(e.target.value)}
                  style={{ flex: 1, minWidth: 240 }}
                  type="password"
                />
              ) : (
                <input
                  placeholder="Dogecoin WIF private key (Q… or 6…)"
                  value={wif}
                  onChange={(e) => setWif(e.target.value)}
                  style={{ flex: 1, minWidth: 240 }}
                  type="password"
                />
              )}
              <input
                placeholder="passphrase (8+ chars)"
                value={pass}
                onChange={(e) => setPass(e.target.value)}
                style={{ width: 220 }}
                type="password"
              />
              <button onClick={setup}>Save encrypted</button>
            </div>
          </div>
        ) : !wallet.unlocked ? (
          <div className="row">
            <input
              placeholder="passphrase to unlock"
              value={unlockPass}
              onChange={(e) => setUnlockPass(e.target.value)}
              style={{ flex: 1, minWidth: 240 }}
              type="password"
            />
            <button onClick={unlock}>Unlock</button>
          </div>
        ) : (
          <div>
            <div className="row" style={{ marginBottom: 8 }}>
              <input
                placeholder={`daily cap in DOGE (current: ${settings.dailyCapDoge}; 0 = unlimited)`}
                value={dailyCap}
                onChange={(e) => setDailyCap(e.target.value)}
                style={{ flex: 1, minWidth: 240 }}
                inputMode="decimal"
              />
              <button className="secondary" onClick={saveCap}>
                Save cap
              </button>
              <button className="secondary" onClick={prepareWallet}>
                Prepare dummy UTXOs
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
