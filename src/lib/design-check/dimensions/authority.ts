import type { AuthoritySnapshot, DomSnapshot } from "../render-types";
import { type CheckItem, scoreItems } from "../dimension-types";
import { scanForLexiconHits, scoreClaimIntegrity, type LexiconHit } from "../authority-lexicon";
import { AUTHORITY_JUDGMENT_RUBRIC_ITEMS, type AuthorityJudgmentScore } from "../authority-vision";

/**
 * Authority and Positioning dimension (Phase 3), built against
 * WEBSITE_AUTHORITY_SIGNAL_MODULE.md. Absorbs and replaces the master
 * framework's compressed dimension-8 (Trust and credibility) bullets per
 * the build plan.
 *
 * Scope note: the module specifies several cross-page checks (message
 * consistency across home/about/service, site-wide NAP consistency).
 * Those are out of scope per the operator's 2026-07-16 v1 single-URL
 * decision and are reported as explicit "requires multi-page crawl"
 * informational items, not approximated from the single page. See build
 * plan §7 item 4.
 *
 * The LSO Rule 4.2-1 overlay (module Part 3) is always applied, not
 * switchable: this product serves Ontario law firms exclusively per the
 * workspace doctrine, so there is no non-Ontario vertical to switch to in
 * v1. A future non-Ontario overlay would need its own gate here.
 */

// ---------------------------------------------------------------------------
// Schema helpers
// ---------------------------------------------------------------------------

interface JsonLdNode {
  "@type"?: string | string[];
  [key: string]: unknown;
}

function isJsonLdNode(value: unknown): value is JsonLdNode {
  return typeof value === "object" && value !== null;
}

/** Flattens JSON-LD's array/@graph shapes into one list of nodes. */
function flattenJsonLd(blocks: unknown[]): JsonLdNode[] {
  const nodes: JsonLdNode[] = [];
  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!isJsonLdNode(value)) return;
    nodes.push(value);
    if (Array.isArray((value as { "@graph"?: unknown })["@graph"])) {
      visit((value as { "@graph"?: unknown })["@graph"]);
    }
  };
  blocks.forEach(visit);
  return nodes;
}

function nodesOfType(nodes: JsonLdNode[], type: string): JsonLdNode[] {
  return nodes.filter((n) => {
    const t = n["@type"];
    if (typeof t === "string") return t === type;
    if (Array.isArray(t)) return t.includes(type);
    return false;
  });
}

// ---------------------------------------------------------------------------
// Positioning clarity (weight 20)
// ---------------------------------------------------------------------------

function checkMetaClarity(authority: AuthoritySnapshot): CheckItem {
  const title = authority.metaTitle?.trim() ?? "";
  const description = authority.metaDescription?.trim() ?? "";
  if (!title || !description) {
    return {
      label: "Meta title and description present",
      status: "fail",
      detail: !title && !description ? "No meta title or description found." : !title ? "No meta title found." : "No meta description found.",
      fix: "Set a meta title and description that name the practice focus and location, not just the firm name.",
    };
  }
  const looksGeneric = /^(\S+\s+){0,3}\|?\s*(home|welcome)/i.test(title);
  if (looksGeneric) {
    return {
      label: "Meta title and description present",
      status: "warn",
      detail: `Title reads generic: "${title}".`,
      fix: "State the practice focus and city in the title, not a bare firm name or \"Home\".",
    };
  }
  return { label: "Meta title and description present", status: "pass", detail: `Title: "${title}".` };
}

function checkH1Present(domSnapshot: DomSnapshot): CheckItem {
  if (!domSnapshot.h1Text) {
    return { label: "Hero H1 present", status: "fail", detail: "No H1 found in the first viewport." };
  }
  return { label: "Hero H1 present", status: "pass", detail: `"${domSnapshot.h1Text.slice(0, 100)}"` };
}

function buildFiveSecondClarityItem(judgment: AuthorityJudgmentScore | undefined): CheckItem {
  if (!judgment) {
    return { label: "5-second clarity (what, who, benefit, why-us)", status: "pass", detail: "Vision judgment not run for this scan.", scored: false };
  }
  return scoreFromJudgment("5-second clarity (what, who, benefit, why-us)", judgment);
}

// ---------------------------------------------------------------------------
// Differentiation (weight 18)
// ---------------------------------------------------------------------------

const GENERIC_FULL_SERVICE_THRESHOLD = 6;

function checkGenericFullService(authority: AuthoritySnapshot): CheckItem {
  const labels = authority.practiceAreaLabels;
  if (labels.length === 0) {
    return { label: "Named focus vs. generic full-service list", status: "pass", detail: "No equal-weight practice-area list detected to check.", scored: false };
  }
  if (labels.length >= GENERIC_FULL_SERVICE_THRESHOLD) {
    return {
      label: "Named focus vs. generic full-service list",
      status: "warn",
      detail: `${labels.length} practice areas listed at equal visual weight, with no stated focus among them.`,
      fix: 'Name a primary focus or niche ("primarily X, also handling Y and Z") rather than listing every area as equally weighted.',
    };
  }
  return { label: "Named focus vs. generic full-service list", status: "pass", detail: `${labels.length} practice area(s) listed, within a focused range.` };
}

function checkMessageConsistencyNotRun(): CheckItem {
  return {
    label: "Message consistency across home, about, and service pages",
    status: "pass",
    detail: "Requires a multi-page crawl. Not run in v1 (single-URL scope); this page's positioning was not compared against other pages on the site.",
    scored: false,
  };
}

function scoreFromJudgment(label: string, judgment: AuthorityJudgmentScore): CheckItem {
  const status = judgment.score >= 70 ? "pass" : judgment.score >= 40 ? "warn" : "fail";
  return { label, status, detail: `${judgment.score}/100. ${judgment.reason}` };
}

// ---------------------------------------------------------------------------
// Expertise and author signals (weight 18)
// ---------------------------------------------------------------------------

function checkAuthorEntity(authority: AuthoritySnapshot): CheckItem {
  if (authority.authorBylines.length === 0) {
    return {
      label: "Named author entity present",
      status: "fail",
      detail: "No named byline or author markup found on this page.",
      fix: "Attribute content to a named, credentialed person rather than leaving it unattributed.",
    };
  }
  const withProfile = authority.authorBylines.filter((b) => b.hasProfileLink);
  if (withProfile.length === 0) {
    return {
      label: "Named author entity present",
      status: "warn",
      detail: `A byline is present ("${authority.authorBylines[0].text}") but does not link to a profile or bio.`,
      fix: "Link the byline to a bio page with role, credentials, and practice areas.",
    };
  }
  return { label: "Named author entity present", status: "pass", detail: `"${withProfile[0].text}", linked to a profile.` };
}

function checkPersonSchema(personNodes: JsonLdNode[]): CheckItem {
  if (personNodes.length === 0) {
    return {
      label: "Person schema present",
      status: "warn",
      detail: "No Person structured data found.",
      fix: "Add Person schema (name, jobTitle, credential, affiliation) for named authors and lawyers.",
    };
  }
  return { label: "Person schema present", status: "pass", detail: `${personNodes.length} Person entity(ies) found in structured data.` };
}

// ---------------------------------------------------------------------------
// Third-party validation (weight 20)
// ---------------------------------------------------------------------------

function checkReviewSchema(nodes: JsonLdNode[]): CheckItem {
  const aggregateRatings = nodesOfType(nodes, "AggregateRating");
  const reviews = nodesOfType(nodes, "Review");
  if (aggregateRatings.length === 0 && reviews.length === 0) {
    return {
      label: "Review or rating structured data",
      status: "fail",
      detail: "No AggregateRating or Review schema found on this page.",
      fix: "Add AggregateRating schema (ratingValue, reviewCount) linked to a real review source such as Google Business Profile.",
    };
  }
  const withCount = aggregateRatings.filter((r) => typeof r.reviewCount === "number" || typeof r.ratingCount === "number");
  if (aggregateRatings.length > 0 && withCount.length === 0) {
    return {
      label: "Review or rating structured data",
      status: "warn",
      detail: "AggregateRating schema found but no reviewCount/ratingCount value.",
      fix: "Populate reviewCount so the rating reads as a real, checkable sample rather than a bare number.",
    };
  }
  return {
    label: "Review or rating structured data",
    status: "pass",
    detail: `${aggregateRatings.length} AggregateRating and ${reviews.length} Review entity(ies) found.`,
  };
}

function checkTestimonialAttribution(authority: AuthoritySnapshot): CheckItem {
  if (authority.testimonials.length === 0) {
    return { label: "Testimonial attribution", status: "pass", detail: "No testimonial blocks detected to check.", scored: false };
  }
  const unattributed = authority.testimonials.filter((t) => !t.hasAttribution);
  if (unattributed.length > 0) {
    return {
      label: "Testimonial attribution",
      status: "fail",
      detail: `${unattributed.length} of ${authority.testimonials.length} testimonial(s) carry no visible name or attribution.`,
      fix: "Attribute each testimonial to a name and, where possible, a matter type. An unattributed quote is not verifiable proof.",
    };
  }
  return { label: "Testimonial attribution", status: "pass", detail: `All ${authority.testimonials.length} testimonial(s) carry visible attribution.` };
}

const CREDENTIAL_MENTION_PATTERN = /certified specialist|law society of ontario|\blso\b|call(?:ed)? to the bar|member of the .*(bar|association)|accredited by/i;

function checkCredentialMentions(authority: AuthoritySnapshot): CheckItem {
  const found = CREDENTIAL_MENTION_PATTERN.test(authority.firmVoicedText);
  if (!found) {
    return {
      label: "Named credentials or association membership",
      status: "warn",
      detail: "No named bar admission, Law Society standing, or association membership found in on-page copy.",
      fix: "State named credentials (bar admission, Law Society standing, association membership) rather than relying on general claims of experience.",
    };
  }
  return { label: "Named credentials or association membership", status: "pass", detail: "On-page copy names at least one verifiable credential or association." };
}

function checkPressAndDirectoryNotRun(): CheckItem {
  return {
    label: "Press mentions and directory presence",
    status: "pass",
    detail: "Requires an external mention/citation index. Not checkable from this page's own content in v1.",
    scored: false,
  };
}

// ---------------------------------------------------------------------------
// Trust and transparency (weight 12)
// ---------------------------------------------------------------------------

// English-primary with Portuguese/French terms added: the master doctrine
// treats Toronto's multilingual market as a deliberate, load-bearing
// competitive position, not an edge case, and the sakurabalaw.ca fixture
// this tool is regression-tested against is itself Portuguese-language.
// Confirmed live: without pt/fr coverage, that fixture's real "Sobre Nós"
// (About Us) link went undetected. Not exhaustive multilingual coverage;
// a genuine gap for any other language, disclosed rather than silent.
const ABOUT_LINK_PATTERN = /about|our firm|our team|meet the team|sobre( n[oó]s)?|notre (cabinet|(é|e)quipe)|(à|a) propos/i;
const TEAM_LINK_PATTERN = /team|our lawyers|attorneys|people|equipe|(é|e)quipe|advogados|avocats/i;

function hasLinkMatching(authority: AuthoritySnapshot, pattern: RegExp): boolean {
  return [...authority.navLinks, ...authority.footerLinks].some((l) => pattern.test(l.text) || pattern.test(l.href));
}

function checkAboutTeamPagePresent(authority: AuthoritySnapshot): CheckItem {
  const hasAbout = hasLinkMatching(authority, ABOUT_LINK_PATTERN);
  const hasTeam = hasLinkMatching(authority, TEAM_LINK_PATTERN);
  if (!hasAbout && !hasTeam) {
    return {
      label: "About or team page linked",
      status: "fail",
      detail: "No About or team page link found in navigation or footer.",
      fix: "Add a linked About or team page naming real people, not just a bare contact form.",
    };
  }
  return { label: "About or team page linked", status: "pass", detail: `${hasAbout ? "About" : ""}${hasAbout && hasTeam ? " and " : ""}${hasTeam ? "team" : ""} page linked.` };
}

function checkOrganizationSchema(nodes: JsonLdNode[]): CheckItem {
  const orgNodes = nodesOfType(nodes, "Organization").concat(nodesOfType(nodes, "LegalService")).concat(nodesOfType(nodes, "Attorney"));
  if (orgNodes.length === 0) {
    return {
      label: "Organization schema present",
      status: "warn",
      detail: "No Organization, LegalService, or Attorney structured data found.",
      fix: "Add Organization (or LegalService) schema with name, address, and contact details.",
    };
  }
  return { label: "Organization schema present", status: "pass", detail: `${orgNodes.length} Organization-family entity(ies) found.` };
}

const NAP_PHONE_PATTERN = /\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/;
// Abbreviation periods are optional: real addresses (especially ones
// copy-pasted from a Google Maps link, as on the sakurabalaw.ca fixture:
// "120 Eglinton Ave E") routinely drop the period. Confirmed live: the
// literal "ave\." form missed a real, present address on that fixture.
const NAP_ADDRESS_PATTERN = /\b\d{1,5}\s+\w+.*\b(street|st\.?|avenue|ave\.?|road|rd\.?|drive|dr\.?|suite|floor)\b/i;

function checkNapPresent(authority: AuthoritySnapshot): CheckItem {
  const hasPhone = NAP_PHONE_PATTERN.test(authority.firmVoicedText);
  const hasAddress = NAP_ADDRESS_PATTERN.test(authority.firmVoicedText);
  if (!hasPhone && !hasAddress) {
    return {
      label: "Name, address, and phone visible on this page",
      status: "fail",
      detail: "No phone number or street address found in on-page text.",
      fix: "Show a phone number and physical address on the page, not only inside a contact form.",
    };
  }
  if (!hasPhone || !hasAddress) {
    return {
      label: "Name, address, and phone visible on this page",
      status: "warn",
      detail: `${hasPhone ? "Phone number found" : "No phone number found"}; ${hasAddress ? "address found" : "no street address found"}.`,
      fix: "Show both a phone number and a street address on the page.",
    };
  }
  return { label: "Name, address, and phone visible on this page", status: "pass", detail: "Phone number and street address both found on this page." };
}

function checkNapCrossPageNotRun(): CheckItem {
  return {
    label: "NAP consistency across the site",
    status: "pass",
    detail: "Requires a multi-page crawl to cross-check name/address/phone against other pages and directory listings. Not run in v1.",
    scored: false,
  };
}

function checkDisclaimerPresent(authority: AuthoritySnapshot): CheckItem {
  if (!authority.disclaimerPresent) {
    return {
      label: "Legal-information disclaimer present",
      status: "fail",
      detail: "No legal-information disclaimer found in the visible page text.",
      fix: 'Add a disclaimer ("legal information, not legal advice") before substantive content, per LSO Rule 4.2-1 and DR-082.',
    };
  }
  return { label: "Legal-information disclaimer present", status: "pass", detail: "A legal-information disclaimer was found on the page." };
}

function checkHttps(finalUrl: string): CheckItem {
  const isHttps = finalUrl.startsWith("https://");
  return isHttps
    ? { label: "HTTPS", status: "pass", detail: "Page served over HTTPS." }
    : { label: "HTTPS", status: "fail", detail: "Page is not served over HTTPS.", fix: "Serve the site over HTTPS with a valid certificate." };
}

// ---------------------------------------------------------------------------
// Claim integrity (weight 12) — the earned-versus-claimed classifier
// ---------------------------------------------------------------------------

/** Words permitted only with a certified_specialist / award_basis signal
 * (module Part 3). v1 has no per-firm config input, so the gate is
 * evaluated purely from on-page evidence: a "specialist"/"expert" hit
 * counts as gated-open only when the proof window around it names the
 * LSO Certified Specialist designation specifically. */
const CERTIFIED_SPECIALIST_EVIDENCE = /certified specialist/i;

function buildClaimIntegrityItems(hits: LexiconHit[]): CheckItem[] {
  const items: CheckItem[] = [];
  const naked = hits.filter((h) => !h.hasAdjacentProof);
  const proofBacked = hits.filter((h) => h.hasAdjacentProof);

  if (hits.length === 0) {
    items.push({ label: "Self-designation and superlative language", status: "pass", detail: "No self-designation or superlative language found in on-page copy.", scored: false });
    return items;
  }

  if (naked.length > 0) {
    const sample = naked.slice(0, 3).map((h) => `"${h.term}" ("${h.context}")`).join("; ");
    items.push({
      label: "Naked self-designation claims",
      status: "fail",
      detail: `${naked.length} claim(s) with no adjacent verifiable proof: ${sample}${naked.length > 3 ? "; and more" : ""}.`,
      fix: 'Remove unbacked superlatives, or pair each with adjacent verifiable proof (a named credential, a dated review, a specific case).',
    });
  } else {
    items.push({ label: "Naked self-designation claims", status: "pass", detail: "No self-designation claims found without adjacent proof." });
  }

  if (proofBacked.length > 0) {
    items.push({
      label: "Proof-backed strong claims",
      status: "pass",
      detail: `${proofBacked.length} strong claim(s) sit next to verifiable evidence.`,
      scored: false,
    });
  }

  // LSO overlay: specialist/expert without the Certified Specialist
  // designation is a compliance breach, not merely a weak claim, per
  // module Part 3. Gate re-evaluated per hit against a tighter pattern
  // than the general proof window.
  const gatedBreaches = hits.filter((h) => h.gatable && !CERTIFIED_SPECIALIST_EVIDENCE.test(h.context));
  if (gatedBreaches.length > 0) {
    const terms = [...new Set(gatedBreaches.map((h) => h.term))].join(", ");
    items.push({
      label: 'LSO Rule 4.2-1: "specialist"/"expert" without the Certified Specialist designation',
      status: "fail",
      detail: `Found: ${terms}. LSO permits "specialist" only for a lawyer holding the Certified Specialist designation, with the practice area named.`,
      fix: 'Remove the term, or replace it with the named LSO Certified Specialist designation and practice area if the lawyer actually holds it.',
    });
  }

  return items;
}

// ---------------------------------------------------------------------------
// Red flags (dimension-level capping, module "Red flags that cap the
// dimension"). Applied after sub-scores combine, never averaged in.
// ---------------------------------------------------------------------------

export interface AuthorityRedFlag {
  key: string;
  label: string;
  detail: string;
  ceiling: number;
  /** Whether this flag caps the OVERALL Track 1 grade (see
   * docs/BUILD_PLAN_design_check_calibration_v1.md Phase 3, classification
   * table). "disqualifying" flags represent active harm or real
   * compliance exposure (LSO breaches, unverifiable superiority claims).
   * "advisory" flags are real opportunities, not harm, and never cap the
   * overall grade; they still rank first among findings. This field does
   * NOT change how this dimension's own internal score is capped below:
   * every flag, of either classification, still caps the Authority
   * dimension's own score, since a flag of any kind is real evidence
   * about this dimension specifically, at dimension scope. The
   * disqualifying/advisory split only governs whether a flag can cap the
   * OTHER nine dimensions (typography, contrast, performance, and so on)
   * that have nothing to do with it. */
  classification: "disqualifying" | "advisory";
}

function detectRedFlags(
  authority: AuthoritySnapshot,
  hits: LexiconHit[],
  proofBackedCount: number,
  personNodeCount: number,
  visionJudgments: AuthorityJudgmentScore[] | undefined
): AuthorityRedFlag[] {
  const flags: AuthorityRedFlag[] = [];
  const naked = hits.filter((h) => !h.hasAdjacentProof);

  if (naked.length > 0 && proofBackedCount === 0) {
    flags.push({
      key: "self_designation_without_proof",
      label: "Self-designation without proof",
      detail: "Strong-quality words appear with no verifiable evidence anywhere on the page.",
      ceiling: 40,
      // Unverifiable superiority claims sit inside LSO Rule 4.2-1 scope
      // ("Ontario / LSO Rule 4.2-1 compliance... no unverifiable
      // superlatives"), the same regulatory ground as the other LSO
      // flags below, not a stylistic opportunity.
      classification: "disqualifying",
    });
  }
  if (authority.practiceAreaLabels.length >= GENERIC_FULL_SERVICE_THRESHOLD) {
    flags.push({
      key: "generic_full_service",
      label: "Generic full-service positioning",
      detail: `${authority.practiceAreaLabels.length} practice areas listed with no named niche or stated point of difference.`,
      ceiling: 55,
      classification: "advisory", // a positioning opportunity, not harm
    });
  }
  if (authority.authorBylines.length === 0 && personNodeCount === 0) {
    flags.push({
      key: "no_author_entity",
      label: "No author entity on any content",
      detail: "No named byline and no Person schema found on this page.",
      ceiling: 55,
      // Fires on 5 of the 6 regression domains: a market-wide gap, not a
      // defect specific to any one site. See docs/CALIBRATION_PROPOSAL_
      // website_design_grading_v1.md "What the data actually shows".
      classification: "advisory",
    });
  }
  const unattributedTestimonials = authority.testimonials.filter((t) => !t.hasAttribution);
  if (unattributedTestimonials.length > 0 && unattributedTestimonials.length === authority.testimonials.length) {
    flags.push({
      key: "unattributed_testimonials",
      label: "Testimonials with no attribution",
      detail: `All ${authority.testimonials.length} testimonial(s) on this page carry no name or verifiable basis.`,
      ceiling: 60,
      classification: "advisory", // a credibility opportunity, not harm
    });
  }

  // LSO overlay capping flags (module Part 3, always-on for this product).
  const gatedBreach = hits.some((h) => h.gatable && !CERTIFIED_SPECIALIST_EVIDENCE.test(h.context));
  if (gatedBreach) {
    flags.push({
      key: "lso_specialist_expert_unearned",
      label: 'LSO Rule 4.2-1: "specialist"/"expert" without the Certified Specialist designation',
      detail: "This term is only LSO-compliant for a lawyer holding the Certified Specialist designation, named alongside the practice area.",
      ceiling: 40,
      classification: "disqualifying",
    });
  }
  const prohibitedHit = hits.some((h) => h.category === "prohibited");
  if (prohibitedHit) {
    flags.push({
      key: "lso_prohibited_word",
      label: 'LSO Rule 4.2-1: prohibited superiority word ("best", "super", "#1")',
      detail: "These words are named as prohibited in the Rule 4.2-1 commentary regardless of adjacent proof.",
      ceiling: 40,
      classification: "disqualifying",
    });
  }
  const lawMarketingHit = hits.some((h) => h.category === "law_marketing");
  if (lawMarketingHit) {
    flags.push({
      key: "lso_aggressive_framing",
      label: "Aggressiveness or dominance framing",
      detail: 'Language such as "dominate" or "pit bull" reads as aggressiveness framing rather than earned authority.',
      ceiling: 55,
      classification: "disqualifying",
    });
  }

  // Best-effort only: outcome/timing guarantees need the vision model's
  // read of surrounding context to avoid false positives on the lexicon's
  // bare "guarantee" match (a known false-positive class from Content
  // Studio's own validator work: "personal guarantee" is a legitimate
  // legal noun, not an outcome promise). Flag only when the vision model
  // itself scored point_of_difference or five_second_clarity low AND a
  // guarantee-family term is present, as corroboration rather than a
  // standalone lexical trigger.
  const guaranteeHit = hits.some((h) => h.term === "guarantee");
  const lowClarityJudgment = visionJudgments?.find((j) => j.item === "five_second_clarity" && j.score < 40);
  if (guaranteeHit && lowClarityJudgment) {
    flags.push({
      key: "possible_outcome_guarantee",
      label: "Possible outcome or result guarantee (best-effort)",
      detail: 'A "guarantee" term was found alongside a low positioning-clarity read. Manually confirm whether this is an outcome promise or a legitimate use (e.g. "personal guarantee").',
      ceiling: 55,
      classification: "disqualifying", // an outcome promise is direct LSO Rule 4.2-1 exposure
    });
  }

  return flags;
}

// ---------------------------------------------------------------------------
// Dimension assembly
// ---------------------------------------------------------------------------

export interface AuthoritySubScoreResult {
  key: string;
  name: string;
  /** Weight within this dimension's internal 100 points, per module table. */
  weight: number;
  score: number;
  items: CheckItem[];
}

export interface AuthorityDimensionResult {
  name: string;
  /** This dimension's weight in the overall Track 1 aggregation. Phase 4
   * owns final cross-dimension weight reconciliation; this is a
   * placeholder consistent with the other dimensions' magnitude. */
  weight: number;
  score: number;
  maxScore: number;
  subScores: AuthoritySubScoreResult[];
  redFlags: AuthorityRedFlag[];
  cappedAt: number | null;
}

function judgmentByKey(judgments: AuthorityJudgmentScore[] | undefined, key: string): AuthorityJudgmentScore | undefined {
  return judgments?.find((j) => j.item === key);
}

function subScorePercent(items: CheckItem[]): number {
  const { score, maxScore } = scoreItems(items);
  if (maxScore === 0) return 100; // nothing scorable found; do not penalize
  return Math.round((score / maxScore) * 100);
}

export function scoreAuthority(
  domSnapshot: DomSnapshot,
  finalUrl: string,
  visionJudgments: AuthorityJudgmentScore[] | undefined
): AuthorityDimensionResult {
  const authority = domSnapshot.authority;
  const jsonLdNodes = flattenJsonLd(authority.jsonLd);
  const personNodes = nodesOfType(jsonLdNodes, "Person");
  const lexiconHits = scanForLexiconHits(authority.firmVoicedText);
  const claimIntegrity = scoreClaimIntegrity(lexiconHits);

  const positioningClarityItems: CheckItem[] = [checkMetaClarity(authority), checkH1Present(domSnapshot), buildFiveSecondClarityItem(judgmentByKey(visionJudgments, "five_second_clarity"))];

  const differentiationItems: CheckItem[] = [checkGenericFullService(authority), checkMessageConsistencyNotRun()];
  const pointOfDifference = judgmentByKey(visionJudgments, "point_of_difference");
  const namedMethod = judgmentByKey(visionJudgments, "named_method");
  const buyerSituation = judgmentByKey(visionJudgments, "buyer_situation_language");
  if (pointOfDifference) differentiationItems.push(scoreFromJudgment("Checkable point of difference stated", pointOfDifference));
  if (namedMethod) differentiationItems.push(scoreFromJudgment("Named method or process described", namedMethod));
  if (buyerSituation) differentiationItems.push(scoreFromJudgment("Speaks to recognizable buyer situations", buyerSituation));

  const expertiseItems: CheckItem[] = [checkAuthorEntity(authority), checkPersonSchema(personNodes)];
  const proofAuthenticity = judgmentByKey(visionJudgments, "proof_authenticity");
  const authorCredibility = judgmentByKey(visionJudgments, "author_credibility");
  if (proofAuthenticity) expertiseItems.push(scoreFromJudgment("Proof reads as first-hand and specific", proofAuthenticity));
  if (authorCredibility) expertiseItems.push(scoreFromJudgment("Bio reads as a real credentialed person", authorCredibility));

  const thirdPartyItems: CheckItem[] = [checkReviewSchema(jsonLdNodes), checkTestimonialAttribution(authority), checkCredentialMentions(authority), checkPressAndDirectoryNotRun()];

  const trustItems: CheckItem[] = [checkNapPresent(authority), checkNapCrossPageNotRun(), checkAboutTeamPagePresent(authority), checkOrganizationSchema(jsonLdNodes), checkDisclaimerPresent(authority), checkHttps(finalUrl)];

  const claimIntegrityItems = buildClaimIntegrityItems(lexiconHits);

  const subScores: AuthoritySubScoreResult[] = [
    { key: "positioning_clarity", name: "Positioning clarity", weight: 20, score: subScorePercent(positioningClarityItems), items: positioningClarityItems },
    { key: "differentiation", name: "Differentiation", weight: 18, score: subScorePercent(differentiationItems), items: differentiationItems },
    { key: "expertise_author_signals", name: "Expertise and author signals", weight: 18, score: subScorePercent(expertiseItems), items: expertiseItems },
    { key: "third_party_validation", name: "Third-party validation", weight: 20, score: subScorePercent(thirdPartyItems), items: thirdPartyItems },
    { key: "trust_transparency", name: "Trust and transparency", weight: 12, score: subScorePercent(trustItems), items: trustItems },
    { key: "claim_integrity", name: "Claim integrity", weight: 12, score: claimIntegrity.score, items: claimIntegrityItems },
  ];

  const weightedTotal = subScores.reduce((sum, s) => sum + (s.score * s.weight) / 100, 0);

  const redFlags = detectRedFlags(authority, lexiconHits, claimIntegrity.proofBackedHits.length, personNodes.length, visionJudgments);
  const ceiling = redFlags.length > 0 ? Math.min(...redFlags.map((f) => f.ceiling)) : null;
  const finalScore = ceiling !== null ? Math.min(weightedTotal, ceiling) : weightedTotal;

  return {
    name: "Authority and Positioning",
    weight: 15,
    score: Math.round(finalScore),
    maxScore: 100,
    subScores,
    redFlags,
    cappedAt: ceiling,
  };
}

export { AUTHORITY_JUDGMENT_RUBRIC_ITEMS };
