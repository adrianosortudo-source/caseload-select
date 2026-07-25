/**
 * Per-firm "How your content works" configuration.
 *
 * Drives the ContentCadencePanel on the deliverables portal (summary variant)
 * and its own /portal/[firmId]/how-your-content-works page (full variant). This
 * is structured data, not operator free HTML, so it renders as a real component
 * instead of going through the firm_about sanitizer allowlist.
 *
 * DRG's entry deliberately keeps TWO explicit, separated states rather than
 * one blended one: what the current week actually contains and what is still
 * pending. As of the renewal-clause week the package is 16 deliverables, of
 * which 15 are published across three channels (website, LinkedIn, Google
 * Business Profile). The sixteenth is The DRG Law Minute: built, counted, and
 * NOT sent. Email becomes a fourth channel only on the first week the Minute
 * clears every gate.
 *
 * Two invariants this copy must never break. A reader must not come away
 * believing the earlier 13-deliverable week (the relocation clause) is
 * incomplete: it was produced at that size and is complete at it. And the
 * Minute must never be described as having reached anyone, because it has
 * not.
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

export interface CadenceMetricGroup {
  label: string;
  metrics: CadenceMetric[];
}

export interface CadenceHistoricalNote {
  heading: string;
  body: string;
}

export interface CadenceFutureFormat {
  eyebrow: string;
  name: string;
  tag: string;
  desc: string;
  availabilityLabel: string;
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
  intro: string;
  /** Explicit callout so the earlier 13-deliverable week never reads as incomplete. */
  historicalNote: CadenceHistoricalNote;
  /** The two-column "published now" vs "once the Minute sends" summary. Never blended into one set of numbers. */
  approve: {
    current: CadenceMetricGroup;
    next: CadenceMetricGroup;
    capacityNote: string;
  };
  /** The dark flow band: two lines, published then pending, never merged into one. */
  promise: {
    current: { label: string; metrics: CadenceMetric[] };
    next: { label: string; metrics: CadenceMetric[]; note: string };
  };
  sectionLabels: { pieces: string; schedule: string; magnet: string; minute: string };
  summaryCta: string;
  /** Format breakdown of the published 15. Never includes the Minute, which has not sent. */
  pieces: CadencePiece[];
  /** Format-breakdown total line (8 + 2 + 2 + 3 + 1 = 16). */
  counts: { n: string; l: string }[];
  /** The Minute's not-yet-sent card, kept structurally separate from `pieces`. */
  futureFormat: CadenceFutureFormat;
  days: CadenceDay[];
  rows: CadenceRow[];
  magnet: { heading: string; body: string; steps: CadenceStep[] };
  /** The DRG Law Minute operating rules, section 4 of the full panel. Not-yet-sent, restated as such. */
  minute: CadenceMinute;
  transition: { heading: string; body: string };
  referenceLinks: CadenceReferenceLink[];
}

const DRG_CADENCE: ContentCadence = {
  eyebrow: "Content publication model",
  headline: "Sixteen assets a week. Fifteen published, one still to send",
  intro:
    "The current weekly package for DRG is 16 deliverables in two languages. Fifteen are published across the website, LinkedIn, and Google Business Profile. The sixteenth is the DRG Law Minute: written and counted, but not yet sent. Email becomes a fourth channel on the first week it clears every gate.",
  historicalNote: {
    heading: "The earlier 13-deliverable week is complete at that size",
    body:
      "The relocation-clause week was produced as a 13-deliverable batch and is finished at that size, not missing three pieces. The renewal-clause week is the first at 16, adding two native LinkedIn Articles and the DRG Law Minute.",
  },
  approve: {
    current: {
      label: "Published now",
      metrics: [
        { value: "15", label: "published" },
        { value: "2", label: "languages" },
        { value: "3", label: "channels" },
      ],
    },
    next: {
      label: "Once the Minute sends",
      metrics: [
        { value: "16", label: "deliverables" },
        { value: "2", label: "languages" },
        { value: "4", label: "channels" },
      ],
    },
    capacityNote:
      "The sixteenth artifact is not a quota. It depends on Damaris's available legal-review capacity and every applicable quality, legal-safety, consent, route, asset, and release requirement.",
  },
  promise: {
    current: {
      label: "Published now:",
      metrics: [
        { value: "1", label: "weekly theme", underline: true },
        { value: "15", label: "published" },
        { value: "3", label: "channels", underline: true },
      ],
    },
    next: {
      label: "Once the Minute sends:",
      metrics: [
        { value: "1", label: "weekly theme", underline: true },
        { value: "16", label: "deliverables" },
        { value: "4", label: "channels", underline: true },
      ],
      note: "When capacity and release requirements are met.",
    },
  },
  sectionLabels: {
    pieces: "The 16-deliverable week, format by format",
    schedule: "Where the week publishes",
    magnet: "The Preparation Artifact also captures consented interest",
    minute: "Still to send: the DRG Law Minute",
  },
  summaryCta: "See the full sixteen",
  pieces: [
    {
      kind: "Counsel Note · EN + PT",
      name: "Two owned articles",
      desc: "The same Ontario decision authored independently for English and Portuguese readers.",
      tag: "2 deliverables",
      icon: "note",
    },
    {
      kind: "Clause in the Margin · EN + PT",
      name: "Two owned close-reads",
      desc: "One representative clause examined in two original language versions.",
      tag: "2 deliverables",
      icon: "clause",
    },
    {
      kind: "Preparation Artifact · EN + PT",
      name: "Two PDFs and two landing pages",
      desc: "A practical working document plus its complete English and Portuguese placement.",
      tag: "4 deliverables",
      icon: "checklist",
    },
    {
      kind: "Native LinkedIn Article · EN",
      name: "Two long-form LinkedIn Articles",
      desc: "The Counsel Note and the Clause in the Margin adapted to be read inside LinkedIn itself rather than linked away from it.",
      tag: "2 deliverables",
      icon: "note",
    },
  ],
  counts: [
    { n: "8", l: "owned EN/PT assets" },
    { n: "2", l: "LinkedIn posts" },
    { n: "2", l: "native LinkedIn Articles" },
    { n: "3", l: "GBP decision ads" },
    { n: "1", l: "DRG Law Minute" },
    { n: "16", l: "deliverables" },
  ],
  futureFormat: {
    eyebrow: "Written, not yet sent",
    name: "The DRG Law Minute",
    tag: "1 English client newsletter",
    desc: "Maintains DRG's judgment between matters through one useful weekly idea and a reply-or-forward relationship close.",
    availabilityLabel: "Counted in the sixteen. It has not sent, and email is not a live channel until it does.",
  },
  days: [{ label: "Tuesday" }, { label: "Wednesday" }, { label: "Thursday" }],
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
        ],
        null,
        [
          {
            slot: "Lead-magnet pair",
            piece: "Preparation Artifact · EN + PT",
            detail: "two PDFs plus two landing pages",
            count: 4,
          },
        ],
      ],
    },
    {
      channel: "linkedin",
      label: "LinkedIn",
      cells: [
        [
          {
            slot: "Native post · EN",
            piece: "Counsel Note companion post",
            detail: "English reader entry point, extends the weekly theme",
            count: 1,
          },
          {
            slot: "Native Article · EN",
            piece: "Counsel Note adaptation",
            detail: "the same argument read inside LinkedIn, not linked away",
            count: 1,
          },
        ],
        null,
        [
          {
            slot: "Native post · EN",
            piece: "Clause in the Margin companion post",
            detail: "English reader entry point, extends the weekly theme",
            count: 1,
          },
          {
            slot: "Native Article · EN",
            piece: "Clause in the Margin adaptation",
            detail: "the same close-read inside LinkedIn, not linked away",
            count: 1,
          },
        ],
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
        [
          {
            slot: "Decision ad",
            piece: "Preparation Artifact",
            detail: "drives the consented download",
            count: 1,
          },
        ],
        [
          {
            slot: "Decision ad",
            piece: "Clause in the Margin",
            detail: "drives readers to the close-read",
            count: 1,
          },
        ],
      ],
    },
  ],
  magnet: {
    heading: "The EN/PT Preparation Artifact is also the week's lead magnet",
    body:
      "Each week includes the English and Portuguese PDFs and their matching landing pages. The form asks for delivery information and requires affirmative consent to marketing communications. When the reader consents, the PDF is delivered and the contact enters the approved follow-up path. Consent and unsubscribe state remain recorded.",
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
    heading: "The DRG Law Minute is written but has not sent",
    intro:
      "It is the sixteenth deliverable of the current week and it has reached no one yet. It is a short, English-only weekly note to clients who have already said yes to hearing from the firm: relationship correspondence, not a lead-generation push, with no promotional or intake call to action. Until it sends, email is not a live channel for DRG.",
    rules: [
      "Sent Wednesday only, after Tuesday's linked pages are verified live.",
      "Goes only to recipients with a documented active consent basis, no recorded unsubscribe, and a valid applicable sending basis, checked in a consent audit before every send.",
      "Sender identity is Damaris Guimaraes of DRG Law, reply-to info@drglaw.ca, triaged by the team; a reply is not a guarantee Damaris personally answers it.",
      "Every linked page is verified live before the note goes out.",
    ],
    readinessNote:
      "It counts as a deliverable because it is written and held, never because it was delivered. If any requirement is unmet on its eligible week, the edition does not send that week, full stop.",
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
