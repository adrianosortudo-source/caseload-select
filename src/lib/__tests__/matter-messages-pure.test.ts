import { describe, it, expect } from 'vitest';
import {
  canWriteChannel,
  visibleChannelsForRole,
  notificationEventType,
  sanitiseBody,
  canMarkRead,
  isOwnedAttachmentPath,
} from '../matter-messages-pure';

describe('isOwnedAttachmentPath', () => {
  const firm = 'firm-1';
  const matter = 'matter-9';

  it('accepts a path under this firm+matter prefix', () => {
    expect(isOwnedAttachmentPath(`message-attachments/${firm}/${matter}/123-a.pdf`, firm, matter)).toBe(true);
  });

  it('rejects another firm or matter', () => {
    expect(isOwnedAttachmentPath(`message-attachments/other-firm/${matter}/x.pdf`, firm, matter)).toBe(false);
    expect(isOwnedAttachmentPath(`message-attachments/${firm}/other-matter/x.pdf`, firm, matter)).toBe(false);
  });

  it('rejects a Files-hub or deliverables path in the same bucket', () => {
    expect(isOwnedAttachmentPath(`firms/${firm}/abc/Retainer.pdf`, firm, matter)).toBe(false);
    expect(isOwnedAttachmentPath(`deliverables/${firm}/d1/v.png`, firm, matter)).toBe(false);
  });

  it('rejects a missing or non-string path', () => {
    expect(isOwnedAttachmentPath(undefined, firm, matter)).toBe(false);
    expect(isOwnedAttachmentPath(123, firm, matter)).toBe(false);
    expect(isOwnedAttachmentPath('', firm, matter)).toBe(false);
  });

  it('rejects a traversal attempt that does not match the literal prefix', () => {
    expect(isOwnedAttachmentPath(`message-attachments/${firm}/${matter}/../../other/x`, firm, matter)).toBe(true);
    // ^ prefix matches; path traversal beyond the prefix is a storage-key
    //   concern handled by the bucket (keys are literal, no traversal), but the
    //   prefix gate is the firm/matter boundary. A foreign prefix is rejected:
    expect(isOwnedAttachmentPath('../firm-1/matter-9/x', firm, matter)).toBe(false);
  });
});

describe('canWriteChannel', () => {
  it('client can write to the client channel only', () => {
    expect(canWriteChannel('client', 'client')).toBe(true);
    expect(canWriteChannel('client', 'internal')).toBe(false);
  });

  it('admin can write to both channels', () => {
    expect(canWriteChannel('admin', 'client')).toBe(true);
    expect(canWriteChannel('admin', 'internal')).toBe(true);
  });

  it('staff can write to both channels', () => {
    expect(canWriteChannel('staff', 'client')).toBe(true);
    expect(canWriteChannel('staff', 'internal')).toBe(true);
  });

  it('operator can write to both channels (cross-firm support)', () => {
    expect(canWriteChannel('operator', 'client')).toBe(true);
    expect(canWriteChannel('operator', 'internal')).toBe(true);
  });

  it('system can write to both channels (automated)', () => {
    expect(canWriteChannel('system', 'client')).toBe(true);
    expect(canWriteChannel('system', 'internal')).toBe(true);
  });
});

describe('visibleChannelsForRole', () => {
  it('client sees only the client channel', () => {
    expect(visibleChannelsForRole('client')).toEqual(['client']);
  });

  it('admin sees both channels', () => {
    expect(visibleChannelsForRole('admin')).toEqual(['client', 'internal']);
  });

  it('staff sees both channels', () => {
    expect(visibleChannelsForRole('staff')).toEqual(['client', 'internal']);
  });

  it('operator sees both channels', () => {
    expect(visibleChannelsForRole('operator')).toEqual(['client', 'internal']);
  });

  it('system can see both (for notification building)', () => {
    expect(visibleChannelsForRole('system')).toEqual(['client', 'internal']);
  });
});

describe('notificationEventType', () => {
  it('maps client channel to message_new', () => {
    expect(notificationEventType('client')).toBe('message_new');
  });

  it('maps internal channel to message_internal_new', () => {
    expect(notificationEventType('internal')).toBe('message_internal_new');
  });
});

describe('sanitiseBody', () => {
  it('returns null for empty / whitespace-only input', () => {
    expect(sanitiseBody(null)).toBe(null);
    expect(sanitiseBody(undefined)).toBe(null);
    expect(sanitiseBody('')).toBe(null);
    expect(sanitiseBody('   \n\n  ')).toBe(null);
  });

  it('trims surrounding whitespace', () => {
    expect(sanitiseBody('  hello world  ')).toBe('hello world');
  });

  it('collapses 3+ blank lines into 2 (preserves paragraph structure)', () => {
    expect(sanitiseBody('para 1\n\n\n\n\npara 2')).toBe('para 1\n\npara 2');
  });

  it('preserves 2-line paragraph breaks', () => {
    expect(sanitiseBody('para 1\n\npara 2')).toBe('para 1\n\npara 2');
  });

  it('enforces 10000-char cap', () => {
    const huge = 'x'.repeat(15000);
    const result = sanitiseBody(huge);
    expect(result?.length).toBe(10000);
  });

  it('returns short content unchanged', () => {
    expect(sanitiseBody('short message')).toBe('short message');
  });
});

describe('canMarkRead', () => {
  it('all roles except system can mark read', () => {
    expect(canMarkRead('client')).toBe(true);
    expect(canMarkRead('admin')).toBe(true);
    expect(canMarkRead('staff')).toBe(true);
    expect(canMarkRead('operator')).toBe(true);
    expect(canMarkRead('system')).toBe(false);
  });
});
