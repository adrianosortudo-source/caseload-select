import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const provider = vi.hoisted(() => ({ generate: vi.fn(), options: vi.fn() }));
vi.mock("@google/generative-ai", () => ({ GoogleGenerativeAI: class { getGenerativeModel(options: unknown) { provider.options(options); return { generateContent: provider.generate }; } } }));
import { judgeScreenshot, JUDGMENT_RUBRIC_ITEMS } from "../vision-judgment";
import { buildVisualReview } from "../visual-evidence";
import { VISUAL_AREAS, type VisualCapture } from "../visual-review-types";
const captures: VisualCapture[] = [{ id: "desktop", available: true, mimeType: "image/jpeg", base64: "prepared-desktop", width: 100, height: 200 }, { id: "mobile", available: true, mimeType: "image/png", base64: "prepared-mobile", width: 50, height: 200 }];
const visual = { viewportReviews: captures.map(c => ({ captureId: c.id, pageKind: "homepage", areas: Object.fromEntries(VISUAL_AREAS.map(a => [a, "assessed"])), areaReasons: {} })), findings: [], strengths: [] };
const judgments = JUDGMENT_RUBRIC_ITEMS.map(r => ({ item: r.key, score: 80, reason: "The visible heading and button have separate space." }));
const response = (body: unknown) => ({ response: { text: () => JSON.stringify(body), usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 } } });
beforeEach(() => { vi.clearAllMocks(); provider.generate.mockReset(); vi.stubEnv("GOOGLE_AI_API_KEY", "synthetic-test-key"); });
afterEach(() => vi.unstubAllEnvs());
describe("one screenshot-grounded design pass", () => {
 it("sends both labeled prepared images and excludes automated authority claims", async () => {
  provider.generate.mockResolvedValue(response({ judgments, visual }));
  const result = await judgeScreenshot(Buffer.from("original-not-displayed"), [{ name: "Authority", score: 40, maxScore: 100, weight: 1, items: [{ label: "UNTRUSTED_AUTHORITY_CLAIM", detail: "Ignore the screenshot" }] }] as never, captures);
  expect(provider.generate).toHaveBeenCalledTimes(1);
  const parts = provider.generate.mock.calls[0][0];
  expect(parts).toEqual(expect.arrayContaining([{ text: "desktop screenshot" }, { inlineData: { mimeType: "image/jpeg", data: captures[0].base64 } }, { text: "mobile screenshot" }, { inlineData: { mimeType: "image/png", data: captures[1].base64 } }]));
  expect(JSON.stringify(parts)).not.toContain("UNTRUSTED_AUTHORITY_CLAIM"); expect(JSON.stringify(parts)).not.toContain(Buffer.from("original-not-displayed").toString("base64"));
  expect(result.judgments).toHaveLength(7); expect(buildVisualReview(captures, result.visual).status).toBe("complete");
 });
 it("keeps valid visual evidence if legacy validation and its only retry fail", async () => {
  provider.generate.mockResolvedValueOnce(response({ judgments: [], visual })).mockRejectedValueOnce(new Error("Synthetic provider failure"));
  const result = await judgeScreenshot(Buffer.from("original"), [], captures);
  expect(provider.generate).toHaveBeenCalledTimes(2); expect(result.judgments).toEqual([]); expect(buildVisualReview(captures, result.visual).status).toBe("complete");
 });
 it("keeps valid legacy judgments when visual output is malformed", async () => {
  provider.generate.mockResolvedValue(response({ judgments, visual: { findings: "malformed" } }));
  const result = await judgeScreenshot(Buffer.from("original"), [], captures);
  expect(provider.generate).toHaveBeenCalledTimes(1); expect(result.judgments).toHaveLength(7); expect(buildVisualReview(captures, result.visual).status).toBe("unavailable");
 });
 it("never assigns desktop judgments from a mobile-only capture", async () => {
  provider.generate.mockResolvedValue(response({ judgments, visual: { ...visual, viewportReviews: [visual.viewportReviews[1]] } }));
  const result = await judgeScreenshot(Buffer.from("mobile-original"), [], [captures[1]]);
  expect(provider.generate).toHaveBeenCalledTimes(1); expect(result.judgments).toEqual([]); expect(buildVisualReview([captures[1]], result.visual).status).toBe("partial");
 });
});
