import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { dogeToShibes, shibesToDoge } from '@/lib/units';

export const dynamic = 'force-dynamic';

const Patch = z.object({
  dryRun: z.boolean().optional(),
  dailyCapDoge: z.string().optional(), // "0" = unlimited
});

async function getOrCreate() {
  return prisma.settings.upsert({
    where: { id: 'default' },
    create: { id: 'default' },
    update: {},
  });
}

export async function GET() {
  const s = await getOrCreate();
  return NextResponse.json({
    dryRun: s.dryRun,
    dailyCapDoge: shibesToDoge(s.dailyCapShibes),
  });
}

export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = Patch.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid body' }, { status: 400 });

  const data: { dryRun?: boolean; dailyCapShibes?: bigint } = {};
  if (parsed.data.dryRun !== undefined) data.dryRun = parsed.data.dryRun;
  if (parsed.data.dailyCapDoge !== undefined) {
    try {
      data.dailyCapShibes = dogeToShibes(parsed.data.dailyCapDoge);
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 400 });
    }
  }
  await prisma.settings.upsert({
    where: { id: 'default' },
    create: { id: 'default', ...data },
    update: data,
  });
  return NextResponse.json({ ok: true });
}
