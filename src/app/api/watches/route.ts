import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { dogeToShibes, shibesToDoge } from '@/lib/units';
import { startPoller } from '@/lib/poller';

export const dynamic = 'force-dynamic';

// Lazily start the in-process poller on first request. In serverless deploys
// (Vercel), use POST /api/poll on a cron schedule instead.
startPoller();

const CreateWatch = z.object({
  slug: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/, 'slug must be lowercase-with-dashes'),
  maxPriceDoge: z.string().min(1),
});

export async function GET() {
  const watches = await prisma.watch.findMany({ orderBy: { createdAt: 'desc' } });
  return NextResponse.json(
    watches.map((w) => ({
      id: w.id,
      slug: w.slug,
      maxPriceDoge: shibesToDoge(w.maxPriceShibes),
      enabled: w.enabled,
      autoBuy: w.autoBuy,
    })),
  );
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = CreateWatch.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join('; ') },
      { status: 400 },
    );
  }

  let shibes: bigint;
  try {
    shibes = dogeToShibes(parsed.data.maxPriceDoge);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
  if (shibes <= 0n) {
    return NextResponse.json({ error: 'maxPriceDoge must be > 0' }, { status: 400 });
  }

  try {
    const w = await prisma.watch.create({
      data: { slug: parsed.data.slug, maxPriceShibes: shibes },
    });
    return NextResponse.json({ id: w.id }, { status: 201 });
  } catch (err: unknown) {
    if ((err as { code?: string }).code === 'P2002') {
      return NextResponse.json({ error: 'A watch for this slug already exists' }, { status: 409 });
    }
    throw err;
  }
}
