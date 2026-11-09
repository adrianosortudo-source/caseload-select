import sharp from 'sharp';
import type { DecodedRenderCapture } from './render-client';
import { VISUAL_AREAS, type VisualCapture, type VisualReview, type ViewportReview, type VisualFinding, type VisualStrength } from './visual-review-types';
const LIMIT = 1024 * 1024;
export async function prepareCapture(id: 'desktop' | 'mobile', capture?: DecodedRenderCapture): Promise<VisualCapture> {
 if (!capture) return { id, available: false, reason: 'capture_unavailable' };
 try { const meta = await sharp(capture.screenshotPng).metadata(); if (!meta.width || !meta.height || meta.format !== 'png') throw new Error('Invalid image'); await sharp(capture.screenshotPng).stats();
  let bytes = capture.screenshotPng; let mimeType: 'image/png' | 'image/jpeg' = 'image/png';
  if (bytes.length > LIMIT) { bytes = await sharp(bytes).jpeg({ quality: 82 }).toBuffer(); mimeType = 'image/jpeg'; }
  if (bytes.length > LIMIT) return { id, available: false, reason: 'image_too_large' };
  return { id, available: true, mimeType, base64: bytes.toString('base64'), width: meta.width, height: meta.height, totalHeight: capture.screenshotClippedFromPx };
 } catch { return { id, available: false, reason: 'image_invalid' }; }
}
const clean = (x: unknown, max = 300): string | null => typeof x === 'string' && x.trim().length > 0 && x.trim().length <= max && !/[\u0000-\u001f]/.test(x) ? x.trim() : null;
const validId = (x: unknown): x is 'desktop' | 'mobile' => x === 'desktop' || x === 'mobile';
const validArea = (x: unknown): x is typeof VISUAL_AREAS[number] => VISUAL_AREAS.includes(x as typeof VISUAL_AREAS[number]);
export function buildVisualReview(captures: VisualCapture[], raw?: unknown): VisualReview {
 const out: VisualReview = { version: 1, status: 'unavailable', reasonCodes: [], captures, viewportReviews: [], findings: [], strengths: [] };
 const input = raw as { viewportReviews?: unknown; findings?: unknown; strengths?: unknown } | undefined;
 if (input && Array.isArray(input.viewportReviews) && Array.isArray(input.findings) && Array.isArray(input.strengths) && input.viewportReviews.length <= 2 && input.findings.length <= 3 && input.strengths.length <= 2) {
  const reviews: ViewportReview[] = []; let valid = true;
  for (const x of input.viewportReviews) { if (!x || typeof x !== 'object') { valid = false; break; } const r = x as ViewportReview;
   if (!validId(r.captureId) || !captures.some(c => c.id === r.captureId && c.available) || reviews.some(v => v.captureId === r.captureId) || !['homepage','challenge','error','login','unreadable','uncertain'].includes(r.pageKind) || !r.areas || VISUAL_AREAS.some(a => !['assessed','not_assessable'].includes(r.areas[a]) || (r.areas[a] === 'not_assessable' && !clean(r.areaReasons?.[a], 200)))) { valid = false; break; }
   reviews.push({ captureId: r.captureId, pageKind: r.pageKind, areas: Object.fromEntries(VISUAL_AREAS.map(a => [a, r.areas[a]])) as ViewportReview['areas'], areaReasons: Object.fromEntries(VISUAL_AREAS.filter(a => r.areas[a] === 'not_assessable').map(a => [a, clean(r.areaReasons[a], 200)])) }); }
  const findings: VisualFinding[] = [];
  for (const [i, x] of input.findings.entries()) { if (!x || typeof x !== 'object') { valid = false; break; } const f = x as VisualFinding;
   const section = clean(f.section), element = clean(f.element), observation = clean(f.observation), consequence = clean(f.consequence), change = clean(f.change), limitation = f.limitation === undefined || f.limitation === '' ? '' : clean(f.limitation);
   const visibleText = f.visibleText === undefined || f.visibleText === '' ? undefined : clean(f.visibleText, 200);
   if (!validId(f.captureId) || !validArea(f.area) || !section || !element || !observation || !consequence || !change || limitation === null || visibleText === null || !['high','medium'].includes(f.priority) || !reviews.some(r => r.captureId === f.captureId && r.pageKind === 'homepage' && r.areas[f.area] === 'assessed')) { valid = false; break; }
   findings.push({ id: `visual-${i+1}`, captureId: f.captureId, area: f.area, section, element, ...(visibleText ? {visibleText} : {}), observation, consequence, change, priority: f.priority, limitation }); }
  const strengths: VisualStrength[] = [];
  for (const x of input.strengths) { if (!x || typeof x !== 'object') { valid = false; break; } const s = x as VisualStrength; const observation = clean(s.observation), section = clean(s.section), element = clean(s.element); const visibleText = s.visibleText === undefined || s.visibleText === '' ? undefined : clean(s.visibleText, 200);
   if (!validId(s.captureId) || !validArea(s.area) || !observation || !section || !element || visibleText === null || !reviews.some(r => r.captureId === s.captureId && r.pageKind === 'homepage' && r.areas[s.area] === 'assessed')) { valid = false; break; }
   strengths.push({ captureId: s.captureId, area: s.area, section, element, ...(visibleText ? {visibleText} : {}), observation }); }
  if (valid && findings.length <= 3 && strengths.length <= 2) { out.viewportReviews = reviews; out.findings = findings.sort((a,b) => Number(b.priority === 'high') - Number(a.priority === 'high')); out.strengths = strengths; }
  else out.reasonCodes.push('invalid_visual_response');
 } else out.reasonCodes.push(raw ? 'invalid_visual_response' : 'vision_unavailable');
 return refreshVisualStatus(out);
}
export function refreshVisualStatus(out: VisualReview): VisualReview {
 out.reasonCodes = out.reasonCodes.filter(x => x === 'vision_unavailable' || x === 'invalid_visual_response');
 if (out.captures.some(c => !c.available)) out.reasonCodes.push('capture_unavailable');
 if (out.captures.some(c => c.reason === 'payload_limit')) out.reasonCodes.push('payload_limit');
 if (out.captures.some(c => c.totalHeight)) out.reasonCodes.push('capture_clipped');
 if (out.viewportReviews.some(r => r.pageKind !== 'homepage')) out.reasonCodes.push('unsuitable_page');
 const assessed = out.viewportReviews.filter(r => r.pageKind === 'homepage' && VISUAL_AREAS.some(a => r.areas[a] === 'assessed'));
 const complete = ['desktop','mobile'].every(id => { const c = out.captures.find(x => x.id === id); const r = assessed.find(x => x.captureId === id); return c?.available && !c.totalHeight && r && VISUAL_AREAS.every(a => r.areas[a] === 'assessed'); });
 out.status = complete ? 'complete' : assessed.length ? 'partial' : 'unavailable'; return out;
}
export function removeCapture(review: VisualReview, id: 'desktop' | 'mobile'): void {
 review.captures = review.captures.map(c => c.id === id ? { id, available: false, reason: 'payload_limit' } : c);
 review.viewportReviews = review.viewportReviews.filter(r => r.captureId !== id); review.findings = review.findings.filter(f => f.captureId !== id); review.strengths = review.strengths.filter(s => s.captureId !== id); refreshVisualStatus(review);
}
