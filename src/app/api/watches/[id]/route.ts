import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { dogeToShibes } from '@/lib/units';

export const dynamic = 'force-dynamic';

const PatchWatch = z.object({
  enabled: z.boolean().optional(),
  autoBuy: z.boolean().optional(),
  maxPriceDoge: z.string().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => null);
  const parsed = PatchWatch.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }

  const data: { enabled?: boolean; autoBuy?: boolean; maxPriceShibes?: bigint } = {};
  if (parsed.data.enabled !== undefined) data.enabled = parsed.data.enabled;
  if (parsed.data.autoBuy !== undefined) data.autoBuy = parsed.data.autoBuy;
  if (parsed.data.maxPriceDoge !== undefined) {
    try {
      data.maxPriceShibes = dogeToShibes(parsed.data.maxPriceDoge);
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 400 });
    }
  }

  await prisma.watch.update({ where: { id: params.id }, data });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  await prisma.watch.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
