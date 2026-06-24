/**
 * prospecting.ts
 *
 * The prospecting interpretation layer. Pure, deterministic, no network and no
 * React. It takes one or more SeoCheckResult scans (operator shape) plus the
 * operator's prospect notes and translates the raw technical findings into the
 * CaseLoad Select ACTS business framework:
 *
 *   A, Authority  (trust, entity clarity, reviews, schema, AI confidence)
 *   C, Capture    (technical SEO, indexability, local SEO, metadata, speed)
 *   T, Target     (practice-area coverage, matter-intent pages, content gaps)
 *   S, Screen     (intake path, CTA clarity, qualification, lead-fit routing)
 *
 * The output never leads with a raw SEO grade. Scores stay internal; the
 * findings carry plain business consequences the operator can take into a
 * cold email or a strategic call.
 *
 * Brand voice constraints apply to every generated string (cold email and
 * report especially, since they reach a prospect): no em dashes, no banned
 * AI vocabulary, LSO Rule 4.2-1 safe (no outcome promises, no superlatives).
 */

import type {
  SeoCheckResult,
  SeoCheckIssue,
  Confidence,
} from "./seo-types";

/* ────────────────────────────────────────────────────────
   Public types
   ──────────────────────────────────────────────────────── */

export type ActsPillar = "authority" | "capture" | "target" | "screen";

export interface DiagnosticFinding {
  title: string;
  businessConsequence: string;
  evidence: string;
  recommendedFix: string;
  confidence: "low" | "medium" | "high";
  sourceCategory: string;
  affectedUrls?: string[];
}

export interface ProspectInput {
  firmName: string;
  primaryDomain: string;
  alternateDomains: string[];
  market: string;
  practiceFocus: string;
  competitors: string[];
  notes: string;
}

export type ScanMode = "quick" | "standard" | "deep";
export type ScanProgressStatus = "pending" | "scanning" | "done" | "error";

/** One scan attempt, keyed by role. result is null when the scan failed. */
export interface DomainScan {
  domain: string;
  role: "primary" | "alternate";
  result: SeoCheckResult | null;
  error?: string;
}

export interface DomainComparisonRow {
  domain: string;
  role: "primary" | "alternate";
  reachable: boolean;
  pagesScanned: number;
  overallScore: number | null;
  aiSearchScore: number | null;
  maturity: string | null;
  note: string;
}

export interface DomainComparison {
  rows: DomainComparisonRow[];
  fragmentationFlagged: boolean;
  strongestDomain: string | null;
  canonicalRecommendation: string;
}

export interface ProspectingDiagnostic {
  prospect: {
    firmName: string;
    primaryDomain: string;
    alternateDomains: string[];
    market: string;
    practiceFocus: string;
    competitors: string[];
    notes: string;
  };
  scanSummary: {
    checkedAt: string;
    /** Page count for the PRIMARY domain only (the findings basis). */
    pagesScanned: number;
    /** Sum of pages scanned across the primary and every reachable alternate. */
    totalPagesScanned: number;
    scanMode: string;
    domainsChecked: string[];
  };
  actsFindings: {
    authority: DiagnosticFinding[];
    capture: DiagnosticFinding[];
    target: DiagnosticFinding[];
    screen: DiagnosticFinding[];
  };
  /** Present only when alternate domains were supplied. */
  domainComparison?: DomainComparison;
  topOutreachHooks: string[];
  strategicCallQuestions: string[];
  recommendedOpeningAngle: string;
  thirtySixtyNinetyPlan: {
    day30: string[];
    day60: string[];
    day90: string[];
  };
  reportReadySummary: string;
  coldEmailDraft: string;
}

/* ────────────────────────────────────────────────────────
   ACTS classification
   ──────────────────────────────────────────────────────── */

export const PILLAR_LABEL: Record<ActsPillar, string> = {
  authority: "Authority",
  capture: "Capture",
  target: "Target",
  screen: "Screen",
};

// Legal-Marketing labels that describe the intake / conversion path (Screen),
// not the trust surface (Authority).
const SCREEN_CONTACT_TITLES = new Set<string>([
  "phone number visible",
  "contact form / direct contact",
  "consultation call to action",
  "address / nap",
  "contact path",
  "no clear contact path",
]);

/**
 * Map one issue to its ACTS pillar. Category-first, with label-level overrides
 * where a single category feeds two pillars (Legal Marketing splits between
 * Screen and Authority; AI Visibility splits between Authority and Target).
 */
export function classifyActs(category: string, title: string): ActsPillar {
  const t = title.toLowerCase();

  switch (category) {
    case "Indexability":
    case "On-Page SEO":
    case "Local SEO":
    case "Performance":
    case "Technical & Security":
      return "capture";

    case "Schema & Structured Data":
      return "authority";

    case "Links & Content":
      return "target";

    case "AI Visibility":
      // Content-format and query-alignment checks read as Target; everything
      // else (entity, author, bot access, citations) is Authority.
      if (t.includes("question") || t.includes("direct-answer") || t.includes("semantic")) {
        return "target";
      }
      return "authority";

    case "Legal Marketing":
      if (t.includes("practice")) return "target";
      if (SCREEN_CONTACT_TITLES.has(t)) return "screen";
      if (t.includes("trust") || t.includes("policy") || t.includes("disclaimer")) return "authority";
      return "screen";

    default:
      return "capture";
  }
}

/* ────────────────────────────────────────────────────────
   Business-language fallbacks (used when the engine angle is absent)
   ──────────────────────────────────────────────────────── */

const FALLBACK_CONSEQUENCE: Record<ActsPillar, string> = {
  authority:
    "Search and AI systems cannot read the firm as a clear, credentialed entity, so it gets shortlisted and cited less often than the work deserves.",
  capture:
    "Pages that should be found are not surfacing cleanly, so visibility is lost before content quality ever comes into it.",
  target:
    "The matters the firm wants most do not each have a page built around how clients search for them, so high-intent visits land elsewhere.",
  screen:
    "Ready-to-act visitors meet friction before they can reach the firm, so qualified matters leak out at the door.",
};

const GENERIC_FIX: Record<string, string> = {
  Indexability: "Resolve the technical setting holding the page back, then confirm it is indexable.",
  "On-Page SEO": "Add the missing on-page signals (title, description, headings) to the affected pages.",
  "Local SEO": "Surface consistent name, address, and phone signals and link the Google Business Profile.",
  Performance: "Reduce render-blocking resources and oversized assets on the affected pages.",
  "Technical & Security": "Add the missing security headers and confirm HTTPS is enforced sitewide.",
  "Schema & Structured Data": "Add valid LegalService and Person structured data with the core business fields.",
  "AI Visibility": "Package the firm's entity, authorship, and answers so AI search systems can read and cite them.",
  "Legal Marketing": "Make the contact path and trust cues obvious on every page.",
  "Links & Content": "Deepen thin pages and add descriptive internal links between related matters.",
};

const OBSERVATION_BY_PILLAR: Record<ActsPillar, string> = {
  authority:
    "the firm's expertise and trust signals are not packaged in a way search and AI systems can read and recommend",
  capture:
    "several pages are held back from search by a technical setting rather than by anything to do with the content",
  target:
    "the firm's highest-value services do not each have a page built around the language clients actually use",
  screen:
    "a ready-to-act visitor does not have an obvious, low-friction way to reach the firm",
};

const CONSEQUENCE_CLAUSE_BY_PILLAR: Record<ActsPillar, string> = {
  authority: "a trust and visibility gap that quietly lowers how often the firm gets shortlisted",
  capture: "a visibility gap where strong pages are not being found",
  target: "a coverage gap where high-intent searches have nowhere to land",
  screen: "an intake gap where qualified matters can drop before a lawyer ever sees them",
};

/* ────────────────────────────────────────────────────────
   Finding construction
   ──────────────────────────────────────────────────────── */

function toFinding(issue: SeoCheckIssue, pillar: ActsPillar): DiagnosticFinding {
  const consequence = (issue.prospectingAngle || "").trim() || FALLBACK_CONSEQUENCE[pillar];
  const evidence =
    (issue.evidence || "").trim() ||
    `${issue.affectedCount} of ${issue.totalPages} page${issue.totalPages === 1 ? "" : "s"}`;
  const recommendedFix =
    (issue.fix || "").trim() || GENERIC_FIX[issue.category] || "Address this in the technical pass.";

  return {
    title: issue.title,
    businessConsequence: consequence,
    evidence,
    recommendedFix,
    confidence: issue.confidence,
    sourceCategory: issue.category,
    affectedUrls: issue.affectedUrls?.slice(0, 5),
  };
}

function strengthFinding(pillar: ActsPillar): DiagnosticFinding {
  const copy: Record<ActsPillar, { consequence: string; fix: string }> = {
    authority: {
      consequence:
        "The firm already reads as a credible entity to search and AI systems, so Authority becomes a strength to lead with rather than a gap to fix.",
      fix: "Keep the current schema and trust signals, and build a steady review and content cadence on top.",
    },
    capture: {
      consequence:
        "The technical foundation is sound, so Capture is not where the firm is losing ground today.",
      fix: "Hold the current technical setup and watch performance as new pages ship.",
    },
    target: {
      consequence:
        "Practice-area coverage and content are reasonable, so the opportunity is depth and matter-intent sharpening rather than missing pages.",
      fix: "Sharpen the existing service pages around the specific matters the firm wants more of.",
    },
    screen: {
      consequence:
        "The contact path is present, so the opportunity is qualification and routing rather than a broken intake.",
      fix: "Layer CaseLoad Screen on the existing contact path so every inquiry is scored and routed by fit.",
    },
  };
  const c = copy[pillar];
  return {
    title: `${PILLAR_LABEL[pillar]} looks solid`,
    businessConsequence: c.consequence,
    evidence: `No material ${PILLAR_LABEL[pillar]} gaps surfaced in this scan.`,
    recommendedFix: c.fix,
    confidence: "medium",
    sourceCategory: PILLAR_LABEL[pillar],
  };
}

function pickFindings(issues: SeoCheckIssue[], pillar: ActsPillar, limit = 4): DiagnosticFinding[] {
  const matched = issues
    .filter((i) => classifyActs(i.category, i.title) === pillar)
    .slice(0, limit)
    .map((i) => toFinding(i, pillar));
  if (matched.length === 0) return [strengthFinding(pillar)];
  return matched;
}

/* ────────────────────────────────────────────────────────
   Domain comparison
   ──────────────────────────────────────────────────────── */

function maturityFor(result: SeoCheckResult): string {
  if (result.internalSummary?.websiteMaturity) return result.internalSummary.websiteMaturity;
  const s = result.overallScore;
  if (s < 35) return "poor";
  if (s < 55) return "basic";
  if (s < 75) return "decent";
  return "strong";
}

function buildDomainComparison(scans: DomainScan[]): DomainComparison {
  const rows: DomainComparisonRow[] = scans.map((scan) => {
    if (!scan.result) {
      return {
        domain: scan.domain,
        role: scan.role,
        reachable: false,
        pagesScanned: 0,
        overallScore: null,
        aiSearchScore: null,
        maturity: null,
        note: scan.error ? `Did not scan cleanly: ${scan.error}` : "Did not return a result.",
      };
    }
    const maturity = maturityFor(scan.result);
    return {
      domain: scan.domain,
      role: scan.role,
      reachable: true,
      pagesScanned: scan.result.pagesScanned,
      overallScore: scan.result.overallScore,
      aiSearchScore: scan.result.aiSearchScore,
      maturity,
      note: `${scan.result.pagesScanned} page${scan.result.pagesScanned === 1 ? "" : "s"} scanned, ${maturity} maturity.`,
    };
  });

  const reachable = rows.filter((r) => r.reachable && r.overallScore !== null);
  const strongest =
    reachable.length > 0
      ? reachable.reduce((best, r) => (r.overallScore! > best.overallScore! ? r : best)).domain
      : null;

  const fragmentationFlagged = reachable.length >= 2;

  let canonicalRecommendation: string;
  if (fragmentationFlagged && strongest) {
    canonicalRecommendation = `More than one live domain is carrying the firm's presence. Pick one canonical home (${strongest} reads cleanest on this scan), 301-redirect the others into it, then update citations and profiles so every signal points to one address.`;
  } else if (reachable.length === 1) {
    canonicalRecommendation = `Only ${reachable[0].domain} returned a clean scan. Confirm whether the other domains are still live; retire or redirect any that are, so the firm's authority is not split.`;
  } else {
    canonicalRecommendation = "No domain returned a clean scan, so a canonical recommendation is not possible yet.";
  }

  return { rows, fragmentationFlagged, strongestDomain: strongest, canonicalRecommendation };
}

function fragmentationFinding(comparison: DomainComparison): DiagnosticFinding {
  const live = comparison.rows.filter((r) => r.reachable).map((r) => r.domain);
  return {
    title: "Multiple live domains fragment the firm's identity",
    businessConsequence:
      "The firm's reputation, links, and search signals are split across more than one domain, so no single address accumulates the full authority. Search and AI systems see a divided entity instead of one clear firm.",
    evidence: `${live.length} live domains scanned: ${live.join(", ")}.`,
    recommendedFix: comparison.canonicalRecommendation,
    confidence: "medium",
    sourceCategory: "Authority / Domain identity",
  };
}

/* ────────────────────────────────────────────────────────
   Outreach hooks, questions, opening angle, plan
   ──────────────────────────────────────────────────────── */

function dedupe(arr: string[]): string[] {
  return [...new Set(arr.map((s) => s.trim()).filter(Boolean))];
}

function buildOutreachHooks(primary: SeoCheckResult | null, issues: SeoCheckIssue[]): string[] {
  const fromSummary = primary?.internalSummary?.strongestOutreachHooks ?? [];
  if (fromSummary.length > 0) return dedupe(fromSummary).slice(0, 3);
  return dedupe(issues.slice(0, 6).map((i) => i.prospectingAngle || "")).slice(0, 3);
}

function buildStrategicQuestions(
  prospect: ProspectInput,
  actsFindings: ProspectingDiagnostic["actsFindings"],
  primary: SeoCheckResult | null
): string[] {
  const questions: string[] = [];

  if (prospect.alternateDomains.length > 0) {
    questions.push("Which domain do you treat as the firm's primary home online, and what are the others used for?");
  }

  questions.push("Which matter types matter most to the firm right now, and which would you like more of?");
  questions.push("Are you trying to increase total inquiries, or improve the quality and fit of the inquiries you already get?");
  questions.push("When a new inquiry arrives today, what happens to it before it reaches a lawyer?");
  questions.push("Do you separate urgent, complex, and low-fit inquiries before consults, or do they all flow through the same path?");
  questions.push("Which practice areas feel underrepresented online compared with the work you actually want?");

  // Authority-weighted question when the firm's visibility signals are thin.
  const aiThin = (primary?.aiSearchScore ?? 100) < 55;
  const authorityGap = actsFindings.authority.some((f) => !f.title.endsWith("looks solid"));
  if (aiThin || authorityGap) {
    questions.push("How are clients finding the firm today, mostly referrals, search, or paid ads?");
  }

  return dedupe(questions).slice(0, 7);
}

function imperative(fix: string): string {
  const trimmed = fix.trim();
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

function buildPlan(actsFindings: ProspectingDiagnostic["actsFindings"]): ProspectingDiagnostic["thirtySixtyNinetyPlan"] {
  const captureFixes = actsFindings.capture
    .filter((f) => !f.title.endsWith("looks solid"))
    .slice(0, 2)
    .map((f) => imperative(f.recommendedFix));

  const screenContactFix = actsFindings.screen
    .filter((f) => !f.title.endsWith("looks solid"))
    .slice(0, 1)
    .map((f) => imperative(f.recommendedFix));

  const day30 = dedupe([
    ...captureFixes,
    ...screenContactFix,
    "Stand up CaseLoad Screen on the firm's contact path so every new inquiry is scored, qualified, and routed before it reaches a lawyer.",
  ]).slice(0, 4);

  const authorityFixes = actsFindings.authority
    .filter((f) => !f.title.endsWith("looks solid"))
    .slice(0, 2)
    .map((f) => imperative(f.recommendedFix));

  const targetFixes = actsFindings.target
    .filter((f) => !f.title.endsWith("looks solid"))
    .slice(0, 1)
    .map((f) => imperative(f.recommendedFix));

  const day60 = dedupe([
    ...authorityFixes,
    ...targetFixes,
    "Build or sharpen a page per core practice area, written around how clients describe each matter.",
  ]).slice(0, 4);

  const day90 = dedupe([
    "Set a steady cadence of matter-intent content and client reviews so authority compounds month over month.",
    "Tune the CaseLoad Screen routing bands to the matters the firm wants more of, and review what the intake data shows.",
    "Reassess local visibility and AI search presence against the firm's priority practice areas.",
  ]).slice(0, 4);

  return { day30, day60, day90 };
}

/* ────────────────────────────────────────────────────────
   Report + cold email + agenda text
   ──────────────────────────────────────────────────────── */

function leadPillarAndFinding(
  issues: SeoCheckIssue[],
  actsFindings: ProspectingDiagnostic["actsFindings"]
): { pillar: ActsPillar; finding: DiagnosticFinding } {
  const lead = issues[0];
  if (lead) {
    const pillar = classifyActs(lead.category, lead.title);
    return { pillar, finding: toFinding(lead, pillar) };
  }
  // No issues at all: lead on Screen as the product entry point.
  return { pillar: "screen", finding: actsFindings.screen[0] };
}

function lowerFirst(s: string): string {
  const trimmed = s.trim();
  if (!trimmed) return trimmed;
  const lowered = trimmed.charAt(0).toLowerCase() + trimmed.slice(1);
  return /[.!?]$/.test(lowered) ? lowered : `${lowered}.`;
}

function buildReportSummary(
  prospect: ProspectInput,
  scanSummary: ProspectingDiagnostic["scanSummary"],
  leadPillar: ActsPillar,
  leadFinding: DiagnosticFinding,
  openingAngle: string
): string {
  const where = prospect.market.trim() ? prospect.market.trim() : "its market";
  const focus = prospect.practiceFocus.trim() ? `, with a focus on ${prospect.practiceFocus.trim()}` : "";
  const pageWord = scanSummary.pagesScanned === 1 ? "page" : "pages";

  const comparison =
    prospect.alternateDomains.length > 0
      ? `, compared against ${prospect.alternateDomains.join(", ")},`
      : "";
  const para1 = `${prospect.firmName} serves ${where}${focus}. A bounded scan of ${prospect.primaryDomain} (${scanSummary.pagesScanned} ${pageWord})${comparison} read the firm's public web presence through the ACTS lens: Authority, Capture, Target, and Screen.`;

  const para2 = `The clearest commercial opportunity sits in ${PILLAR_LABEL[leadPillar]}. ${leadFinding.businessConsequence}`;

  const para3 = `Across the four pillars the pattern is consistent: the gaps are mechanical to close and most of the work compounds over time. The recommended opening for a strategic call is ${lowerFirst(openingAngle)}`;

  return [para1, para2, para3].join("\n\n");
}

const OPERATOR_NAME = "Adriano Domingues";
const OPERATOR_EMAIL = "adriano@caseloadselect.ca";

export function formatColdEmail(
  prospect: ProspectInput,
  leadPillar: ActsPillar
): string {
  const subject = `Subject: Quick observation about ${prospect.firmName}'s matter acquisition path`;
  const observation = OBSERVATION_BY_PILLAR[leadPillar];
  const consequence = CONSEQUENCE_CLAUSE_BY_PILLAR[leadPillar];
  const audience = prospect.market.trim() ? `law firms in ${prospect.market.trim()}` : "law firms";

  const body = [
    "Hi [First name],",
    `I was reviewing ${prospect.firmName}'s public web presence this week and noticed ${observation}.`,
    `It points to ${consequence}.`,
    "That is the kind of gap that costs a firm good matters without ever showing up as a traffic number.",
    `We work with ${audience} to connect search visibility, AI visibility, and the intake path, so inquiries are easier to qualify and route.`,
    "Would a short strategic call next week be worth it, to walk through what I found?",
    "Best,",
    `${OPERATOR_NAME}`,
    `CaseLoad Select`,
    `${OPERATOR_EMAIL}`,
  ].join("\n\n");

  return `${subject}\n\n${body}`;
}

export function formatCallAgenda(diag: ProspectingDiagnostic): string {
  const lines: string[] = [];
  lines.push(`Strategic call agenda: ${diag.prospect.firmName}`);
  lines.push("");
  lines.push(`Opening angle: ${diag.recommendedOpeningAngle}`);
  lines.push("");
  lines.push("Questions to work through:");
  diag.strategicCallQuestions.forEach((q, i) => lines.push(`${i + 1}. ${q}`));
  lines.push("");
  lines.push("Where CaseLoad Select fits (ACTS):");
  (["authority", "capture", "target", "screen"] as ActsPillar[]).forEach((pillar) => {
    const top = diag.actsFindings[pillar][0];
    if (top) lines.push(`- ${PILLAR_LABEL[pillar]}: ${top.title}. ${top.businessConsequence}`);
  });
  lines.push("");
  lines.push("First 30 days:");
  diag.thirtySixtyNinetyPlan.day30.forEach((item) => lines.push(`- ${item}`));
  return lines.join("\n");
}

export function formatReportText(diag: ProspectingDiagnostic): string {
  const lines: string[] = [];
  lines.push(`CaseLoad Select prospecting diagnostic: ${diag.prospect.firmName}`);
  lines.push(`Domains checked: ${diag.scanSummary.domainsChecked.join(", ")}`);
  lines.push(
    `Primary scan: ${diag.scanSummary.scanMode}, ${diag.scanSummary.pagesScanned} pages on ${diag.prospect.primaryDomain} (${diag.scanSummary.totalPagesScanned} pages across all domains), ${diag.scanSummary.checkedAt}`
  );
  lines.push("");
  lines.push(diag.reportReadySummary);
  lines.push("");

  (["authority", "capture", "target", "screen"] as ActsPillar[]).forEach((pillar) => {
    lines.push(`${PILLAR_LABEL[pillar].toUpperCase()}`);
    diag.actsFindings[pillar].forEach((f) => {
      lines.push(`- ${f.title} (confidence: ${f.confidence})`);
      lines.push(`  Business consequence: ${f.businessConsequence}`);
      lines.push(`  Evidence: ${f.evidence}`);
      lines.push(`  Recommended fix: ${f.recommendedFix}`);
    });
    lines.push("");
  });

  if (diag.domainComparison) {
    lines.push("DOMAIN COMPARISON");
    diag.domainComparison.rows.forEach((r) => {
      const score = r.overallScore === null ? "not reachable" : `internal score ${r.overallScore}/100`;
      lines.push(`- ${r.domain} (${r.role}): ${r.note} ${r.reachable ? score : ""}`.trim());
    });
    lines.push(`Canonical recommendation: ${diag.domainComparison.canonicalRecommendation}`);
    lines.push("");
  }

  lines.push("TOP OUTREACH HOOKS");
  diag.topOutreachHooks.forEach((h) => lines.push(`- ${h}`));
  lines.push("");
  lines.push("30 / 60 / 90 DAY PLAN");
  lines.push("First 30 days:");
  diag.thirtySixtyNinetyPlan.day30.forEach((i) => lines.push(`- ${i}`));
  lines.push("Days 30 to 60:");
  diag.thirtySixtyNinetyPlan.day60.forEach((i) => lines.push(`- ${i}`));
  lines.push("Days 60 to 90:");
  diag.thirtySixtyNinetyPlan.day90.forEach((i) => lines.push(`- ${i}`));

  return lines.join("\n");
}

/* ────────────────────────────────────────────────────────
   Top-level builder
   ──────────────────────────────────────────────────────── */

export function buildProspectingDiagnostic(
  prospect: ProspectInput,
  scans: DomainScan[]
): ProspectingDiagnostic {
  const primaryScan = scans.find((s) => s.role === "primary") ?? scans[0];
  const primary = primaryScan?.result ?? null;
  const issues = primary?.issues ?? [];

  // ACTS findings come off the primary scan only.
  const actsFindings: ProspectingDiagnostic["actsFindings"] = {
    authority: pickFindings(issues, "authority"),
    capture: pickFindings(issues, "capture"),
    target: pickFindings(issues, "target"),
    screen: pickFindings(issues, "screen"),
  };

  // Domain comparison + fragmentation finding when alternates were supplied.
  let domainComparison: DomainComparison | undefined;
  if (prospect.alternateDomains.length > 0) {
    domainComparison = buildDomainComparison(scans);
    if (domainComparison.fragmentationFlagged) {
      actsFindings.authority = [fragmentationFinding(domainComparison), ...actsFindings.authority].slice(0, 4);
    }
  }

  const { pillar: leadPillar, finding: leadFinding } = leadPillarAndFinding(issues, actsFindings);

  const recommendedOpeningAngle =
    (primary?.internalSummary?.recommendedOpeningAngle || "").trim() ||
    leadFinding?.businessConsequence ||
    "Open on the firm's strongest practice area and where its site is quietly underselling it.";

  const domainsChecked = scans.map((s) => s.domain);
  const totalPagesScanned = scans.reduce((sum, s) => sum + (s.result?.pagesScanned ?? 0), 0);
  const scanSummary = {
    checkedAt: primary?.checkedAt ?? new Date().toISOString(),
    pagesScanned: primary?.pagesScanned ?? 0,
    totalPagesScanned,
    scanMode: primary?.scanMode ?? "quick",
    domainsChecked,
  };

  const topOutreachHooks = buildOutreachHooks(primary, issues);
  const strategicCallQuestions = buildStrategicQuestions(prospect, actsFindings, primary);
  const thirtySixtyNinetyPlan = buildPlan(actsFindings);
  const reportReadySummary = buildReportSummary(prospect, scanSummary, leadPillar, leadFinding, recommendedOpeningAngle);
  const coldEmailDraft = formatColdEmail(prospect, leadPillar);

  return {
    prospect: {
      firmName: prospect.firmName,
      primaryDomain: prospect.primaryDomain,
      alternateDomains: prospect.alternateDomains,
      market: prospect.market,
      practiceFocus: prospect.practiceFocus,
      competitors: prospect.competitors,
      notes: prospect.notes,
    },
    scanSummary,
    actsFindings,
    domainComparison,
    topOutreachHooks,
    strategicCallQuestions,
    recommendedOpeningAngle,
    thirtySixtyNinetyPlan,
    reportReadySummary,
    coldEmailDraft,
  };
}

/* ────────────────────────────────────────────────────────
   Scan orchestration (pure, UI-agnostic, injectable)

   The client component is a thin shell over these. Keeping plan-building and
   the run loop here (with the scan function and AbortSignal injected) lets the
   cap, the dropped-count, the cancel-before-primary-fail ordering, and the
   alternate-failure handling be unit-tested without a DOM.
   ──────────────────────────────────────────────────────── */

export interface ScanQueueItem {
  domain: string;
  role: "primary" | "alternate";
  mode: ScanMode;
}

/**
 * Build the ordered scan queue from operator input: primary first at the chosen
 * depth, then deduped alternates (minus the primary) in quick mode, capped at
 * maxAlternates. Reports how many alternates were dropped so the cap is never
 * silent.
 */
export function buildScanPlan(
  primary: string,
  rawAlternates: string[],
  primaryMode: ScanMode,
  maxAlternates: number
): { queue: ScanQueueItem[]; capped: string[]; dropped: number } {
  const deduped = [...new Set(rawAlternates.filter((d) => d && d !== primary))];
  const capped = deduped.slice(0, Math.max(0, maxAlternates));
  const dropped = deduped.length - capped.length;
  const queue: ScanQueueItem[] = [
    { domain: primary, role: "primary", mode: primaryMode },
    ...capped.map((d) => ({ domain: d, role: "alternate" as const, mode: "quick" as ScanMode })),
  ];
  return { queue, capped, dropped };
}

export type RunScansOutcome =
  | { kind: "ok"; scans: DomainScan[] }
  | { kind: "cancelled"; index: number }
  | { kind: "primary_failed"; domain: string; error?: string };

export interface RunScansDeps {
  scan: (
    domain: string,
    mode: ScanMode,
    signal: AbortSignal
  ) => Promise<{ result: SeoCheckResult | null; error?: string }>;
  signal: AbortSignal;
  onProgress?: (index: number, status: ScanProgressStatus, error?: string) => void;
}

/**
 * Run the queue sequentially. Cancellation is checked BEFORE the primary-failure
 * branch, so a cancel never reads as a primary scan error. A failed PRIMARY
 * stops the run; a failed alternate is collected as an unreachable DomainScan
 * and the run continues.
 */
export async function runScans(queue: ScanQueueItem[], deps: RunScansDeps): Promise<RunScansOutcome> {
  const collected: DomainScan[] = [];
  for (let i = 0; i < queue.length; i++) {
    const q = queue[i];
    deps.onProgress?.(i, "scanning");
    const { result, error } = await deps.scan(q.domain, q.mode, deps.signal);

    if (deps.signal.aborted) {
      deps.onProgress?.(i, "error", "cancelled");
      return { kind: "cancelled", index: i };
    }
    if (q.role === "primary" && !result) {
      deps.onProgress?.(i, "error", error);
      return { kind: "primary_failed", domain: q.domain, error };
    }

    collected.push({ domain: q.domain, role: q.role, result, error });
    deps.onProgress?.(i, result ? "done" : "error", error);
  }
  return { kind: "ok", scans: collected };
}

/* Re-export for the client component's internal scores panel. */
export type { SeoCheckResult, Confidence };
