'use client';

import { useEffect, useState } from 'react';

interface Watch {
  id: string;
  slug: string;
  maxPriceDoge: string;
  enabled: boolean;
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
}

export default function Home() {
  const [watches, setWatches] = useState<Watch[]>([]);
  const [hits, setHits] = useState<Hit[]>([]);
  const [slug, setSlug] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const [w, h] = await Promise.all([
      fetch('/api/watches').then((r) => r.json()),
      fetch('/api/hits').then((r) => r.json()),
    ]);
    setWatches(w);
    setHits(h);
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

  async function toggleWatch(w: Watch) {
    await fetch(`/api/watches/${w.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: !w.enabled }),
    });
    await refresh();
  }

  async function deleteWatch(w: Watch) {
    if (!confirm(`Delete watch for ${w.slug}?`)) return;
    await fetch(`/api/watches/${w.id}`, { method: 'DELETE' });
    await refresh();
  }

  return (
    <div className="container">
      <h1>🎯 Doggy Sniper</h1>
      <p className="subtitle">
        Auto-monitor doggy.market collections. Get alerted (and eventually auto-buy) when a
        listing drops below your max price.
      </p>

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
                  <td className="row" style={{ justifyContent: 'flex-end' }}>
                    <button className="secondary" onClick={() => toggleWatch(w)}>
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
                    <span className="badge muted">{h.status}</span>
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
