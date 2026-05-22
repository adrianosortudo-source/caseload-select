import { describe, it, expect } from 'vitest';
import {
  canWriteChannel,
  visibleChannelsForRole,
  notificationEventType,
  sanitiseBody,
  canMarkRead,
} from '../matter-messages-pure';

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
