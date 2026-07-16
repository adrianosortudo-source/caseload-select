/**
 * Screen Demo · PDF Report Template
 *
 * Server-renderable via @react-pdf/renderer. Mirrors the visual structure of
 * ReportView.tsx (header → CPI → axis → narrative → next steps → answers),
 * but built with react-pdf primitives (Document / Page / View / Text).
 *
 * Demonstration footer band is rendered as a fixed element on every page so
 * it cannot disappear even if the answer trail spills onto page 2. This is
 * the LSO Rule 4.2-1 compliance device for the artifact.
 *
 * Brand book compliance: no em dashes (banned), no banned vocabulary, no
 * orphan words. Operator inbox cannot leak (no email rendered in the PDF
 * other than the firm-supplied recipient, which is what they entered).
 */

import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Font,
} from "@react-pdf/renderer";
import path from "node:path";
import type { SampleCase } from "../_data/cases";
import type { ScreenScore } from "./scoring";
import { AXIS_MAX, BAND_COLOR, BAND_LABEL, BAND_RANGE } from "./scoring";
import { SCREEN_DEMO_QUESTIONS } from "../_data/questions";

/**
 * Brand fonts — Manrope (body) + Oxanium (display)
 *
 * Both registered from local variable-font TTFs in public/fonts/. Variable
 * fonts let @react-pdf pick a weight on demand without requiring four
 * separate static files per family.
 *
 * Resolved with an absolute path so the registration works the same in dev
 * and on Vercel — the file URL pattern @react-pdf needs differs from the
 * web-served `/fonts/...` URL the browser uses.
 */
const FONTS_DIR = path.join(process.cwd(), "public", "fonts");

Font.register({
  family: "Manrope",
  src: path.join(FONTS_DIR, "Manrope-VF.ttf"),
});
Font.register({
  family: "Oxanium",
  src: path.join(FONTS_DIR, "Oxanium-VF.ttf"),
});

const COLORS = {
  navy: "#1E2F58",
  navyDeep: "#0D1520",
  stone: "#C4B49A",
  stoneOnLight: "#9E9070",
  parchment: "#F4F3EF",
  paper: "#FFFFFF",
  text: "#1C2B3A",
  textMuted: "#6B7A8D",
  border: "#E8E4DA",
  demoBg: "#FFF4E0",
  demoBorder: "#E8CFA0",
  demoText: "#6B4E1A",
};

const s = StyleSheet.create({
  page: {
    fontFamily: "Manrope",
    fontSize: 10,
    color: COLORS.text,
    backgroundColor: COLORS.paper,
    paddingTop: 56,
    paddingBottom: 80,
    paddingHorizontal: 0,
  },

  // ── Demonstration band (fixed on every page) ─────────────────────
  demoBand: {
    position: "absolute",
    left: 0,
    right: 0,
    paddingVertical: 10,
    paddingHorizontal: 28,
    backgroundColor: COLORS.demoBg,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: COLORS.demoBorder,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  demoBandTop: { top: 0 },
  demoBandBottom: { bottom: 0 },
  demoIcon: {
    fontFamily: "Oxanium",
    fontSize: 12,
    fontWeight: 700,
    color: COLORS.stoneOnLight,
    width: 16,
  },
  demoText: {
    fontFamily: "Manrope",
    flex: 1,
    fontSize: 8,
    color: COLORS.demoText,
    lineHeight: 1.5,
  },
  demoTextStrong: {
    fontFamily: "Manrope",
    fontWeight: 800,
    color: "#4A3510",
  },

  // ── Header (navy band) ────────────────────────────────────────────
  header: {
    backgroundColor: COLORS.navy,
    paddingVertical: 22,
    paddingHorizontal: 32,
    color: COLORS.paper,
  },
  headerMetaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  headerEyebrow: {
    fontFamily: "Oxanium",
    fontSize: 8,
    fontWeight: 700,
    letterSpacing: 1.6,
    color: COLORS.stone,
  },
  headerDate: {
    fontFamily: "Oxanium",
    fontSize: 8,
    fontWeight: 600,
    letterSpacing: 0.8,
    color: "rgba(196,180,154,0.7)",
  },
  headerMain: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
  },
  headerLeft: { flex: 1, paddingRight: 16 },
  caseTag: {
    fontFamily: "Oxanium",
    fontSize: 8,
    fontWeight: 700,
    letterSpacing: 1.6,
    color: COLORS.stone,
    marginBottom: 4,
  },
  caseTitle: {
    fontFamily: "Oxanium",
    fontSize: 18,
    fontWeight: 800,
    color: COLORS.paper,
    lineHeight: 1.25,
    marginBottom: 4,
  },
  firmLine: {
    fontFamily: "Manrope",
    fontSize: 9,
    color: "rgba(237,234,217,0.7)",
  },
  firmName: {
    fontFamily: "Manrope",
    fontWeight: 700,
    color: COLORS.paper,
  },

  // ── Band chip ─────────────────────────────────────────────────────
  bandChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 6,
    borderWidth: 1.5,
  },
  bandLetter: {
    fontFamily: "Oxanium",
    fontSize: 28,
    fontWeight: 800,
  },
  bandLabel: {
    fontFamily: "Oxanium",
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: 1.1,
    color: COLORS.paper,
  },
  bandRange: {
    fontFamily: "Oxanium",
    fontSize: 8,
    fontWeight: 600,
    letterSpacing: 0.9,
    color: "rgba(196,180,154,0.85)",
    marginTop: 2,
  },

  // ── Section base ──────────────────────────────────────────────────
  section: {
    paddingHorizontal: 32,
    paddingVertical: 18,
    borderBottomWidth: 0.5,
    borderColor: COLORS.border,
  },
  sectionTitle: {
    fontFamily: "Oxanium",
    fontSize: 8,
    fontWeight: 700,
    letterSpacing: 1.8,
    color: COLORS.stoneOnLight,
    marginBottom: 12,
  },

  // ── CPI hero ──────────────────────────────────────────────────────
  cpiRow: {
    flexDirection: "row",
    gap: 32,
    alignItems: "center",
  },
  cpiNumWrap: { width: 140, alignItems: "center" },
  cpiNum: {
    fontFamily: "Oxanium",
    fontSize: 48,
    fontWeight: 800,
    color: COLORS.navy,
  },
  cpiNumLabel: {
    fontFamily: "Oxanium",
    fontSize: 8,
    fontWeight: 700,
    letterSpacing: 1.4,
    color: COLORS.textMuted,
    textAlign: "center",
    marginTop: 4,
    lineHeight: 1.4,
  },
  cpiSplitCol: { flex: 1, gap: 8 },
  cpiSplitRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
  },
  cpiSplitKey: {
    fontFamily: "Oxanium",
    fontSize: 8,
    fontWeight: 700,
    letterSpacing: 1.4,
    color: COLORS.textMuted,
  },
  cpiSplitVal: {
    fontFamily: "Oxanium",
    fontSize: 14,
    fontWeight: 800,
    color: COLORS.navy,
  },
  cpiSplitMax: {
    fontFamily: "Oxanium",
    fontSize: 9,
    fontWeight: 600,
    color: COLORS.textMuted,
  },
  bar: {
    height: 3,
    backgroundColor: COLORS.border,
    borderRadius: 3,
    marginBottom: 6,
    overflow: "hidden",
  },
  barFill: {
    height: 3,
    backgroundColor: COLORS.navy,
  },

  // ── Axis grid ─────────────────────────────────────────────────────
  axisGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  axisItem: {
    width: "47%",
    marginBottom: 8,
  },
  axisHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    marginBottom: 3,
  },
  axisKey: {
    fontFamily: "Manrope",
    fontSize: 9,
    fontWeight: 600,
    color: COLORS.navy,
  },
  axisVal: {
    fontFamily: "Oxanium",
    fontSize: 8,
    fontWeight: 700,
    color: COLORS.textMuted,
  },

  // ── Narrative ─────────────────────────────────────────────────────
  narrativeText: {
    fontFamily: "Manrope",
    fontSize: 10,
    color: COLORS.navy,
    lineHeight: 1.55,
  },

  // ── Next steps ────────────────────────────────────────────────────
  nextGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  nextCard: {
    backgroundColor: "#F9F8F5",
    padding: 10,
    borderRadius: 3,
    borderLeftWidth: 2,
    borderLeftColor: COLORS.stone,
    width: "100%",
  },
  nextCardHalf: {
    backgroundColor: "#F9F8F5",
    padding: 10,
    borderRadius: 3,
    borderLeftWidth: 2,
    borderLeftColor: COLORS.stone,
    width: "48%",
  },
  nextLabel: {
    fontFamily: "Oxanium",
    fontSize: 7,
    fontWeight: 700,
    letterSpacing: 1.3,
    color: COLORS.stoneOnLight,
    marginBottom: 3,
  },
  nextValue: {
    fontFamily: "Manrope",
    fontSize: 9,
    color: COLORS.navy,
    lineHeight: 1.5,
  },

  // ── Answer trail ──────────────────────────────────────────────────
  answersIntro: {
    fontFamily: "Manrope",
    fontSize: 9,
    color: COLORS.textMuted,
    lineHeight: 1.5,
    marginBottom: 10,
  },
  answerRow: {
    fontFamily: "Manrope",
    paddingVertical: 8,
    borderBottomWidth: 0.5,
    borderColor: COLORS.border,
  },
  answerQ: {
    fontFamily: "Manrope",
    fontSize: 8,
    fontWeight: 700,
    letterSpacing: 1.2,
    color: COLORS.textMuted,
    marginBottom: 3,
  },
  answerA: {
    fontFamily: "Manrope",
    fontSize: 9,
    color: COLORS.navy,
    lineHeight: 1.45,
  },

  // ── CTA ───────────────────────────────────────────────────────────
  cta: {
    backgroundColor: COLORS.navy,
    paddingVertical: 24,
    paddingHorizontal: 32,
    alignItems: "center",
    marginTop: 0,
  },
  ctaHeadline: {
    fontFamily: "Oxanium",
    fontSize: 14,
    fontWeight: 800,
    color: COLORS.paper,
    textAlign: "center",
    marginBottom: 8,
  },
  ctaBody: {
    fontFamily: "Manrope",
    fontSize: 9,
    color: "rgba(237,234,217,0.72)",
    lineHeight: 1.5,
    textAlign: "center",
    marginBottom: 12,
    maxWidth: 380,
  },
  ctaBtn: {
    fontFamily: "Manrope",
    backgroundColor: COLORS.stone,
    color: COLORS.navyDeep,
    paddingVertical: 10,
    paddingHorizontal: 22,
    borderRadius: 3,
    fontSize: 9,
    fontWeight: 700,
    letterSpacing: 0.9,
    textTransform: "uppercase",
  },
});

const FACTOR_LABELS: Record<string, string> = {
  geo: "Jurisdiction fit",
  contactability: "Contactability",
  legitimacy: "Intent signals",
  complexity: "Depth of work",
  urgency: "Time sensitivity",
  strategic: "Strategic value",
  fee: "Fee fit",
};

interface ReportPdfProps {
  caseFixture: SampleCase;
  score: ScreenScore;
  firmName: string;
  answers: Record<string, string | string[]>;
}

export function ReportPdf({ caseFixture, score, firmName, answers }: ReportPdfProps) {
  const accent = BAND_COLOR[score.band];
  const bandLabel = BAND_LABEL[score.band];
  const bandRange = BAND_RANGE[score.band];

  const today = new Date().toLocaleDateString("en-CA", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const answerSummary = SCREEN_DEMO_QUESTIONS.map((q) => {
    const v = answers[q.id];
    if (!v) return null;
    const ids = Array.isArray(v) ? v : [v];
    const labels = ids
      .map((id) => q.options.find((o) => o.id === id)?.label)
      .filter(Boolean);
    return { q: q.prompt, a: labels.join(" · ") };
  }).filter(Boolean) as { q: string; a: string }[];

  return (
    <Document
      title={`CaseLoad Select Screen Report (Sample): ${caseFixture.title}`}
      author="CaseLoad Select"
      subject="Sample Screen Report"
    >
      <Page size="A4" style={s.page}>
        {/* Fixed demonstration band — appears on every page automatically */}
        <View style={[s.demoBand, s.demoBandTop]} fixed>
          <Text style={s.demoIcon}>!</Text>
          <Text style={s.demoText}>
            <Text style={s.demoTextStrong}>DEMONSTRATION REPORT.</Text> Not from a real client inquiry. Not legal advice. The score and recommendations below are produced from sample inputs to show how the CaseLoad Select Screen works.
          </Text>
        </View>

        {/* Header */}
        <View style={s.header}>
          <View style={s.headerMetaRow}>
            <Text style={s.headerEyebrow}>CASELOAD SELECT · SCREEN REPORT · SAMPLE</Text>
            <Text style={s.headerDate}>{today}</Text>
          </View>
          <View style={s.headerMain}>
            <View style={s.headerLeft}>
              <Text style={s.caseTag}>{caseFixture.tag.toUpperCase()}</Text>
              <Text style={s.caseTitle}>{caseFixture.title}</Text>
              <Text style={s.firmLine}>
                Prepared for <Text style={s.firmName}>{firmName}</Text>
              </Text>
            </View>
            <View
              style={[
                s.bandChip,
                {
                  borderColor: accent,
                  backgroundColor: blendNavy(accent, 0.18),
                },
              ]}
            >
              <Text style={[s.bandLetter, { color: accent }]}>{score.band}</Text>
              <View>
                <Text style={s.bandLabel}>{bandLabel.toUpperCase()}</Text>
                <Text style={s.bandRange}>{bandRange}</Text>
              </View>
            </View>
          </View>
        </View>

        {/* CPI hero */}
        <View style={s.section}>
          <View style={s.cpiRow}>
            <View style={s.cpiNumWrap}>
              <Text style={s.cpiNum}>{score.cpi}</Text>
              <Text style={s.cpiNumLabel}>CASE PRIORITY{"\n"}INDEX (0 – 100)</Text>
            </View>
            <View style={s.cpiSplitCol}>
              <View style={s.cpiSplitRow}>
                <Text style={s.cpiSplitKey}>FIT SCORE</Text>
                <Text style={s.cpiSplitVal}>
                  {score.fitScore} <Text style={s.cpiSplitMax}>/ 30</Text>
                </Text>
              </View>
              <View style={s.bar}>
                <View style={[s.barFill, { width: `${(score.fitScore / 30) * 100}%` }]} />
              </View>
              <View style={s.cpiSplitRow}>
                <Text style={s.cpiSplitKey}>VALUE SCORE</Text>
                <Text style={s.cpiSplitVal}>
                  {score.valueScore} <Text style={s.cpiSplitMax}>/ 70</Text>
                </Text>
              </View>
              <View style={s.bar}>
                <View style={[s.barFill, { width: `${(score.valueScore / 70) * 100}%` }]} />
              </View>
            </View>
          </View>
        </View>

        {/* Axis breakdown */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>SCORING BREAKDOWN</Text>
          <View style={s.axisGrid}>
            {(Object.keys(AXIS_MAX) as (keyof typeof AXIS_MAX)[]).map((key) => {
              const v = score.axis[key];
              const max = AXIS_MAX[key];
              return (
                <View key={key} style={s.axisItem}>
                  <View style={s.axisHead}>
                    <Text style={s.axisKey}>{FACTOR_LABELS[key]}</Text>
                    <Text style={s.axisVal}>{v} / {max}</Text>
                  </View>
                  <View style={s.bar}>
                    <View style={[s.barFill, { width: `${(v / max) * 100}%` }]} />
                  </View>
                </View>
              );
            })}
          </View>
        </View>

        {/* Narrative */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>WHAT THE SCREEN CONCLUDED</Text>
          <Text style={s.narrativeText}>{score.narrative}</Text>
        </View>

        {/* Next steps */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>RECOMMENDED NEXT STEPS</Text>
          <View style={s.nextGrid}>
            <View style={s.nextCard}>
              <Text style={s.nextLabel}>RESPONSE WINDOW</Text>
              <Text style={s.nextValue}>{score.responseWindow}</Text>
            </View>
            <View style={s.nextCardHalf}>
              <Text style={s.nextLabel}>ACTION</Text>
              <Text style={s.nextValue}>{score.recommendedAction}</Text>
            </View>
            <View style={s.nextCardHalf}>
              <Text style={s.nextLabel}>SEQUENCE TRIGGER</Text>
              <Text style={s.nextValue}>{score.recommendedSequence}</Text>
            </View>
          </View>
        </View>

        {/* Answer trail */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>WHAT THE SCREEN HEARD</Text>
          <Text style={s.answersIntro}>
            The five questions the Screen asked, and how they were answered in this case. Every input is recorded and traceable so the firm can audit the score at any time.
          </Text>
          {answerSummary.map((row, i) => (
            <View key={i} style={s.answerRow} wrap={false}>
              <Text style={s.answerQ}>{row.q.toUpperCase()}</Text>
              <Text style={s.answerA}>{row.a}</Text>
            </View>
          ))}
        </View>

        {/* CTA */}
        <View style={s.cta}>
          <Text style={s.ctaHeadline}>See the Screen run on your real intake</Text>
          <Text style={s.ctaBody}>
            This was one sample inquiry. CaseLoad Select runs the Screen on every inquiry your firm receives, in seven channels, around the clock. A 30-minute call walks through what that looks like for your practice and your case mix.
          </Text>
          <Text style={s.ctaBtn}>BOOK A 30-MINUTE CALL  →  caseloadselect.ca</Text>
        </View>

        {/* Fixed bottom demonstration band */}
        <View style={[s.demoBand, s.demoBandBottom]} fixed>
          <Text style={s.demoIcon}>!</Text>
          <Text style={s.demoText}>
            <Text style={s.demoTextStrong}>DEMONSTRATION REPORT.</Text> Sample inputs only. Not a screening recommendation for any actual client. CaseLoad Select · caseloadselect.ca
          </Text>
        </View>
      </Page>
    </Document>
  );
}

/**
 * Blend an accent color with navy at a given mix percentage.
 * Used to give the band chip a subtly-tinted navy fill that matches the
 * inline ReportView's color-mix(in srgb, accent 18%, navy).
 */
function blendNavy(accentHex: string, mix: number): string {
  const a = hexToRgb(accentHex);
  const n = hexToRgb(COLORS.navy);
  const r = Math.round(a.r * mix + n.r * (1 - mix));
  const g = Math.round(a.g * mix + n.g * (1 - mix));
  const b = Math.round(a.b * mix + n.b * (1 - mix));
  return `rgb(${r},${g},${b})`;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const m = hex.replace("#", "");
  return {
    r: parseInt(m.slice(0, 2), 16),
    g: parseInt(m.slice(2, 4), 16),
    b: parseInt(m.slice(4, 6), 16),
  };
}
