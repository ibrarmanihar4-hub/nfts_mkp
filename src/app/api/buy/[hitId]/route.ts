import { NextRequest, NextResponse } from 'next/server';
import { executeBuy } from '@/lib/executor';

export const dynamic = 'force-dynamic';

// Manual buy trigger from the dashboard. Same code path as auto-buy.
export async function POST(_req: NextRequest, { params }: { params: { hitId: string } }) {
  const result = await executeBuy(params.hitId);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
