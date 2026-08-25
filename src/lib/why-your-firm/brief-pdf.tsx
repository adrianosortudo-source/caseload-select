/**
 * Why Your Firm · Firm Positioning Brief PDF
 *
 * Server-renderable via @react-pdf/renderer, mirroring the structure of the
 * inline BriefView (cover, alternatives, differentiators, dropped claims,
 * statement, surfaces, homework, Screen bridge). Content order is locked to
 * the build plan §3.10 and must not drift from BriefView's section order.
 *
 * Unlike the Screen demo's sample report, this brief carries no
 * DEMONSTRATION band: it is a real output of a real tool, built from the
 * lawyer's own selections, not a simulated product report.
 *
 * Brand book compliance: no em dashes, no banned vocabulary, no orphan
 * words, no italics. Fonts load from local TTFs, never the Google Fonts CDN,
 * so rendering never depends on network access at PDF-render time.
 */

import { Document, Page, Text, View, StyleSheet, Font } from "@react-pdf/renderer";
import path from "node:path";
import type { BriefData } from "./engine";
import { copy } from "./compliance";

const FONTS_DIR = path.join(process.cwd(), "public", "fonts");

Font.register({ family: "Manrope", src: path.join(FONTS_DIR, "Manrope-VF.ttf") });
Font.register({ family: "Oxanium", src: path.join(FONTS_DIR, "Oxanium-VF.ttf") });

const COLORS = {
  navy: "#1E2F58",
  navyDeep: "#0D1520",
  stone: "#C4B49A",
  stoneOnLight: "#9E9070",
  paper: "#FFFFFF",
  text: "#1C2B3A",
  textMuted: "#6B7A8D",
  border: "#E8E4DA",
  offWhite: "#F9F8F5",
};

const s = StyleSheet.create({
  page: {
    fontFamily: "Manrope",
    fontSize: 10,
    color: COLORS.text,
    backgroundColor: COLORS.paper,
    paddingTop: 0,
    paddingBottom: 56,
  },

  // ── Cover / header (navy band) ────────────────────────────────────
  header: {
    backgroundColor: COLORS.navy,
    paddingVertical: 28,
    paddingHorizontal: 32,
    color: COLORS.paper,
  },
  headerEyebrow: {
    fontFamily: "Oxanium",
    fontSize: 8,
    fontWeight: 700,
    letterSpacing: 1.6,
    color: COLORS.stone,
    marginBottom: 10,
  },
  headerTitle: {
    fontFamily: "Oxanium",
    fontSize: 22,
    fontWeight: 800,
    color: COLORS.paper,
    marginBottom: 6,
  },
  headerMetaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 14,
  },
  headerFirm: {
    fontFamily: "Manrope",
    fontSize: 10,
    color: "rgba(237,234,217,0.85)",
  },
  headerFirmStrong: { fontFamily: "Manrope", fontWeight: 700, color: COLORS.paper },
  headerDate: {
    fontFamily: "Oxanium",
    fontSize: 8,
    fontWeight: 600,
    letterSpacing: 0.8,
    color: "rgba(196,180,154,0.7)",
  },
  profileChip: {
    marginTop: 16,
    alignSelf: "flex-start",
    borderWidth: 1.5,
    borderColor: COLORS.stone,
    borderRadius: 4,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  profileLabel: {
    fontFamily: "Oxanium",
    fontSize: 7,
    fontWeight: 700,
    letterSpacing: 1.4,
    color: COLORS.stone,
    marginBottom: 3,
  },
  profileName: {
    fontFamily: "Oxanium",
    fontSize: 15,
    fontWeight: 800,
    color: COLORS.paper,
  },

  // ── Section base ──────────────────────────────────────────────────
  section: {
    paddingHorizontal: 32,
    paddingVertical: 16,
    borderBottomWidth: 0.5,
    borderColor: COLORS.border,
  },
  sectionTitle: {
    fontFamily: "Oxanium",
    fontSize: 8,
    fontWeight: 700,
    letterSpacing: 1.6,
    color: COLORS.stoneOnLight,
    marginBottom: 10,
  },
  sectionIntro: {
    fontFamily: "Manrope",
    fontSize: 9,
    color: COLORS.textMuted,
    lineHeight: 1.55,
    marginBottom: 10,
  },
  bodyText: {
    fontFamily: "Manrope",
    fontSize: 10,
    color: COLORS.navy,
    lineHeight: 1.55,
  },

  // ── Alternatives ──────────────────────────────────────────────────
  altRow: { marginBottom: 8 },
  altLabel: {
    fontFamily: "Manrope",
    fontSize: 9.5,
    fontWeight: 700,
    color: COLORS.navy,
    marginBottom: 2,
  },
  altCost: {
    fontFamily: "Manrope",
    fontSize: 9,
    color: COLORS.textMuted,
    lineHeight: 1.5,
  },

  // ── Differentiator cards ──────────────────────────────────────────
  // Symmetric 1px border, never a left-accent bar: the brand rule (Brand Book
  // 6.2 rule 10) bans left-edge accent borders on any panel or card. The
  // legacy screen-demo PDF this template was modelled on predates the ruling;
  // do not copy its borderLeft styles back in.
  cardBlock: {
    backgroundColor: COLORS.offWhite,
    borderWidth: 1,
    borderColor: COLORS.stone,
    padding: 10,
    marginBottom: 8,
  },
  cardLabel: {
    fontFamily: "Oxanium",
    fontSize: 7,
    fontWeight: 700,
    letterSpacing: 1.2,
    color: COLORS.stoneOnLight,
    marginBottom: 4,
  },
  cardClaim: {
    fontFamily: "Manrope",
    fontSize: 10,
    fontWeight: 600,
    color: COLORS.navy,
    lineHeight: 1.5,
    marginBottom: 4,
  },
  cardProof: {
    fontFamily: "Manrope",
    fontSize: 9,
    color: COLORS.textMuted,
    lineHeight: 1.5,
  },
  combinationLine: {
    fontFamily: "Manrope",
    fontSize: 9,
    fontWeight: 600,
    color: COLORS.navy,
    lineHeight: 1.5,
    marginTop: 4,
  },

  // ── Dropped cards ─────────────────────────────────────────────────
  droppedRow: {
    paddingVertical: 7,
    borderBottomWidth: 0.5,
    borderColor: COLORS.border,
  },
  droppedLabel: {
    fontFamily: "Manrope",
    fontSize: 9.5,
    fontWeight: 700,
    color: COLORS.navy,
    marginBottom: 2,
  },
  droppedReason: {
    fontFamily: "Manrope",
    fontSize: 9,
    color: COLORS.textMuted,
    lineHeight: 1.5,
  },

  // ── Statement ─────────────────────────────────────────────────────
  statementBlock: {
    backgroundColor: COLORS.navy,
    borderRadius: 4,
    padding: 18,
  },
  statementText: {
    fontFamily: "Oxanium",
    fontSize: 13,
    fontWeight: 700,
    color: COLORS.paper,
    lineHeight: 1.5,
  },

  // ── Surfaces ──────────────────────────────────────────────────────
  surfaceRow: { marginBottom: 8 },
  surfaceName: {
    fontFamily: "Manrope",
    fontSize: 9.5,
    fontWeight: 700,
    color: COLORS.navy,
    marginBottom: 2,
  },
  surfaceLine: {
    fontFamily: "Manrope",
    fontSize: 9,
    color: COLORS.textMuted,
    lineHeight: 1.5,
  },

  // ── CTA ───────────────────────────────────────────────────────────
  cta: {
    backgroundColor: COLORS.navy,
    paddingVertical: 22,
    paddingHorizontal: 32,
    alignItems: "center",
  },
  ctaHeadline: {
    fontFamily: "Oxanium",
    fontSize: 12,
    fontWeight: 800,
    color: COLORS.paper,
    textAlign: "center",
    marginBottom: 8,
  },
  ctaBody: {
    fontFamily: "Manrope",
    fontSize: 9,
    color: "rgba(237,234,217,0.78)",
    lineHeight: 1.55,
    textAlign: "center",
    marginBottom: 8,
    maxWidth: 400,
  },
  ctaThreeWay: {
    fontFamily: "Manrope",
    fontSize: 9,
    color: "rgba(237,234,217,0.9)",
    lineHeight: 1.5,
    textAlign: "center",
    marginBottom: 12,
  },
  ctaBtn: {
    fontFamily: "Manrope",
    backgroundColor: COLORS.stone,
    color: COLORS.navyDeep,
    paddingVertical: 9,
    paddingHorizontal: 20,
    borderRadius: 3,
    fontSize: 9,
    fontWeight: 700,
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },

  // ── Footer mark (fixed) ───────────────────────────────────────────
  footerMark: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingVertical: 8,
    paddingHorizontal: 32,
    borderTopWidth: 0.5,
    borderColor: COLORS.border,
    backgroundColor: COLORS.offWhite,
  },
  footerText: {
    fontFamily: "Oxanium",
    fontSize: 7,
    fontWeight: 600,
    letterSpacing: 0.8,
    color: COLORS.textMuted,
    textAlign: "center",
  },
});

const SURFACES = copy.brief.surfaces;

export function BriefPdf({ brief }: { brief: BriefData }) {
  const today = new Date().toLocaleDateString("en-CA", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <Document
      title={`${copy.pdf.coverTitle}: ${brief.firmName || "Your firm"}`}
      author="CaseLoad Select"
      subject={copy.pdf.coverTitle}
    >
      <Page size="A4" style={s.page}>
        {/* Header / cover */}
        <View style={s.header}>
          <Text style={s.headerEyebrow}>CASELOAD SELECT · WHY YOUR FIRM</Text>
          <Text style={s.headerTitle}>{copy.pdf.coverTitle}</Text>
          <View style={s.headerMetaRow}>
            <Text style={s.headerFirm}>
              {copy.pdf.preparedFor}{" "}
              <Text style={s.headerFirmStrong}>{brief.firmName || "your firm"}</Text>
            </Text>
            <Text style={s.headerDate}>
              {copy.pdf.dateLabel.toUpperCase()} {today}
            </Text>
          </View>
          {brief.profile && (
            <View style={s.profileChip}>
              <Text style={s.profileLabel}>{copy.brief.profileEyebrow.toUpperCase()}</Text>
              <Text style={s.profileName}>{brief.profile.name}</Text>
            </View>
          )}
        </View>

        {/* Alternatives */}
        {brief.alternatives.length > 0 && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>{copy.brief.sectionAlternatives.toUpperCase()}</Text>
            <Text style={s.sectionIntro}>{copy.brief.sectionAlternativesIntro}</Text>
            {brief.alternatives.map((alt) => (
              <View key={alt.id} style={s.altRow} wrap={false}>
                <Text style={s.altLabel}>{alt.label}</Text>
                <Text style={s.altCost}>{alt.clientCost}</Text>
              </View>
            ))}
            {brief.alternativeOtherText && (
              <View style={s.altRow} wrap={false}>
                <Text style={s.altLabel}>In your own words</Text>
                <Text style={s.altCost}>{brief.alternativeOtherText}</Text>
              </View>
            )}
          </View>
        )}

        {/* Differentiators */}
        {brief.survivors.length > 0 ? (
          <View style={s.section}>
            <Text style={s.sectionTitle}>{copy.brief.sectionDifferentiators.toUpperCase()}</Text>
            {brief.survivors.map((j) => (
              <View key={j.card.id} style={s.cardBlock} wrap={false}>
                <Text style={s.cardLabel}>{j.card.label.toUpperCase()}</Text>
                <Text style={s.cardClaim}>{j.claimText}</Text>
                <Text style={s.cardProof}>{j.proof}</Text>
              </View>
            ))}
            <Text style={s.combinationLine}>{copy.brief.combinationLine}</Text>
          </View>
        ) : (
          <View style={s.section}>
            <Text style={s.sectionTitle}>{copy.brief.sectionDifferentiators.toUpperCase()}</Text>
            <Text style={s.bodyText}>{copy.brief.noSurvivors}</Text>
          </View>
        )}

        {/* Dropped */}
        {brief.dropped.length > 0 && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>{copy.brief.sectionDropped.toUpperCase()}</Text>
            <Text style={s.sectionIntro}>{copy.brief.sectionDroppedIntro}</Text>
            {brief.dropped.map((j) => (
              <View key={j.card.id} style={s.droppedRow} wrap={false}>
                <Text style={s.droppedLabel}>{j.card.label}</Text>
                <Text style={s.droppedReason}>{j.dropReason}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Statement */}
        {brief.statement && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>{copy.brief.sectionStatement.toUpperCase()}</Text>
            <View style={s.statementBlock}>
              <Text style={s.statementText}>{brief.statement}</Text>
            </View>
          </View>
        )}

        {/* Surfaces */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>{copy.brief.sectionSurfaces.toUpperCase()}</Text>
          {SURFACES.map((surface) => (
            <View key={surface.name} style={s.surfaceRow} wrap={false}>
              <Text style={s.surfaceName}>{surface.name}</Text>
              <Text style={s.surfaceLine}>{surface.line}</Text>
            </View>
          ))}
        </View>

        {/* Homework */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>{copy.brief.sectionHomework.toUpperCase()}</Text>
          <Text style={s.bodyText}>{copy.brief.homework}</Text>
        </View>

        {/* Screen bridge / CTA */}
        <View style={s.cta}>
          <Text style={s.ctaHeadline}>{copy.brief.sectionBridge}</Text>
          <Text style={s.ctaBody}>{copy.brief.bridge}</Text>
          <Text style={s.ctaThreeWay}>{copy.brief.bridgeThreeWay}</Text>
          <Text style={s.ctaBtn}>{copy.brief.bridgeCta.toUpperCase()} → CASELOADSELECT.CA</Text>
        </View>

        {/* Footer mark, fixed on every page */}
        <View style={s.footerMark} fixed>
          <Text style={s.footerText}>{copy.pdf.footerMark}</Text>
        </View>
      </Page>
    </Document>
  );
}
