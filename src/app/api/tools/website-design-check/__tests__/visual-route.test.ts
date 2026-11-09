import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import sharp from "sharp";
const m = vi.hoisted(() => ({ render: vi.fn(), general: vi.fn(), authority: vi.fn(), aggregate: vi.fn(), dimension: vi.fn() }));
vi.mock("@/lib/design-check/render-client", () => ({ fetchRenderResult: m.render, RenderServiceBlockedError: class extends Error {}, RenderServiceRenderFailedError: class extends Error {} }));
vi.mock("@/lib/design-check/vision-judgment", () => ({ judgeScreenshot: m.general }));
vi.mock("@/lib/design-check/authority-vision", () => ({ judgeAuthorityScreenshot: m.authority }));
vi.mock("@/lib/design-check/aggregate", () => ({ buildTrack1Report: m.aggregate }));
vi.mock("@/lib/design-check/dimensions/typography", () => ({ scoreTypography: m.dimension }));
vi.mock("@/lib/design-check/dimensions/color-contrast", () => ({ scoreColorContrast: m.dimension }));
vi.mock("@/lib/design-check/dimensions/forms", () => ({ scoreForms: m.dimension }));
vi.mock("@/lib/design-check/dimensions/performance", () => ({ scorePerformance: m.dimension }));
vi.mock("@/lib/design-check/dimensions/spacing", () => ({ scoreSpacing: m.dimension }));
vi.mock("@/lib/design-check/dimensions/mobile", () => ({ scoreMobile: m.dimension }));
vi.mock("@/lib/design-check/dimensions/authority", () => ({ scoreAuthority: () => ({ name: "Authority", weight: 1, score: 40, maxScore: 100, subScores: [] }) }));
vi.mock("@/lib/ssrf", () => ({ validateOutboundUrl: () => ({ ok: true }) }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: async () => ({ ok: true }), ipFromRequest: () => "test", rateLimitHeaders: () => ({}) }));
import { POST } from "../route";
import * as evidence from "@/lib/design-check/visual-evidence";
import { VISUAL_AREAS, type VisualCapture } from "@/lib/design-check/visual-review-types";
const review = (captureId: string) => ({ captureId, pageKind: "homepage", areas: Object.fromEntries(VISUAL_AREAS.map(a => [a, "assessed"])), areaReasons: {} });
const visual = { viewportReviews: [review("desktop"), review("mobile")], findings: [{ captureId: "desktop", area: "hierarchy", section: "Hero", element: "Heading", observation: "Heading overlaps the button.", consequence: "The action may be hard to read.", change: "Place the button below the heading.", priority: "high", limitation: "" }], strengths: [] };
const legacy = { score: 40, uncappedScore: 76, letterGrade: "F", attainable: { score: 85, letterGrade: "B" }, dimensionBar: [], notMeasuredDimensions: [], notApplicableDimensions: [], rankedFindings: [], redFlagPanel: { activeFlags: [{ key: "authority-cap", classification: "disqualifying" }], notCheckableInV1: [], ceiling: 40 } };
const request = () => new NextRequest("http://localhost/api/tools/website-design-check", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ domain: "synthetic-fixture.example" }) });
beforeEach(async () => {
 vi.restoreAllMocks(); vi.clearAllMocks();
 const png = await sharp({ create: { width: 80, height: 120, channels: 3, background: "white" } }).png().toBuffer();
 m.render.mockResolvedValue({ captures: ["desktop", "mobile"].map(viewport => ({ viewport, screenshotPng: png, screenshotClippedFromPx: null, domSnapshot: { darkPatterns: [], privateInternalMarker: "DO_NOT_EXPOSE" }, finalUrl: "https://synthetic-fixture.example", webVitals: {} })) });
 m.general.mockResolvedValue({ judgments: [], visual }); m.authority.mockResolvedValue({ judgments: [] }); m.aggregate.mockReturnValue(structuredClone(legacy)); m.dimension.mockReturnValue({ name: "Synthetic", weight: 1, score: 80, maxScore: 100, items: [] });
});
describe("visual report API boundary", () => {
 it("returns the exact assessed images, keeping legacy caps separate and internal data private", async () => {
  const response = await POST(request()); const body = await response.json();
  expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
  expect(body.visualReview.status).toBe("complete"); expect(body.score).toBe(40); expect(body.letterGrade).toBe("F");
  expect(m.general).toHaveBeenCalledTimes(1); expect(m.authority).toHaveBeenCalledTimes(1);
  const sent = m.general.mock.calls[0][2]; expect(sent).toEqual(body.visualReview.captures);
  expect(JSON.stringify(body)).not.toContain("DO_NOT_EXPOSE"); expect(JSON.stringify(body)).not.toContain("domSnapshot");
 });
 it("removes the larger image and its dependent finding before exceeding the JSON budget", async () => {
  const base: VisualCapture = { id: "desktop", available: true, mimeType: "image/png", base64: "A".repeat(1398104), width: 80, height: 120, totalHeight: null };
  vi.spyOn(evidence, "prepareCapture").mockResolvedValueOnce(base).mockResolvedValueOnce({ ...base, id: "mobile", base64: "B".repeat(1398000) });
  m.aggregate.mockReturnValue({ ...legacy, rankedFindings: [{ evidence: "E".repeat(500000) }] });
  const response = await POST(request()); const text = await response.text(); const body = JSON.parse(text);
  expect(response.status).toBe(200); expect(Buffer.byteLength(text)).toBeLessThanOrEqual(3 * 1024 * 1024);
  expect(body.visualReview.captures[0]).toEqual({ id: "desktop", available: false, reason: "payload_limit" });
  expect(body.visualReview.captures[1].available).toBe(true); expect(body.visualReview.findings).toEqual([]); expect(body.visualReview.status).toBe("partial");
 });
 it("returns a bounded error when image-free legacy data is already too large", async () => {
  m.aggregate.mockReturnValue({ ...legacy, rankedFindings: [{ evidence: "E".repeat(3 * 1024 * 1024) }] });
  const response = await POST(request()); const text = await response.text();
  expect(response.status).toBe(502); expect(Buffer.byteLength(text)).toBeLessThan(1000); expect(JSON.parse(text).error).toBeTruthy();
 });
 it("does not make a general vision call with undisplayed originals when preparation fails", async () => {
  vi.spyOn(evidence, "prepareCapture").mockResolvedValueOnce({ id: "desktop", available: false, reason: "image_invalid" }).mockResolvedValueOnce({ id: "mobile", available: false, reason: "image_invalid" });
  const response = await POST(request()); const body = await response.json();
  expect(m.general).not.toHaveBeenCalled(); expect(body.visualReview.status).toBe("unavailable"); expect(body.visualReview.findings).toEqual([]);
 });
 it("returns a mobile-only visual assessment without inventing desktop scores", async () => {
  const png = await sharp({ create: { width: 80, height: 120, channels: 3, background: "white" } }).png().toBuffer();
  m.render.mockResolvedValue({ captures: [{ viewport: "mobile", screenshotPng: png, screenshotClippedFromPx: null, domSnapshot: { darkPatterns: [] }, finalUrl: "https://synthetic-fixture.example", webVitals: {} }] });
  m.general.mockResolvedValue({ judgments: [], visual: { ...visual, viewportReviews: [review("mobile")], findings: [{ ...visual.findings[0], captureId: "mobile" }] } });
  const response = await POST(request()); const body = await response.json();
  expect(response.status).toBe(200); expect(body.legacyUnavailable).toBe(true); expect(body.score).toBeUndefined();
  expect(body.visualReview.status).toBe("partial"); expect(body.visualReview.findings[0].captureId).toBe("mobile");
  expect(m.authority).not.toHaveBeenCalled(); expect(m.aggregate).not.toHaveBeenCalled();
 });

});
