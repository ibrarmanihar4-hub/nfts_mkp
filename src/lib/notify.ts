// Notifier: logs every event to the console, and pushes to Telegram if configured.
// Add Discord/email/etc. here later — keep the surface small.

import { shibesToDoge } from './units';

interface HitNotification {
  slug: string;
  inscriptionId: string;
  inscriptionNumber?: number | null;
  priceShibes: bigint;
  maxPriceShibes: bigint;
  sellerAddress: string;
}

export async function notifyHit(hit: HitNotification): Promise<void> {
  const priceDoge = shibesToDoge(hit.priceShibes);
  const maxDoge = shibesToDoge(hit.maxPriceShibes);
  const link = `https://doggy.market/nfts/${hit.slug}/${hit.inscriptionId}`;

  const line =
    `[HIT] ${hit.slug} #${hit.inscriptionNumber ?? '?'} ` +
    `${priceDoge} DOGE (max ${maxDoge}) seller=${hit.sellerAddress}`;
  console.log(line, link);

  await sendTelegram(
    `🎯 *Sniper hit*: \`${hit.slug}\`\n` +
      `Price *${priceDoge} DOGE* (max ${maxDoge})\n` +
      `Inscription \`${hit.inscriptionId}\`\n` +
      `[Open on doggy.market](${link})`,
  );
}

async function sendTelegram(text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;

  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'Markdown',
        disable_web_page_preview: false,
      }),
    });
  } catch (err) {
    console.error('telegram notify failed', err);
  }
}
