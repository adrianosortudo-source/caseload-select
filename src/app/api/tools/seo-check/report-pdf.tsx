/**
 * SEO and AI Visibility Audit · PDF template (server-rendered)
 *
 * Renderable via @react-pdf/renderer (renderToBuffer) in a Node route. Emits a
 * real text layer, so the exported audit is selectable, searchable, and
 * greppable, unlike a browser window.print() to "Microsoft Print to PDF" which
 * rasterizes on some drivers. The output is deterministic: the same saved
 * result yields the same PDF regardless of who exports it, which is the QA win.
 *
 * Operator-facing artifact (reached only through the operator-gated route), so
 * the internal prospecting summary and per-issue audit notes are included when
 * the saved result carries them. A public scan's result never carries those
 * fields (the API strips internalSummary plus internalNote/prospectingAngle from
 * unauthenticated responses), so a public result renders clean by construction.
 *
 * Brand: no em dashes, no banned vocabulary, no orphan words.
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
import { classifyAuditNote, AUDIT_NOTE_LABEL, type AuditNoteKind, classifyActionTier, ACTION_TIER_LABEL, ACTION_TIER_ORDER, type ActionTier } from "./audit-notes";

const FONTS_DIR = path.join(process.cwd(), "public", "fonts");
Font.register({ family: "Manrope", src: path.join(FONTS_DIR, "Manrope-VF.ttf") });
Font.register({ family: "Oxanium", src: path.join(FONTS_DIR, "Oxanium-VF.ttf") });
// Long unbroken tokens (URLs) should wrap rather than overflow the page.
Font.registerHyphenationCallback((word) => [word]);

const COLORS = {
  navy: "#1E2F58",
  gold: "#C4B49A",
  stoneOnLight: "#9E9070",
  parchment: "#F4F3EF",
  paper: "#FFFFFF",
  text: "#1C2B3A",
  textMuted: "#6B7A8D",
  border: "#E8E4DA",
  danger: "#C0392B",
};

type Sev = "critical" | "high" | "medium" | "low" | "info";
const SEV_LABEL: Record<Sev, string> = {
  critical: "Critical", high: "High", medium: "Medium", low: "Low", info: "Info",
};
const SEV_COLOR: Record<Sev, string> = {
  critical: COLORS.danger, high: COLORS.danger, medium: COLORS.stoneOnLight,
  low: COLORS.textMuted, info: COLORS.textMuted,
};
const AUDIT_NOTE_COLOR: Record<AuditNoteKind, string> = {
  safe: COLORS.navy, verify: COLORS.stoneOnLight, hygiene: COLORS.textMuted,
  crawler_limitation: COLORS.danger,
};
const ACTION_TIER_COLOR: Record<ActionTier, string> = {
  action_required: COLORS.danger,
  optimization: COLORS.navy,
  policy_decision: COLORS.stoneOnLight,
  verify: COLORS.stoneOnLight,
  informational: COLORS.textMuted,
};
const ACTION_TIER_DESCRIPTION: Record<ActionTier, string> = {
  action_required: "High-confidence, high-severity findings worth fixing first.",
  optimization: "Worthwhile improvements at medium or low severity. Not urgent.",
  policy_decision: "The current setup reflects a legitimate business choice, not a defect.",
  verify: "The evidence needs a manual look before being cited as a confirmed problem.",
  informational: "Context worth knowing. No action implied.",
};

/* ── Loose input types: the saved result is persisted JSON, so guard every read. ── */
interface IssueLike {
  id?: string; title?: string; category?: string; severity?: Sev; confidence?: "high" | "medium" | "low";
  detail?: string; fix?: string; evidence?: string; affectedCount?: number; totalPages?: number;
  effort?: string; pageTypeImpact?: string[]; internalNote?: string; prospectingAngle?: string;
}
interface PageLike {
  url?: string; pageType?: string; pageGrade?: string; pageScore?: number; indexable?: boolean;
  wordCount?: number; keyWarnings?: string[]; rendering?: { risk?: string };
}
interface BotLike { name?: string; blocked?: boolean; category?: "search" | "training" }
export interface AuditPdfResult {
  domain?: string;
  scanMode?: string;
  pagesScanned?: number;
  overallScore?: number;
  grade?: string;
  aiSearchScore?: number;
  aiSearchGrade?: string;
  aiPolicyScore?: number;
  aiPolicyGrade?: string;
  partial?: boolean;
  checkedAt?: string;
  discoveryConfidence?: "high" | "medium" | "low";
  buildSha?: string | null;
  categories?: Array<{ items?: Array<{ status?: string }> }>;
  issues?: IssueLike[];
  pages?: PageLike[];
  aiBots?: BotLike[];
  severityBreakdown?: Record<Sev, number>;
  intentAlignment?: {
    grade?: string; score?: number; confidence?: string; targetKeyword?: string; targetMatter?: string;
    targetLocation?: string; bestMatchingPage?: string; matchedSignals?: number; totalSignals?: number;
    missingSignals?: string[];
  };
  renderingSummary?: { risk?: string; highRiskPages?: number; mediumRiskPages?: number; totalPages?: number; evidence?: string[] };
  internalSummary?: {
    prospectFitScore?: number; websiteMaturity?: string; urgencyLevel?: string;
    recommendedOpeningAngle?: string; strongestOutreachHooks?: string[]; likelyPainPoints?: string[];
    topRevenueOpportunities?: string[]; technicalBlockers?: string[]; aiVisibilityBlockers?: string[];
    localSeoOpportunities?: string[]; trustAndConversionGaps?: string[];
  };
}

const s = StyleSheet.create({
  page: { fontFamily: "Manrope", fontSize: 9.5, color: COLORS.text, backgroundColor: COLORS.paper, paddingTop: 0, paddingBottom: 44, paddingHorizontal: 0 },
  header: { backgroundColor: COLORS.navy, paddingVertical: 20, paddingHorizontal: 32, color: COLORS.paper },
  headerMetaRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 12 },
  eyebrow: { fontFamily: "Oxanium", fontSize: 8, fontWeight: 700, letterSpacing: 1.6, color: COLORS.gold },
  headerDate: { fontFamily: "Oxanium", fontSize: 8, fontWeight: 600, letterSpacing: 0.8, color: "rgba(196,180,154,0.75)" },
  domain: { fontFamily: "Oxanium", fontSize: 20, fontWeight: 800, color: COLORS.paper, marginBottom: 3 },
  headerSub: { fontFamily: "Manrope", fontSize: 8.5, color: "rgba(237,234,217,0.75)" },
  scoreRow: { flexDirection: "row", gap: 24, marginTop: 14 },
  scoreBlock: {},
  scoreLabel: { fontFamily: "Oxanium", fontSize: 7, fontWeight: 700, letterSpacing: 1, color: "rgba(196,180,154,0.8)", marginBottom: 2 },
  scoreValue: { fontFamily: "Oxanium", fontSize: 15, fontWeight: 800, color: COLORS.paper },

  body: { paddingHorizontal: 32, paddingTop: 18 },
  sectionTitle: { fontFamily: "Oxanium", fontSize: 11, fontWeight: 800, color: COLORS.navy, marginBottom: 8, marginTop: 16, borderBottomWidth: 1, borderColor: COLORS.border, paddingBottom: 4 },
  sectionTitleFirst: { marginTop: 0 },
  para: { fontSize: 9.5, color: COLORS.textMuted, lineHeight: 1.5, marginBottom: 6 },

  sevStrip: { flexDirection: "row", gap: 14, marginBottom: 4 },
  sevItem: { fontSize: 9, color: COLORS.textMuted },
  sevN: { fontFamily: "Oxanium", fontWeight: 800 },

  issue: { marginBottom: 9, paddingBottom: 9, borderBottomWidth: 1, borderColor: COLORS.border },
  issueHead: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6, marginBottom: 2 },
  tag: { fontFamily: "Oxanium", fontSize: 7, fontWeight: 800, letterSpacing: 0.6, paddingVertical: 1.5, paddingHorizontal: 5, borderRadius: 2, backgroundColor: COLORS.parchment },
  issueTitle: { fontSize: 10.5, fontWeight: 700, color: COLORS.navy },
  meta: { fontSize: 8, color: COLORS.textMuted },
  issueDetail: { fontSize: 9, color: COLORS.text, lineHeight: 1.5, marginTop: 2 },
  fix: { fontSize: 9, color: COLORS.navy, lineHeight: 1.5, marginTop: 3, paddingLeft: 8, borderLeftWidth: 2, borderColor: COLORS.navy },
  fixLabel: { fontFamily: "Oxanium", fontSize: 7.5, fontWeight: 800, letterSpacing: 0.5, color: COLORS.navy },
  evidence: { fontSize: 8, color: COLORS.textMuted, marginTop: 3 },
  internalLine: { fontSize: 8.5, color: COLORS.text, marginTop: 3, backgroundColor: "rgba(196,180,154,0.14)", padding: 4, borderRadius: 3 },

  table: { marginTop: 2 },
  tr: { flexDirection: "row", borderBottomWidth: 1, borderColor: COLORS.border, paddingVertical: 4 },
  thRow: { borderBottomWidth: 1.5 },
  th: { fontFamily: "Oxanium", fontSize: 7.5, fontWeight: 700, letterSpacing: 0.5, color: COLORS.textMuted },
  td: { fontSize: 8.5, color: COLORS.text },
  cPath: { width: "34%", paddingRight: 6 },
  cType: { width: "14%" },
  cScore: { width: "12%" },
  cIndex: { width: "12%" },
  cRender: { width: "14%" },
  cWarn: { width: "14%" },

  bots: { flexDirection: "row", flexWrap: "wrap", gap: 4, marginBottom: 6 },
  botChip: { fontSize: 8, paddingVertical: 1.5, paddingHorizontal: 5, borderRadius: 2, backgroundColor: COLORS.parchment },

  list: { marginBottom: 4 },
  listSub: { fontFamily: "Oxanium", fontSize: 8, fontWeight: 700, letterSpacing: 0.6, color: COLORS.stoneOnLight, marginTop: 5, marginBottom: 2 },
  li: { fontSize: 8.8, color: COLORS.text, lineHeight: 1.45, marginBottom: 1.5, paddingLeft: 8 },
  internalBadge: { fontFamily: "Oxanium", fontSize: 7, fontWeight: 700, letterSpacing: 1, color: COLORS.paper, backgroundColor: COLORS.stoneOnLight, paddingVertical: 2, paddingHorizontal: 6, borderRadius: 10, alignSelf: "flex-start", marginBottom: 6 },

  footer: { position: "absolute", bottom: 18, left: 32, right: 32, flexDirection: "row", justifyContent: "space-between", borderTopWidth: 1, borderColor: COLORS.border, paddingTop: 6 },
  footerText: { fontSize: 7.5, color: COLORS.textMuted },
});

function sevOf(v: unknown): Sev {
  return v === "critical" || v === "high" || v === "medium" || v === "low" || v === "info" ? v : "info";
}
function fmtDate(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric" });
}
function pathOf(url?: string): string {
  if (!url) return "/";
  try { return new URL(url).pathname || "/"; } catch { return url; }
}

function Section({ title, first, children }: { title: string; first?: boolean; children: React.ReactNode }) {
  return (
    <View style={{ marginBottom: 2 }}>
      <Text style={[s.sectionTitle, ...(first ? [s.sectionTitleFirst] : [])]}>{title}</Text>
      {children}
    </View>
  );
}

export function AuditReportPdf({ result }: { result: AuditPdfResult }) {
  const issues = Array.isArray(result.issues) ? result.issues.slice(0, 120) : [];
  // Grouped by what response the finding actually calls for, so the report
  // does not headline every warning as an undifferentiated "issue." A
  // duplicate symptom sharing a root cause (see analysis.ts's address-finding
  // dedup) is already merged upstream, before this grouping runs.
  const tierGroups: Record<ActionTier, IssueLike[]> = {
    action_required: [], optimization: [], policy_decision: [], verify: [], informational: [],
  };
  for (const it of issues) {
    const sev = sevOf(it.severity);
    const tier = classifyActionTier({ title: it.title ?? "", severity: sev, confidence: it.confidence ?? "high", pageTypeImpact: it.pageTypeImpact, detail: it.detail });
    tierGroups[tier].push(it);
  }
  const pages = Array.isArray(result.pages) ? result.pages.slice(0, 60) : [];
  const bots = Array.isArray(result.aiBots) ? result.aiBots : [];
  const searchBots = bots.filter((b) => b.category === "search");
  const trainingBots = bots.filter((b) => b.category === "training");
  const sb = result.severityBreakdown;
  const internal = result.internalSummary;
  const intent = result.intentAlignment;
  const rendering = result.renderingSummary;

  const allChecks = (result.categories ?? []).flatMap((c) => c.items ?? []);
  const failCount = allChecks.filter((i) => i?.status === "fail").length;
  const warnCount = allChecks.filter((i) => i?.status === "warn").length;
  const passCount = allChecks.length - failCount - warnCount;

  const domain = result.domain || "audit";
  const generated = fmtDate(result.checkedAt) || fmtDate(new Date().toISOString());

  return (
    <Document title={`SEO and AI Visibility Audit: ${domain}`} author="CaseLoad Select">
      <Page size="A4" style={s.page} wrap>
        {/* Header */}
        <View style={s.header}>
          <View style={s.headerMetaRow}>
            <Text style={s.eyebrow}>SEO AND AI VISIBILITY AUDIT</Text>
            <Text style={s.headerDate}>{generated}</Text>
          </View>
          <Text style={s.domain}>{domain}</Text>
          <Text style={s.headerSub}>
            {(result.pagesScanned ?? pages.length ?? 1)} page{(result.pagesScanned ?? 1) > 1 ? "s" : ""} scanned
            {result.scanMode ? ` · ${result.scanMode}` : ""}
            {result.partial ? " · partial (time limit reached)" : ""}
          </Text>
          <View style={s.scoreRow}>
            <View style={s.scoreBlock}>
              <Text style={s.scoreLabel}>SEO HEALTH</Text>
              <Text style={s.scoreValue}>{result.grade ?? "?"} · {result.overallScore ?? "?"}/100</Text>
            </View>
            <View style={s.scoreBlock}>
              <Text style={s.scoreLabel}>AEO READINESS</Text>
              <Text style={s.scoreValue}>{result.aiSearchGrade ?? "?"} · {result.aiSearchScore ?? "?"}/100</Text>
            </View>
            {result.aiPolicyScore !== undefined && (
              <View style={s.scoreBlock}>
                <Text style={s.scoreLabel}>CONTENT POLICY</Text>
                <Text style={s.scoreValue}>{result.aiPolicyGrade ?? "?"} · {result.aiPolicyScore}/100</Text>
              </View>
            )}
          </View>
        </View>

        <View style={s.body}>
          {/* Summary */}
          <Section title="Summary" first>
            <Text style={s.para}>
              {passCount} of {allChecks.length} checks passed.
              {failCount > 0 ? ` ${failCount} failed.` : ""}
              {warnCount > 0 ? ` ${warnCount} warnings.` : ""}
            </Text>
            {sb && (
              <View style={s.sevStrip}>
                {(["critical", "high", "medium", "low", "info"] as Sev[]).map((k) => (
                  <Text key={k} style={s.sevItem}>
                    <Text style={[s.sevN, { color: SEV_COLOR[k] }]}>{sb[k] ?? 0}</Text> {SEV_LABEL[k]}
                  </Text>
                ))}
              </View>
            )}
            {(result.discoveryConfidence === "low" || result.discoveryConfidence === "medium") && (
              <Text style={[s.para, { color: result.discoveryConfidence === "low" ? COLORS.danger : COLORS.stoneOnLight, marginTop: 4 }]}>
                Discovery confidence: {result.discoveryConfidence}. This crawl found
                {result.discoveryConfidence === "low" ? " very few navigable links and no sitemap" : " a sitemap the crawl did not fully cover within budget"},
                so "not found" findings below may reflect a discovery gap rather than a genuine absence. Verify manually before citing them.
              </Text>
            )}
            <Text style={[s.para, { color: COLORS.textMuted, marginTop: 4 }]}>
              AEO Readiness measures on-site answer-engine readiness signals. It does not measure whether AI assistants actually cite this site.
              Unscored checks (security headers, llms.txt, FAQ and review markup) are reported but excluded from all grades.
            </Text>
          </Section>

          {/* Findings, grouped by what response they call for rather than
              headlined as one undifferentiated "Issues (N)" list. */}
          {issues.length === 0 && (
            <Section title="Findings (0)">
              <Text style={s.para}>No issues found. All checks passed.</Text>
            </Section>
          )}
          {ACTION_TIER_ORDER.map((tier) => {
            const group = tierGroups[tier];
            if (group.length === 0) return null;
            return (
              <Section key={tier} title={`${ACTION_TIER_LABEL[tier]} (${group.length})`}>
                <Text style={[s.para, { marginTop: -2 }]}>{ACTION_TIER_DESCRIPTION[tier]}</Text>
                {group.map((it, i) => {
                  const sev = sevOf(it.severity);
                  const note = internal ? classifyAuditNote({ title: it.title ?? "", severity: sev, confidence: (it.confidence ?? "high"), pageTypeImpact: it.pageTypeImpact }) : null;
                  return (
                    <View key={it.id ?? i} style={s.issue} wrap={false}>
                      <View style={s.issueHead}>
                        <Text style={[s.tag, { color: ACTION_TIER_COLOR[tier] }]}>{SEV_LABEL[sev]}</Text>
                        <Text style={s.issueTitle}>{it.title ?? "Issue"}</Text>
                        <Text style={s.meta}>
                          {it.category ?? ""}
                          {it.affectedCount ? ` · ${it.affectedCount}/${it.totalPages ?? "?"} page${it.affectedCount > 1 ? "s" : ""}` : ""}
                          {it.effort ? ` · ${it.effort} effort` : ""}
                          {it.confidence ? ` · ${it.confidence} confidence` : ""}
                        </Text>
                        {note && <Text style={[s.tag, { color: AUDIT_NOTE_COLOR[note] }]}>{AUDIT_NOTE_LABEL[note]}</Text>}
                      </View>
                      {it.detail && <Text style={s.issueDetail}>{it.detail}</Text>}
                      {it.fix && <Text style={s.fix}><Text style={s.fixLabel}>FIX  </Text>{it.fix}</Text>}
                      {it.evidence && <Text style={s.evidence}>Evidence: {it.evidence}</Text>}
                      {internal && it.internalNote && <Text style={s.internalLine}>Internal: {it.internalNote}</Text>}
                      {internal && it.prospectingAngle && <Text style={s.internalLine}>Angle: {it.prospectingAngle}</Text>}
                    </View>
                  );
                })}
              </Section>
            );
          })}

          {/* Pages */}
          {pages.length > 0 && (
            <Section title={`Pages scanned (${pages.length})`}>
              <View style={s.table}>
                <View style={[s.tr, s.thRow]}>
                  <Text style={[s.th, s.cPath]}>Page</Text>
                  <Text style={[s.th, s.cType]}>Type</Text>
                  <Text style={[s.th, s.cScore]}>Score</Text>
                  <Text style={[s.th, s.cIndex]}>Index</Text>
                  <Text style={[s.th, s.cRender]}>Rendering</Text>
                  <Text style={[s.th, s.cWarn]}>Words</Text>
                </View>
                {pages.map((p, i) => (
                  <View key={i} style={s.tr} wrap={false}>
                    <Text style={[s.td, s.cPath]}>{pathOf(p.url)}</Text>
                    <Text style={[s.td, s.cType]}>{p.pageType ?? "n/a"}</Text>
                    <Text style={[s.td, s.cScore]}>{p.pageGrade ?? "?"} {p.pageScore ?? ""}</Text>
                    <Text style={[s.td, s.cIndex, ...(p.indexable === false ? [{ color: COLORS.danger }] : [])]}>{p.indexable === false ? "noindex" : "ok"}</Text>
                    <Text style={[s.td, s.cRender]}>{p.rendering?.risk ?? "n/a"}</Text>
                    <Text style={[s.td, s.cWarn]}>{p.wordCount ?? ""}</Text>
                  </View>
                ))}
              </View>
            </Section>
          )}

          {/* AI crawler access */}
          {bots.length > 0 && (
            <Section title="AI crawler access">
              <Text style={s.listSub}>AI SEARCH CRAWLERS (blocking hurts visibility)</Text>
              <View style={s.bots}>
                {searchBots.map((b) => (
                  <Text key={b.name} style={[s.botChip, { color: b.blocked ? COLORS.danger : COLORS.navy }]}>
                    {b.name}: {b.blocked ? "Blocked" : "Allowed"}
                  </Text>
                ))}
              </View>
              <Text style={s.listSub}>TRAINING CRAWLERS (blocking protects content)</Text>
              <View style={s.bots}>
                {trainingBots.map((b) => (
                  <Text key={b.name} style={[s.botChip, { color: b.blocked ? COLORS.navy : COLORS.stoneOnLight }]}>
                    {b.name}: {b.blocked ? "Blocked" : "Allowed"}
                  </Text>
                ))}
              </View>
            </Section>
          )}

          {/* Intent alignment */}
          {intent && (
            <Section title="Intent alignment">
              <Text style={s.para}>
                Target: {intent.targetKeyword || intent.targetMatter || "n/a"}
                {intent.targetLocation ? ` · ${intent.targetLocation}` : ""}
                {"  "}Score: {intent.grade ?? "?"} {intent.score ?? "?"}/100 ({intent.confidence ?? "?"} confidence).
                {intent.bestMatchingPage ? ` Best page: ${pathOf(intent.bestMatchingPage)}.` : ""}
                {typeof intent.matchedSignals === "number" ? ` ${intent.matchedSignals}/${intent.totalSignals ?? "?"} signals matched.` : ""}
              </Text>
              {intent.missingSignals && intent.missingSignals.length > 0 && (
                <Text style={s.para}>Missing signals: {intent.missingSignals.slice(0, 8).join(", ")}.</Text>
              )}
            </Section>
          )}

          {/* Rendering summary */}
          {rendering && (
            <Section title="Rendering and crawlability">
              <Text style={s.para}>
                Risk: {rendering.risk ?? "n/a"}. {rendering.highRiskPages ?? 0} high-risk, {rendering.mediumRiskPages ?? 0} medium-risk of {rendering.totalPages ?? 0} scanned.
              </Text>
              {(rendering.evidence ?? []).slice(0, 4).map((e, i) => (
                <Text key={i} style={s.li}>• {e}</Text>
              ))}
            </Section>
          )}

          {/* Internal prospecting summary (operator scans only) */}
          {internal && (
            <Section title="Internal prospecting summary">
              <Text style={s.internalBadge}>INTERNAL USE</Text>
              <Text style={s.para}>
                Prospect fit: {internal.prospectFitScore ?? "?"} · Website maturity: {internal.websiteMaturity ?? "?"} · Urgency: {internal.urgencyLevel ?? "?"}.
              </Text>
              {internal.recommendedOpeningAngle && (
                <>
                  <Text style={s.listSub}>RECOMMENDED OPENING ANGLE</Text>
                  <Text style={s.para}>{internal.recommendedOpeningAngle}</Text>
                </>
              )}
              {([
                ["Strongest outreach hooks", internal.strongestOutreachHooks],
                ["Likely pain points", internal.likelyPainPoints],
                ["Top revenue opportunities", internal.topRevenueOpportunities],
                ["Technical blockers", internal.technicalBlockers],
                ["AI visibility blockers", internal.aiVisibilityBlockers],
                ["Local SEO opportunities", internal.localSeoOpportunities],
                ["Trust and conversion gaps", internal.trustAndConversionGaps],
              ] as Array<[string, string[] | undefined]>).map(([label, items]) =>
                items && items.length > 0 ? (
                  <View key={label} style={s.list}>
                    <Text style={s.listSub}>{label.toUpperCase()}</Text>
                    {items.map((it, i) => <Text key={i} style={s.li}>• {it}</Text>)}
                  </View>
                ) : null
              )}
            </Section>
          )}
        </View>

        {/* Footer on every page. Build SHA makes "which code produced this
            report" a read-off after prod ran stale engine code twice. */}
        <View style={s.footer} fixed>
          <Text style={s.footerText}>
            CaseLoad Select · SEO and AI Visibility Audit · {domain}
            {result.buildSha ? ` · build ${result.buildSha}` : ""}
          </Text>
          <Text style={s.footerText} render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}
