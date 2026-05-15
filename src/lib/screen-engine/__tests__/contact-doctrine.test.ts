/**
 * Contact-capture doctrine helper tests.
 *
 * The doctrine: name AND (email OR phone). Anything else is unconfirmed.
 */

import { describe, it, expect } from 'vitest';
import {
  evaluateContactGate,
  isContactComplete,
} from '../contact-doctrine';

describe('evaluateContactGate', () => {
  it('returns complete=true for name + email', () => {
    const r = evaluateContactGate({
      client_name: 'Alex Lee',
      client_email: 'alex@example.com',
      client_phone: null,
    });
    expect(r.complete).toBe(true);
    expect(r.hasName).toBe(true);
    expect(r.hasEmail).toBe(true);
    expect(r.hasPhone).toBe(false);
    expect(r.missing).toBeNull();
  });

  it('returns complete=true for name + phone', () => {
    const r = evaluateContactGate({
      client_name: 'Alex Lee',
      client_email: null,
      client_phone: '+1 416 555 0143',
    });
    expect(r.complete).toBe(true);
    expect(r.hasPhone).toBe(true);
    expect(r.hasEmail).toBe(false);
  });

  it('returns complete=true for name + both', () => {
    const r = evaluateContactGate({
      client_name: 'Alex Lee',
      client_email: 'alex@example.com',
      client_phone: '+1 416 555 0143',
    });
    expect(r.complete).toBe(true);
  });

  it('returns missing=name when name is empty', () => {
    const r = evaluateContactGate({
      client_name: '',
      client_email: 'alex@example.com',
      client_phone: null,
    });
    expect(r.complete).toBe(false);
    expect(r.missing).toBe('name');
  });

  it('returns missing=name when name is whitespace only', () => {
    const r = evaluateContactGate({
      client_name: '   ',
      client_email: 'alex@example.com',
      client_phone: null,
    });
    expect(r.complete).toBe(false);
    expect(r.missing).toBe('name');
  });

  it('returns missing=reachability when name present but email AND phone empty', () => {
    const r = evaluateContactGate({
      client_name: 'Alex Lee',
      client_email: null,
      client_phone: null,
    });
    expect(r.complete).toBe(false);
    expect(r.missing).toBe('reachability');
  });

  it('returns missing=both when name, email, and phone all empty', () => {
    const r = evaluateContactGate({
      client_name: null,
      client_email: null,
      client_phone: null,
    });
    expect(r.complete).toBe(false);
    expect(r.missing).toBe('both');
  });

  it('rejects a malformed email (no @)', () => {
    const r = evaluateContactGate({
      client_name: 'Alex Lee',
      client_email: 'not-an-email',
      client_phone: null,
    });
    expect(r.hasEmail).toBe(false);
    expect(r.complete).toBe(false);
    expect(r.missing).toBe('reachability');
  });

  it('rejects a too-short phone (under 7 digits)', () => {
    const r = evaluateContactGate({
      client_name: 'Alex Lee',
      client_email: null,
      client_phone: '12345',
    });
    expect(r.hasPhone).toBe(false);
    expect(r.complete).toBe(false);
  });

  it('accepts a phone with formatting characters', () => {
    const r = evaluateContactGate({
      client_name: 'Alex Lee',
      client_email: null,
      client_phone: '(416) 555-0143',
    });
    expect(r.hasPhone).toBe(true);
    expect(r.complete).toBe(true);
  });

  it('handles undefined fields the same as null', () => {
    const r = evaluateContactGate({});
    expect(r.complete).toBe(false);
    expect(r.missing).toBe('both');
  });
});

describe('isContactComplete', () => {
  it('matches evaluateContactGate.complete', () => {
    expect(isContactComplete({ client_name: 'A', client_email: 'a@b.co', client_phone: null })).toBe(true);
    expect(isContactComplete({ client_name: null, client_email: 'a@b.co', client_phone: null })).toBe(false);
    expect(isContactComplete({ client_name: 'A', client_email: null, client_phone: null })).toBe(false);
  });
});
