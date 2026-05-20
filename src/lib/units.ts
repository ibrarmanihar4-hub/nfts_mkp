// Conversions between DOGE (display) and shibes (1 DOGE = 100,000,000 shibes).
// We store everything in shibes as BigInt to avoid floating-point drift on prices.

export const SHIBES_PER_DOGE = 100_000_000n;

export function dogeToShibes(doge: number | string): bigint {
  const s = String(doge).trim();
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error(`Invalid DOGE amount: ${doge}`);
  const [whole, frac = ''] = s.split('.');
  const fracPadded = (frac + '00000000').slice(0, 8);
  return BigInt(whole) * SHIBES_PER_DOGE + BigInt(fracPadded || '0');
}

export function shibesToDoge(shibes: bigint | number): string {
  const b = typeof shibes === 'bigint' ? shibes : BigInt(shibes);
  const whole = b / SHIBES_PER_DOGE;
  const frac = b % SHIBES_PER_DOGE;
  if (frac === 0n) return whole.toString();
  return `${whole}.${frac.toString().padStart(8, '0').replace(/0+$/, '')}`;
}
