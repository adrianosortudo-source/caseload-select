import { describe, expect, it } from 'vitest';
import { isPrivacyRecoveryProtectedPath, recoveryCircuitIsOpen } from '../lib/privacy-recovery-edge';

describe('privacy recovery middleware gate', () => {
  it('protects operational SSR/API paths while leaving public, static, and recovery routes available', () => {
    expect(isPrivacyRecoveryProtectedPath('/admin/firms')).toBe(true);
    expect(isPrivacyRecoveryProtectedPath('/portal/firm-1')).toBe(true);
    expect(isPrivacyRecoveryProtectedPath('/api/admin/firms')).toBe(true);
    expect(isPrivacyRecoveryProtectedPath('/')).toBe(false);
    expect(isPrivacyRecoveryProtectedPath('/widget-public/firm-1')).toBe(false);
    expect(isPrivacyRecoveryProtectedPath('/_next/static/chunk.js')).toBe(false);
    expect(isPrivacyRecoveryProtectedPath('/api/internal/privacy-recovery')).toBe(false);
  });

  it('accepts both Upstash object and serialized-string circuit records', () => {
    expect(recoveryCircuitIsOpen({ state: 'open' })).toBe(true);
    expect(recoveryCircuitIsOpen(JSON.stringify({ state: 'open' }))).toBe(true);
    expect(recoveryCircuitIsOpen('open')).toBe(false);
    expect(recoveryCircuitIsOpen({ state: 'locked' })).toBe(false);
  });
});
