import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

// Stage 2 stub. Auto-buying a doginal NFT requires:
//   1. Calling doggy.market's (undocumented) buy-quote endpoint to get a PSBT
//      pre-signed by the seller. We need to capture this from the network tab
//      during a real test purchase before we can implement it.
//   2. Funding the PSBT with UTXOs from a hot wallet.
//   3. Signing buyer inputs with bitcore-lib-doge (or similar).
//   4. Broadcasting via doggy.market's submit endpoint OR a Dogecoin RPC node.
//
// Until that's wired up, this endpoint just marks the hit as BUYING/FAILED so
// the UI can show what *would* happen.
export async function POST(_req: NextRequest, { params }: { params: { hitId: string } }) {
  const hit = await prisma.hit.findUnique({ where: { id: params.hitId } });
  if (!hit) return NextResponse.json({ error: 'not found' }, { status: 404 });

  await prisma.hit.update({
    where: { id: hit.id },
    data: {
      status: 'FAILED',
      notes: 'Auto-buy not yet implemented — capture doggy.market buy flow first.',
    },
  });

  return NextResponse.json(
    { error: 'auto-buy not yet implemented (stage 2)' },
    { status: 501 },
  );
}
