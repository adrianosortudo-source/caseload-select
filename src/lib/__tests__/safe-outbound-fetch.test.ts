/**
 * Tests for src/lib/safe-outbound-fetch.ts — SSRF protections.
 *
 * Covers:
 *   - Pure isPrivateIp() classification (v4 + v6 ranges)
 *   - safeFetch scheme allow-list rejection
 *   - safeFetch malformed-URL rejection
 *   - DNS lookup failure handling
 *
 * Does NOT cover the actual fetch() round-trip — those tests would need
 * a real outbound network call. The blast-radius shape of the helper
 * (pre-flight blocking, then fetch passthrough) is what matters.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { safeFetch, isPrivateIp } from '../safe-outbound-fetch';

describe('isPrivateIp — IPv4 blocked ranges', () => {
  it('blocks 10.0.0.0/8', () => {
    expect(isPrivateIp('10.0.0.1', 4)).toBe(true);
    expect(isPrivateIp('10.255.255.255', 4)).toBe(true);
  });
  it('blocks 127.0.0.0/8 (loopback)', () => {
    expect(isPrivateIp('127.0.0.1', 4)).toBe(true);
    expect(isPrivateIp('127.50.0.1', 4)).toBe(true);
  });
  it('blocks 169.254.0.0/16 (AWS / GCP / Azure metadata)', () => {
    expect(isPrivateIp('169.254.169.254', 4)).toBe(true);
    expect(isPrivateIp('169.254.0.1', 4)).toBe(true);
  });
  it('blocks 172.16.0.0/12', () => {
    expect(isPrivateIp('172.16.0.1', 4)).toBe(true);
    expect(isPrivateIp('172.31.255.255', 4)).toBe(true);
  });
  it('does NOT block 172.15.x.x or 172.32.x.x (outside the /12 range)', () => {
    expect(isPrivateIp('172.15.0.1', 4)).toBe(false);
    expect(isPrivateIp('172.32.0.1', 4)).toBe(false);
  });
  it('blocks 192.168.0.0/16', () => {
    expect(isPrivateIp('192.168.0.1', 4)).toBe(true);
    expect(isPrivateIp('192.168.255.255', 4)).toBe(true);
  });
  it('blocks CGNAT 100.64.0.0/10', () => {
    expect(isPrivateIp('100.64.0.1', 4)).toBe(true);
    expect(isPrivateIp('100.127.255.255', 4)).toBe(true);
  });
  it('does NOT block 100.63.x.x or 100.128.x.x (outside CGNAT)', () => {
    expect(isPrivateIp('100.63.0.1', 4)).toBe(false);
    expect(isPrivateIp('100.128.0.1', 4)).toBe(false);
  });
  it('blocks documentation ranges (TEST-NET-1/2/3)', () => {
    expect(isPrivateIp('192.0.2.1', 4)).toBe(true);
    expect(isPrivateIp('198.51.100.1', 4)).toBe(true);
    expect(isPrivateIp('203.0.113.1', 4)).toBe(true);
  });
  it('blocks multicast (224.x.x.x - 239.x.x.x) and reserved (240+)', () => {
    expect(isPrivateIp('224.0.0.1', 4)).toBe(true);
    expect(isPrivateIp('239.255.255.255', 4)).toBe(true);
    expect(isPrivateIp('240.0.0.1', 4)).toBe(true);
  });
  it('allows public IPs', () => {
    expect(isPrivateIp('8.8.8.8', 4)).toBe(false);             // Google DNS
    expect(isPrivateIp('1.1.1.1', 4)).toBe(false);             // Cloudflare DNS
    expect(isPrivateIp('142.250.80.46', 4)).toBe(false);       // Google
    expect(isPrivateIp('151.101.1.69', 4)).toBe(false);        // Fastly
    expect(isPrivateIp('52.84.0.1', 4)).toBe(false);           // AWS public
  });
});

describe('isPrivateIp — IPv6 blocked ranges', () => {
  it('blocks ::1 (loopback)', () => {
    expect(isPrivateIp('::1', 6)).toBe(true);
  });
  it('blocks fc00::/7 (ULA)', () => {
    expect(isPrivateIp('fc00::1', 6)).toBe(true);
    expect(isPrivateIp('fd00::abcd', 6)).toBe(true);
  });
  it('blocks fe80::/10 (link-local)', () => {
    expect(isPrivateIp('fe80::1', 6)).toBe(true);
    expect(isPrivateIp('fe80::abcd:1234', 6)).toBe(true);
  });
  it('blocks ::ffff: IPv4-mapped private addresses', () => {
    expect(isPrivateIp('::ffff:169.254.169.254', 6)).toBe(true);
    expect(isPrivateIp('::ffff:10.0.0.1', 6)).toBe(true);
    expect(isPrivateIp('::ffff:127.0.0.1', 6)).toBe(true);
  });
  it('does NOT block public IPv6', () => {
    expect(isPrivateIp('2606:4700:4700::1111', 6)).toBe(false); // Cloudflare
    expect(isPrivateIp('2001:4860:4860::8888', 6)).toBe(false); // Google
  });
});

describe('safeFetch — pre-flight rejections', () => {
  it('rejects malformed URLs', async () => {
    const r = await safeFetch('not a url');
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('malformed');
  });

  it('rejects file:// scheme', async () => {
    const r = await safeFetch('file:///etc/passwd');
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/scheme.*not allowed/);
  });

  it('rejects gopher://', async () => {
    const r = await safeFetch('gopher://example.com/');
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/scheme.*not allowed/);
  });

  it('rejects ftp://', async () => {
    const r = await safeFetch('ftp://example.com/file');
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/scheme.*not allowed/);
  });

  it('rejects http://localhost (resolves to 127.0.0.1)', async () => {
    const r = await safeFetch('http://localhost/');
    expect(r.ok).toBe(false);
    // Either "private IP" (if localhost resolves) or "dns lookup failed"
    // depending on the test host's resolver setup. Both are correct denials.
    expect(r.reason).toMatch(/private IP|dns lookup failed/);
  });

  it('rejects http://127.0.0.1 (literal loopback)', async () => {
    const r = await safeFetch('http://127.0.0.1/');
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('private IP');
  });

  it('rejects http://169.254.169.254 (AWS / GCP metadata)', async () => {
    const r = await safeFetch('http://169.254.169.254/latest/meta-data/');
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('private IP');
  });

  it('rejects http://10.0.0.1', async () => {
    const r = await safeFetch('http://10.0.0.1/internal');
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('private IP');
  });

  it('rejects http://192.168.1.1', async () => {
    const r = await safeFetch('http://192.168.1.1/router-admin');
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('private IP');
  });
});
