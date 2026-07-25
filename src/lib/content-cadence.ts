/**
 * Per-firm "How your content works" configuration.
 *
 * Drives the ContentCadencePanel on the deliverables portal (summary variant)
 * and its own /portal/[firmId]/how-your-content-works page (full variant). This
 * is structured data, not operator free HTML, so it renders as a real component
 * instead of going through the firm_about sanitizer allowlist.
 *
 * THIS PANEL EXPLAINS THE METHOD, NEVER THE CURRENT STATE. It answers "what
 * does the firm get each week, and how does it get published?" It must never
 * carry approval counts, publication counts, per-week progress, or anything
 * else that changes week to week. That belongs to the deliverables list
 * rendered below it, and duplicating it here turns a standing explainer into
 * a second, competing status dashboard.
 *
 * The model: 16 deliverables a week, in two languages, across four channels
 * (website, LinkedIn, Google Business Profile, email). Whether any given
 * week's pieces are drafted, approved, or already out is not this panel's
 * subject.
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
  /**
   * Optional standing caveat about the model itself. Never a status report on
   * a particular week: omit it rather than use it to explain what is or is not
   * published right now.
   */
  historicalNote?: CadenceHistoricalNote;
  /**
   * The weekly package at a glance. `next` exists only for a firm whose model
   * is genuinely mid-transition between two shapes; a settled model omits it
   * and renders one column.
   */
  approve: {
    current: CadenceMetricGroup;
    next?: CadenceMetricGroup;
    capacityNote: string;
  };
  /** The dark flow band. Second line optional, same reasoning as `approve.next`. */
  promise: {
    current: { label: string; metrics: CadenceMetric[] };
    next?: { label: string; metrics: CadenceMetric[]; note: string };
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
  headline: "Sixteen assets every week, four channels",
  intro:
    "One legal theme becomes sixteen deliverables in two languages, published across the firm's website, LinkedIn, Google Business Profile, and email. Every piece is written for DRG, reviewed by Damaris, and released only once it clears the firm's quality, legal-safety, consent, and routing requirements.",
  approve: {
    current: {
      label: "Every week",
      metrics: [
        { value: "16", label: "deliverables" },
        { value: "2", label: "languages" },
        { value: "4", label: "channels" },
      ],
    },
    capacityNote:
      "The weekly package is a shape, not a quota. What ships depends on Damaris's available legal-review capacity and every applicable quality, legal-safety, consent, route, asset, and release requirement.",
  },
  promise: {
    current: {
      label: "Every week:",
      metrics: [
        { value: "1", label: "legal theme", underline: true },
        { value: "16", label: "deliverables" },
        { value: "4", label: "channels", underline: true },
      ],
    },
  },
  sectionLabels: {
    pieces: "The weekly package, format by format",
    schedule: "Where each format publishes",
    magnet: "The Preparation Artifact also captures consented interest",
    minute: "The email channel: the DRG Law Minute",
  },
  summaryCta: "See how the week is built",
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
    eyebrow: "Relationship format",
    name: "The DRG Law Minute",
    tag: "1 English client newsletter",
    desc: "Maintains DRG's judgment between matters through one useful weekly idea and a reply-or-forward relationship close.",
    availabilityLabel: "Goes only to clients who have already consented to hear from the firm.",
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
    {
      channel: "email",
      label: "Email",
      cells: [
        null,
        [
          {
            slot: "Client note · EN",
            piece: "The DRG Law Minute",
            detail: "sent Wednesday, once Tuesday's linked pages are verified live",
            count: 1,
          },
        ],
        null,
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
    heading: "How the DRG Law Minute reaches clients",
    intro:
      "The sixteenth deliverable is a short, English-only weekly note to clients who have already said yes to hearing from the firm: relationship correspondence, not a lead-generation push, with no promotional or intake call to action. It is the only piece of the week that arrives in an inbox rather than waiting to be found, so it carries the strictest conditions.",
    rules: [
      "Sent Wednesday only, after Tuesday's linked pages are verified live.",
      "Goes only to recipients with a documented active consent basis, no recorded unsubscribe, and a valid applicable sending basis, checked in a consent audit before every send.",
      "Sender identity is Damaris Guimaraes of DRG Law, reply-to info@drglaw.ca, triaged by the team; a reply is not a guarantee Damaris personally answers it.",
      "Every linked page is verified live before the note goes out.",
    ],
    readinessNote:
      "If any requirement is unmet in a given week, that edition does not send that week, full stop. It waits rather than going out incomplete.",
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
