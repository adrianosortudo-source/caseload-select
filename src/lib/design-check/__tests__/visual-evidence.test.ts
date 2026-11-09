import { describe, expect, it } from 'vitest';
import { buildVisualReview, removeCapture } from '../visual-evidence';
import { VISUAL_AREAS, type VisualCapture } from '../visual-review-types';
const captures: VisualCapture[] = [{ id: 'desktop', available: true, mimeType: 'image/png', base64: 'abc', width: 100, height: 200, totalHeight: null }, { id: 'mobile', available: true, mimeType: 'image/png', base64: 'def', width: 50, height: 200, totalHeight: null }];
const areas = Object.fromEntries(VISUAL_AREAS.map(a => [a, 'assessed']));
const review = (id: string, pageKind = 'homepage') => ({ captureId: id, pageKind, areas, areaReasons: {} });
const finding = { captureId: 'desktop', area: 'hierarchy', section: 'Hero', element: 'Heading', observation: 'The heading overlaps the button.', consequence: 'The button may be hard to find.', change: 'Move the button below the heading so both remain visible.', priority: 'high', limitation: '' };
describe('visual evidence boundaries', () => {
 it('requires two fully assessed unclipped homepage captures for complete', () => {
  const result = buildVisualReview(captures, { viewportReviews: [review('desktop'), review('mobile')], findings: [finding], strengths: [] });
  expect(result.status).toBe('complete'); expect(result.findings).toHaveLength(1);
  removeCapture(result, 'desktop'); expect(result.status).toBe('partial'); expect(result.findings).toHaveLength(0);
 });
 it('rejects findings attached to challenge pages', () => {
  const result = buildVisualReview(captures, { viewportReviews: [review('desktop', 'challenge')], findings: [finding], strengths: [] });
  expect(result.status).toBe('unavailable'); expect(result.findings).toEqual([]);
 });
 it('does not claim visual assessment on model failure', () => {
  const result = buildVisualReview(captures); expect(result.status).toBe('unavailable'); expect(result.reasonCodes).toContain('vision_unavailable');
 });
 it('handles a desktop-only review without inventing mobile evidence', () => {
  const result = buildVisualReview([captures[0], { id: 'mobile', available: false, reason: 'capture_unavailable' }], { viewportReviews: [review('desktop')], findings: [], strengths: [] });
  expect(result.status).toBe('partial'); expect(result.reasonCodes).toContain('capture_unavailable');
 });
});
