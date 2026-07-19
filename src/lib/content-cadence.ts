/**
 * Per-firm "How your content works" configuration.
 *
 * Drives the ContentCadencePanel on the deliverables portal (summary variant)
 * and its own /portal/[firmId]/how-your-content-works page (full variant). This
 * is structured data, not operator free HTML, so it renders as a real component
 * instead of going through the firm_about sanitizer allowlist.
 *
 * DRG's entry now documents the capacity-controlled v5.2 model: up to 14
 * coordinated artifacts per approved theme, across two languages and four
 * channels (website, LinkedIn, Google Business Profile, and the new weekly
 * "DRG Law Minute" relationship email), released on a Tuesday-Wednesday
 * window. This model starts with the next NEW weekly theme, not with The
 * Renewal Clause: that period is a completed 13-deliverable, 3-channel
 * historical batch and stays one (no Minute row, no email destination exist
 * for it, and none is being added retroactively). The previously completed
 * 13-deliverable, 3-channel batches (the finite backlog produced before
 * v5.2) are preserved as an explicit historical callout (`historicalNote`)
 * rather than deleted, since those weeks are still being reviewed, placed,
 * and published.
 *
 * A firm with no entry here falls back to the plain AboutPanel on the
 * deliverables page. Adding a firm is a data entry, not a rebuild.
 */

const DRG_FIRM_ID = "eec1d25e-a047-4827-8e4a-6eb96becca2b";

export type PieceIcon = "note" | "clause" | "checklist" | "minute";
export type Channel = "website" | "linkedin" | "gbp" | "email";

export interface CadencePiece {
  kind: string;
  name: string;
  desc: string;
  tag: string;
  icon: PieceIcon;
}

export interface CadenceCard {
  slot: string;
  piece: string;
  detail: string;
  count: number;
}

export interface CadenceRow {
  channel: Channel;
  label: string;
  /** One entry per day column, aligned to `days`. null renders as a quiet dash. */
  cells: (CadenceCard[] | null)[];
}

export interface CadenceDay {
  label: string;
  quiet?: boolean;
}

export interface CadenceStep {
  title: string;
  desc: string;
}

export interface CadenceReferenceLink {
  label: string;
  url: string;
}

export interface CadenceMetric {
  value: string;
  label: string;
  underline?: boolean;
}

export interface CadenceHistoricalNote {
  heading: string;
  body: string;
}

export interface CadenceMinute {
  heading: string;
  intro: string;
  rules: string[];
  readinessNote: string;
}

export interface ContentCadence {
  eyebrow: string;
  headline: string;
  lede: string;
  /** Explicit callout preserving the historical 13-deliverable backlog facts. */
  historicalNote: CadenceHistoricalNote;
  approve: { heading: string; metrics: CadenceMetric[]; note: string };
  promise: { metrics: CadenceMetric[]; label: string };
  sectionLabels: { pieces: string; schedule: string; magnet: string; minute: string };
  summaryCta: string;
  pieces: CadencePiece[];
  days: CadenceDay[];
  rows: CadenceRow[];
  counts: { n: string; l: string }[];
  magnet: { heading: string; body: string; steps: CadenceStep[] };
  /** The DRG Law Minute weekly relationship email, section 4 of the full panel. */
  minute: CadenceMinute;
  transition: { heading: string; body: string };
  referenceLinks: CadenceReferenceLink[];
}

const DRG_CADENCE: ContentCadence = {
  eyebrow: "About this content",
  headline: "One approved theme can produce up to 14 coordinated artifacts",
  lede:
    "This is a ceiling per approved theme, not a fixed weekly quota: up to 14 coordinated artifacts across two languages and four channels, and anything not ready, reviewed, or compliant does not ship that week.",
  historicalNote: {
    heading: "The 13-deliverable batches are the backlog, not the new standard",
    body:
      "The completed 13-deliverable weeks are the current backlog. Starting with the next new weekly theme, DRG's capacity-controlled model may include the DRG Law Minute as a fourteenth artifact across four channels.",
  },
  approve: {
    heading: "What one approved theme can produce",
    metrics: [
      { value: "14", label: "artifacts" },
      { value: "2", label: "languages" },
      { value: "4", label: "channels" },
      { value: "Tue-Wed", label: "release window" },
    ],
    note:
      "Capacity is a ceiling, not a promise: the artifacts above are what one theme can produce at most, and quality gates decide how many actually ship.",
  },
  promise: {
    metrics: [
      { value: "1", label: "weekly theme", underline: true },
      { value: "14", label: "artifacts" },
      { value: "4", label: "channels", underline: true },
    ],
    label: "One weekly theme, produced across up to 14 artifacts and 4 channels.",
  },
  sectionLabels: {
    pieces: "The four artifact families in every theme",
    schedule: "Where the artifacts publish",
    magnet: "The Preparation Artifact also captures consented interest",
    minute: "The fourth channel: a weekly relationship email",
  },
  summaryCta: "See the full production model",
  pieces: [
    {
      kind: "Explain",
      name: "Counsel Note · EN + PT",
      desc: "The same Ontario decision authored independently for English and Portuguese readers.",
      tag: "2 artifacts",
      icon: "note",
    },
    {
      kind: "Examine",
      name: "Clause in the Margin · EN + PT",
      desc: "One representative clause examined in two original language versions.",
      tag: "2 artifacts",
      icon: "clause",
    },
    {
      kind: "Prepare",
      name: "Preparation Artifact · EN + PT",
      desc: "A practical working document plus its complete English and Portuguese placement.",
      tag: "4 artifacts",
      icon: "checklist",
    },
    {
      kind: "Maintain relationship",
      name: "The DRG Law Minute",
      desc: "A short English-only weekly note to clients who already said yes to hearing from the firm, not another lead-generation push.",
      tag: "1 artifact",
      icon: "minute",
    },
  ],
  days: [{ label: "Tuesday" }, { label: "Wednesday" }],
  rows: [
    {
      channel: "website",
      label: "Owned by DRG",
      cells: [
        [
          {
            slot: "Article pair",
            piece: "Counsel Note · EN + PT",
            detail: "two canonical website articles",
            count: 2,
          },
          {
            slot: "Article pair",
            piece: "Clause in the Margin · EN + PT",
            detail: "two canonical close-read articles",
            count: 2,
          },
          {
            slot: "Lead-magnet pair",
            piece: "Preparation Artifact · EN + PT",
            detail: "two PDFs plus two landing pages",
            count: 4,
          },
        ],
        null,
      ],
    },
    {
      channel: "linkedin",
      label: "LinkedIn",
      cells: [
        [
          {
            slot: "Native post · EN",
            piece: "English reader entry point",
            detail: "extends the weekly theme",
            count: 1,
          },
        ],
        null,
      ],
    },
    {
      channel: "gbp",
      label: "Google profile",
      cells: [
        [
          {
            slot: "Decision ad",
            piece: "Counsel Note",
            detail: "drives readers to the article",
            count: 1,
          },
        ],
        null,
      ],
    },
    {
      channel: "email",
      label: "The DRG Law Minute",
      cells: [
        null,
        [
          {
            slot: "Weekly note",
            piece: "The DRG Law Minute",
            detail: "sends only after Tuesday's linked pages verify live",
            count: 1,
          },
        ],
      ],
    },
  ],
  counts: [
    { n: "8", l: "owned EN/PT assets" },
    { n: "1", l: "LinkedIn post" },
    { n: "1", l: "Google profile post" },
    { n: "1", l: "weekly Minute" },
    { n: "14", l: "artifacts possible per theme" },
  ],
  magnet: {
    heading: "The EN/PT Preparation Artifact is also the week's lead magnet",
    body:
      "Each theme includes the English and Portuguese PDFs and their matching landing pages. The form asks for delivery information and requires affirmative consent to marketing communications. When the reader consents, the PDF is delivered and the contact enters the approved follow-up path. Consent and unsubscribe state remain recorded.",
    steps: [
      { title: "Reader wants it", desc: "The artifact promises something practical." },
      {
        title: "Form records consent",
        desc: "Name, email, and affirmative marketing consent are required for delivery.",
      },
      {
        title: "Delivery and follow-up begin",
        desc: "The PDF is delivered and the consented contact enters the approved communication path.",
      },
    ],
  },
  minute: {
    heading: "The DRG Law Minute keeps the relationship warm",
    intro:
      "A short, English-only weekly note to clients who have already said yes to hearing from the firm. It is relationship correspondence, not a lead-generation push, and it carries no promotional or intake call to action.",
    rules: [
      "Sent Wednesday only, after Tuesday's linked pages are verified live.",
      "Goes only to recipients with a documented active consent basis, no recorded unsubscribe, and a valid applicable sending basis, checked in a consent audit before every send.",
      "Sender identity is Damaris Guimaraes of DRG Law, reply-to info@drglaw.ca, triaged by the team; a reply is not a guarantee Damaris personally answers it.",
      "Every linked page is verified live before the note goes out.",
    ],
    readinessNote: "If any requirement is unmet, the edition does not send that week, full stop.",
  },
  transition: {
    heading: "Capacity discipline, not incomplete shipping",
    body:
      "An artifact that fails legal-review capacity, source readiness, consent integrity, linked-page readiness, or sender setup does not ship. It waits for the next week it clears every gate, rather than going out incomplete.",
  },
  referenceLinks: [],
};

const CADENCE_BY_FIRM: Record<string, ContentCadence> = {
  [DRG_FIRM_ID]: DRG_CADENCE,
};

/** Returns the firm's content model, or null when the firm has none. Pure. */
export function getContentCadence(firmId: string): ContentCadence | null {
  return CADENCE_BY_FIRM[firmId] ?? null;
}
