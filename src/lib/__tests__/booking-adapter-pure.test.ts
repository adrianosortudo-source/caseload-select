import { describe, it, expect } from 'vitest';
import { resolveBookingConfig } from '@/lib/booking-adapter-pure';

describe('resolveBookingConfig', () => {
  it('resolves a valid cal_com config', () => {
    const result = resolveBookingConfig({ provider: 'cal_com', url: 'https://cal.com/drg-law/consult' });
    expect(result).toEqual({ configured: true, provider: 'cal_com', url: 'https://cal.com/drg-law/consult' });
  });

  it('is not configured for an empty object (the default for every firm)', () => {
    expect(resolveBookingConfig({})).toEqual({ configured: false });
  });

  it('is not configured for null or undefined', () => {
    expect(resolveBookingConfig(null)).toEqual({ configured: false });
    expect(resolveBookingConfig(undefined)).toEqual({ configured: false });
  });

  it('is not configured for a non-object value', () => {
    expect(resolveBookingConfig('https://cal.com/x')).toEqual({ configured: false });
    expect(resolveBookingConfig(42)).toEqual({ configured: false });
  });

  it('is not configured for an unknown provider', () => {
    expect(resolveBookingConfig({ provider: 'calendly', url: 'https://calendly.com/x' })).toEqual({ configured: false });
  });

  it('is not configured when url is missing', () => {
    expect(resolveBookingConfig({ provider: 'cal_com' })).toEqual({ configured: false });
  });

  it('is not configured when url is not a string', () => {
    expect(resolveBookingConfig({ provider: 'cal_com', url: 123 })).toEqual({ configured: false });
  });

  it('is not configured for a non-https url (fails closed on scheme)', () => {
    expect(resolveBookingConfig({ provider: 'cal_com', url: 'http://cal.com/x' })).toEqual({ configured: false });
    expect(resolveBookingConfig({ provider: 'cal_com', url: 'javascript:alert(1)' })).toEqual({ configured: false });
  });

  it('is not configured for a malformed url string', () => {
    expect(resolveBookingConfig({ provider: 'cal_com', url: 'not a url' })).toEqual({ configured: false });
  });
});
