import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { shibesToDoge } from '@/lib/units';

export const dynamic = 'force-dynamic';

export async function GET() {
  const hits = await prisma.hit.findMany({
    orderBy: { detectedAt: 'desc' },
    take: 50,
    include: { watch: true },
  });

  return NextResponse.json(
    hits.map((h) => ({
      id: h.id,
      slug: h.watch.slug,
      inscriptionId: h.inscriptionId,
      inscriptionNumber: h.inscriptionNumber,
      priceDoge: shibesToDoge(h.priceShibes),
      sellerAddress: h.sellerAddress,
      listedAt: h.listedAt,
      detectedAt: h.detectedAt,
      status: h.status,
    })),
  );
}
