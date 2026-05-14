/**
 * Tests for src/lib/cron-auth.ts after the APP-005 hardening pass.
 *
 * The compare must be constant-time across:
 *   - equal-length strings that differ at any byte
 *   - length-mismatched strings (no early-exit on length)
 *
 * Functional correctness on the helper is what we actually unit-test
 * here; "constant time" is a property we trust the underlying
 * timingSafeEqual primitive to provide.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { constantTimeEquals, isAuthorizationHeaderValid } from '../cron-auth';

describe('constantTimeEquals — correctness', () => {
  it('returns true for identical strings', () => {
    expect(constantTimeEquals('abc123', 'abc123')).toBe(true);
    expect(constantTimeEquals('', '')).toBe(true);
  });

  it('returns false for strings that differ at byte 0', () => {
    expect(constantTimeEquals('xbc123', 'abc123')).toBe(false);
  });

  it('returns false for strings that differ at the last byte', () => {
    expect(constantTimeEquals('abc12X', 'abc123')).toBe(false);
  });

  it('returns false for length-mismatched strings (presented is shorter)', () => {
    expect(constantTimeEquals('abc', 'abc123')).toBe(false);
  });

  it('returns false for length-mismatched strings (presented is longer)', () => {
    expect(constantTimeEquals('abc123extra', 'abc123')).toBe(false);
  });

  it('handles multi-byte utf8 inputs', () => {
    expect(constantTimeEquals('café', 'café')).toBe(true);
    expect(constantTimeEquals('café', 'cafe')).toBe(false);
  });

  it('returns false against empty when expected has content', () => {
    expect(constantTimeEquals('', 'something')).toBe(false);
  });
});

describe('isAuthorizationHeaderValid — fail-closed posture', () => {
  const origCron = process.env.CRON_SECRET;
  const origPg = process.env.PG_CRON_TOKEN;

  afterEach(() => {
    if (origCron === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = origCron;
    if (origPg === undefined) delete process.env.PG_CRON_TOKEN; else process.env.PG_CRON_TOKEN = origPg;
  });

  it('rejects null / empty / missing header', () => {
    process.env.CRON_SECRET = 'shh-its-a-secret';
    expect(isAuthorizationHeaderValid(null)).toBe(false);
    expect(isAuthorizationHeaderValid('')).toBe(false);
    expect(isAuthorizationHeaderValid(undefined)).toBe(false);
  });

  it('rejects headers that do not start with "Bearer "', () => {
    process.env.CRON_SECRET = 'shh-its-a-secret';
    expect(isAuthorizationHeaderValid('shh-its-a-secret')).toBe(false);
    expect(isAuthorizationHeaderValid('Basic shh-its-a-secret')).toBe(false);
    expect(isAuthorizationHeaderValid('bearer shh-its-a-secret')).toBe(false); // case-sensitive
  });

  it('rejects "Bearer " with empty token', () => {
    process.env.CRON_SECRET = 'shh-its-a-secret';
    expect(isAuthorizationHeaderValid('Bearer ')).toBe(false);
    expect(isAuthorizationHeaderValid('Bearer    ')).toBe(false);
  });

  it('accepts a valid CRON_SECRET match', () => {
    process.env.CRON_SECRET = 'shh-its-a-secret';
    expect(isAuthorizationHeaderValid('Bearer shh-its-a-secret')).toBe(true);
  });

  it('accepts a valid PG_CRON_TOKEN match (either token works)', () => {
    process.env.CRON_SECRET = 'shh-its-a-secret';
    process.env.PG_CRON_TOKEN = 'pg-bearer-token';
    expect(isAuthorizationHeaderValid('Bearer pg-bearer-token')).toBe(true);
    expect(isAuthorizationHeaderValid('Bearer shh-its-a-secret')).toBe(true);
  });

  it('rejects when NO secrets are configured (fail closed)', () => {
    delete process.env.CRON_SECRET;
    delete process.env.PG_CRON_TOKEN;
    expect(isAuthorizationHeaderValid('Bearer literally-any-value')).toBe(false);
  });

  it('rejects when token is one byte short of the secret', () => {
    process.env.CRON_SECRET = 'shh-its-a-secret';
    expect(isAuthorizationHeaderValid('Bearer shh-its-a-secre')).toBe(false);
  });

  it('rejects when token is one byte longer than the secret', () => {
    process.env.CRON_SECRET = 'shh-its-a-secret';
    expect(isAuthorizationHeaderValid('Bearer shh-its-a-secretX')).toBe(false);
  });

  it('rejects when token differs at a single byte', () => {
    process.env.CRON_SECRET = 'shh-its-a-secret';
    expect(isAuthorizationHeaderValid('Bearer shh-its-a-Xecret')).toBe(false);
  });
});

