import { describe, expect, it } from 'vitest';
import {
  isProspectActivityChannel,
  isProspectActivityKind,
  isProspectConversationStatus,
  isProspectDeliveryStatus,
  isProspectReplyDisposition,
  isProspectResponseKind,
  statusAfterActivity,
} from '@/lib/prospect-operations-types';

describe('prospect operations vocabulary', () => {
  it('accepts only the controlled status and activity values', () => {
    expect(isProspectConversationStatus('awaiting_reply')).toBe(true);
    expect(isProspectConversationStatus('contacted')).toBe(false);
    expect(isProspectActivityKind('human_reply')).toBe(true);
    expect(isProspectActivityKind('reply')).toBe(false);
    expect(isProspectActivityChannel('linkedin')).toBe(true);
    expect(isProspectActivityChannel('gmail')).toBe(false);
    expect(isProspectDeliveryStatus('bounced')).toBe(true);
    expect(isProspectDeliveryStatus('opened')).toBe(false);
    expect(isProspectResponseKind('automated')).toBe(true);
    expect(isProspectResponseKind('positive')).toBe(false);
    expect(isProspectReplyDisposition('positive')).toBe(true);
    expect(isProspectReplyDisposition('automated')).toBe(false);
  });

  it('distinguishes a human reply from an automated acknowledgement', () => {
    expect(statusAfterActivity('awaiting_reply', {
      kind: 'automated_reply',
      reply_disposition: 'unknown',
    })).toBe('awaiting_reply');

    expect(statusAfterActivity('awaiting_reply', {
      kind: 'human_reply',
      reply_disposition: 'positive',
    })).toBe('replied');
  });

  it('maps a declined human reply separately from a bounce', () => {
    expect(statusAfterActivity('awaiting_reply', {
      kind: 'human_reply',
      reply_disposition: 'declined',
    })).toBe('declined');

    expect(statusAfterActivity('awaiting_reply', {
      kind: 'bounce',
      reply_disposition: 'unknown',
    })).toBe('unreachable');
  });

  it('moves explicit outreach and meeting evidence to their supported states', () => {
    expect(statusAfterActivity('not_contacted', {
      kind: 'message_sent',
      reply_disposition: 'unknown',
    })).toBe('awaiting_reply');

    expect(statusAfterActivity('replied', {
      kind: 'meeting',
      reply_disposition: 'unknown',
    })).toBe('meeting_scheduled');

    expect(statusAfterActivity('replied', {
      kind: 'note',
      reply_disposition: 'unknown',
    })).toBe('replied');
  });
});
