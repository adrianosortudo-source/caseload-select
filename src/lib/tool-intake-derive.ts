/**
 * Pure derivation functions for /api/tool-intake.
 *
 * Maps DRG website lead-magnet tool data into screened_leads-compatible
 * fields: matter type, practice area, four-axis scores, and band.
 *
 * Lower-intent signal: tool leads come from visitors who used a calculator
 * or assessment tool on the firm website. They are information-seeking, not
 * help-seeking. The axes reflect this: readiness and urgency are set low,
 * so tool leads naturally land in Band B or C (never A).
 */

// ─── ToolResult types (mirrored from DRG lead-magnet-compute.ts) ────────────

export interface ToolResultRow {
  label: string;
  value: string;
  weight?: 'primary' | 'warning' | 'muted' | 'default';
  hint?: string;
}

export interface ToolResultGroup {
  title?: string;
  rows: ToolResultRow[];
}

export interface ToolResultList {
  title: string;
  intent?: 'missing' | 'risk' | 'in-place';
  items: string[];
}

export interface ToolResult {
  headline: string;
  subline?: string;
  groups: ToolResultGroup[];
  lists?: ToolResultList[];
  recommendation: string;
  sources?: string[];
}

// ─── Tool-slug to matter-type mapping ───────────────────────────────────────

const TOOL_TO_MATTER_TYPE: Record<string, string> = {
  'ontario-ltt-calculator': 'residential_purchase',
  'personal-guarantee-estimator': 'commercial_lease',
  'new-business-structure-check': 'business_setup_advisory',
  'founders-ownership-worksheet': 'business_setup_advisory',
  'succession-readiness-check': 'will_drafting',
  'retainer-vs-per-matter-calculator': 'general_counsel_advisory',
  'minute-book-readiness-check': 'corporate_maintenance',
  'notary-scope-confirmation': 'notary_services',
  'severance-range-estimator': 'severance_review',
  'business-legal-readiness-score': 'business_setup_advisory',
  'closing-cash-to-close': 'residential_purchase',
};

const PRACTICE_SLUG_TO_AREA: Record<string, string> = {
  'corporate': 'corporate',
  'real-estate': 'real_estate',
  'employment': 'employment',
  'estates': 'estates',
  'succession': 'estates',
  'fractional-counsel': 'corporate',
  'contract-review': 'corporate',
  'records-upkeep': 'corporate',
  'notary': 'corporate',
};

export function toolSlugToMatterType(toolSlug: string): string {
  return TOOL_TO_MATTER_TYPE[toolSlug] ?? 'unknown';
}

export function practiceSlugToArea(practiceSlug: string): string {
  const cleaned = practiceSlug.replace(/^\//, '');
  return PRACTICE_SLUG_TO_AREA[cleaned] ?? 'unknown';
}

// ─── Axis derivation ────────────────────────────────────────────────────────

export interface ToolAxes {
  value: number;
  complexity: number;
  urgency: number;
  readiness: number;
}

/**
 * Conservative axis values for tool leads.
 *
 * Readiness (2): researching via a calculator, not contacting a lawyer.
 * Urgency (2): no time pressure indicated by tool usage alone.
 * Complexity (5): neutral, no signal either way.
 * Value (4): default; specific tools can override via tool-aware derivation.
 */
export function deriveToolAxes(): ToolAxes {
  return {
    value: 4,
    complexity: 5,
    urgency: 2,
    readiness: 2,
  };
}

// ─── Band derivation ────────────────────────────────────────────────────────

/**
 * Tool leads are capped at Band B (never A). With readiness=2 and
 * urgency=2, they are inherently lower-intent than full intake submissions.
 *
 * Band B: value >= 6 (the tool data suggests a meaningful matter)
 * Band C: default
 */
export function deriveToolBand(axes: ToolAxes): 'B' | 'C' {
  return axes.value >= 6 ? 'B' : 'C';
}

// ─── Lead ID ────────────────────────────────────────────────────────────────

/**
 * Generate a tool-lead ID. Format: T-YYYY-MM-DD-XXXX (distinguishable from
 * standard L-YYYY-MM-DD-XXX lead IDs at a glance).
 */
export function generateToolLeadId(): string {
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const rand = Math.floor(Math.random() * 65536).toString(16).toUpperCase().padStart(4, '0');
  return `T-${date}-${rand}`;
}
