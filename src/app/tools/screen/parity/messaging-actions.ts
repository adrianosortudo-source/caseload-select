'use server';

import { headers } from 'next/headers';
import { checkRateLimit, ipFromHeaders } from '@/lib/rate-limit';
import { runFictionalMessage, type MessagingCursor, type ParityReport } from '@/lib/screen-parity-messaging';
import { screenParityPreviewEnabled } from '@/lib/screen-parity-preview-enabled';
import type { MetaChannel } from '@/lib/channel-intake-processor';
import type { PracticeArea } from '@/lib/screen-engine/types';

export interface MessagingTurn {
  replies: string[];
  advance?: (text: string) => Promise<MessagingTurn>;
  report?: ParityReport;
  error?: string;
}

const areas = new Set(['corporate', 'real_estate', 'employment', 'estates', 'family']);
const channels = new Set(['whatsapp', 'instagram', 'facebook']);

async function step(cursor: MessagingCursor, input: string): Promise<MessagingTurn> {
  if (!screenParityPreviewEnabled()) return { replies: [], error: 'Preview unavailable.' };
  if (Date.now() > cursor.expires || cursor.turns >= 40) return { replies: [], error: 'Start a new enquiry to continue.' };
  const text = typeof input === 'string' ? input.trim() : '';
  if (!text || text.length > 4000) return { replies: [], error: 'Enter a message of up to 4,000 characters.' };
  const limit = await checkRateLimit('extract', ipFromHeaders(await headers()));
  if (!limit.ok) return { replies: [], error: limit.active
    ? 'The preview has reached its request limit. Please try again later.'
    : 'The AI preview is unavailable. Your message has not been processed.' };

  const result = await runFictionalMessage(cursor, text);
  if (result.unavailable) return { replies: [], error: 'AI is unavailable. Please retry your message.' };
  if (result.ended) return { replies: result.replies, report: result.report };

  // Next encrypts the captured cursor in this Server Action reference; instances
  // on the same deployment can resume a turn without a database or a channel send.
  const nextCursor = result.cursor;
  async function advance(nextText: string): Promise<MessagingTurn> {
    'use server';
    return step(nextCursor, nextText);
  }
  return { replies: result.replies, advance };
}

export async function startMessaging(channel: MetaChannel, practiceArea: string, text: string): Promise<MessagingTurn> {
  if (!channels.has(channel) || !areas.has(practiceArea)) return { replies: [], error: 'Choose a practice area and channel.' };
  return step({ channel, practiceArea: practiceArea as PracticeArea, session: null, turns: 0, expires: Date.now() + 3600000 }, text);
}
