import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { prepareCapture, buildVisualReview } from "../visual-evidence";
import type { DecodedRenderCapture } from "../render-client";
import { VISUAL_AREAS } from "../visual-review-types";
const capture = (bytes: Buffer, totalHeight: number | null = null) => ({ screenshotPng: bytes, screenshotClippedFromPx: totalHeight }) as DecodedRenderCapture;
const viewport = (captureId: string) => ({ captureId, pageKind: "homepage", areas: Object.fromEntries(VISUAL_AREAS.map(a => [a, "assessed"])), areaReasons: {} });
describe("prepared screenshot evidence", () => {
 it("preserves a readable PNG and actual dimensions, and reports clipped coverage", async () => {
  const png = await sharp({ create: { width: 80, height: 120, channels: 3, background: "white" } }).png().toBuffer();
  const desktop = await prepareCapture("desktop", capture(png, 5000));
  expect(desktop).toMatchObject({ available: true, mimeType: "image/png", base64: png.toString("base64"), width: 80, height: 120, totalHeight: 5000 });
  const result = buildVisualReview([desktop, { ...desktop, id: "mobile", totalHeight: null }], { viewportReviews: [viewport("desktop"), viewport("mobile")], findings: [], strengths: [] });
  expect(result.status).toBe("partial"); expect(result.reasonCodes).toContain("capture_clipped");
 });
 it("uses one dimension-preserving JPEG for an over-budget PNG", async () => {
  const pixels = Buffer.alloc(640 * 640 * 3); let seed = 7;
  for (let i = 0; i < pixels.length; i++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; pixels[i] = seed >>> 24; }
  const png = await sharp(pixels, { raw: { width: 640, height: 640, channels: 3 } }).png().toBuffer();
  expect(png.length).toBeGreaterThan(1024 * 1024);
  const result = await prepareCapture("mobile", capture(png));
  expect(result).toMatchObject({ available: true, mimeType: "image/jpeg", width: 640, height: 640 });
  const jpeg = Buffer.from(result.base64!, "base64"); expect(jpeg.length).toBeLessThanOrEqual(1024 * 1024);
  expect(await sharp(jpeg).metadata()).toMatchObject({ format: "jpeg", width: 640, height: 640 });
 });
 it("rejects a truncated image even when its header has dimensions", async () => {
  const png = await sharp({ create: { width: 80, height: 120, channels: 3, background: "white" } }).png().toBuffer();
  expect(await prepareCapture("desktop", capture(png.subarray(0, 48)))).toMatchObject({ available: false, reason: "image_invalid" });
 });
 it("never treats invalid references or excess findings as a successful assessment", () => {
  const captures = [{ id: "desktop" as const, available: true }];
  const finding = { captureId: "mobile", area: "hierarchy", section: "Hero", element: "Heading", observation: "Heading overlaps button.", consequence: "The action may be harder to read.", change: "Separate the heading and button.", priority: "high", limitation: "" };
  for (const findings of [[finding], Array.from({ length: 4 }, () => ({ ...finding, captureId: "desktop" }))]) {
   const result = buildVisualReview(captures, { viewportReviews: [viewport("desktop")], findings, strengths: [] });
   expect(result.status).toBe("unavailable"); expect(result.reasonCodes).toContain("invalid_visual_response"); expect(result.findings).toEqual([]);
  }
 });
});
