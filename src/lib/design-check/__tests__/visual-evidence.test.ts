import { describe, expect, it } from 'vitest';
import { buildVisualReview, removeCapture, enforceVisualEvidence } from '../visual-evidence';
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


describe('action-list evidence quality', () => {
 const raw = (change: object = {}) => ({ viewportReviews: [review('desktop'), review('mobile')], findings: [{ ...finding, ...change }], strengths: [] });
 it('omits tentative observations while retaining grounded strengths and assessment coverage', () => {
  const input = { ...raw({ observation: 'Five icons might dilute the main action.' }), strengths: [{ captureId: 'desktop', area: 'hierarchy', section: 'Hero', element: 'Heading', observation: 'The hero heading is the largest text element.' }] };
  const result = enforceVisualEvidence(buildVisualReview(captures, input), {});
  expect(result.findings).toEqual([]); expect(result.reasonCodes).toContain('uncertain_observation');
  expect(result.viewportReviews).toHaveLength(2); expect(result.strengths).toHaveLength(1);
 });
 it('does not present unmeasured contrast as a supported change', () => {
  for (const area of ['colour_contrast', 'typography_readability']) {
   const result = enforceVisualEvidence(buildVisualReview(captures, raw({ area, visibleText: 'Home About Contact', observation: 'The header links have low contrast against the background.' })), {});
   expect(result.findings).toEqual([]); expect(result.status).toBe('partial');
   expect(result.viewportReviews[0].areas.colour_contrast).toBe('not_assessable');
  }
 });
 it('requires an exact checkable failing sample, not a different text or a passing ratio', () => {
  const sample = { tag: 'p', text: 'Read this notice', fontSizePx: 16, fontWeight: '400', color: 'rgb(180,180,180)', backgroundColor: 'rgb(255,255,255)' };
  for (const change of [{}, { color: 'rgb(0,0,0)' }, { text: 'Different element' }, { backgroundColor: 'rgba(0,0,0,0)' }]) {
   const dom = { headingSamples: [], bodyTextSample: [{ ...sample, ...change }] } as unknown as import('../render-types').DomSnapshot;
   const result = enforceVisualEvidence(buildVisualReview(captures, raw({ area: 'colour_contrast', visibleText: sample.text, observation: 'This notice has low text contrast.' })), { desktop: dom });
   expect(result.findings.length).toBe(Object.keys(change).length === 0 ? 1 : 0);
  }
 });
 it('does not treat an exact visible-text question as uncertainty in the observation', () => {
  const result = enforceVisualEvidence(buildVisualReview(captures, raw({ visibleText: 'May we help?', observation: 'The button labeled May we help? overlaps the heading.' })), {});
  expect(result.findings).toHaveLength(1);
 });
});
