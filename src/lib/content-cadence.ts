/**
 * Per-firm "How your content works" configuration.
 *
 * Drives the ContentCadencePanel on the deliverables portal (summary variant)
 * and its own /portal/[firmId]/how-your-content-works page (full variant). This
 * is structured data, not operator free HTML, so it renders as a real component
 * instead of going through the firm_about sanitizer allowlist.
 *
 * DRG's current entry documents the finite 13-deliverable weekly backlog that
 * was already produced. It is not the future v5.2 cadence. After the backlog
 * is reviewed, placed, and published, the capacity-controlled v5.2 model takes
 * over.
 *
 * A firm with no entry here falls back to the plain AboutPanel on the
 * deliverables page. Adding a firm is a data entry, not a rebuild.
 */

const DRG_FIRM_ID = "eec1d25e-a047-4827-8e4a-6eb96becca2b";

export type PieceIcon = "note" | "clause" | "checklist";
export type Channel = "website" | "linkedin" | "gbp";

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

export interface ContentCadence {
  eyebrow: string;
  headline: string;
  lede: string;
  approve: { heading: string; metrics: CadenceMetric[]; note: string };
  promise: { metrics: CadenceMetric[]; label: string };
  sectionLabels: { pieces: string; schedule: string; magnet: string };
  summaryCta: string;
  pieces: CadencePiece[];
  days: CadenceDay[];
  rows: CadenceRow[];
  counts: { n: string; l: string }[];
  magnet: { heading: string; body: string; steps: CadenceStep[] };
  transition: { heading: string; body: string };
  referenceLinks: CadenceReferenceLink[];
}

const DRG_CADENCE: ContentCadence = {
  eyebrow: "About this content",
  headline: "Each completed week contains 13 coordinated deliverables",
  lede:
    "The weeks already produced were built as 13-deliverable batches: eight owned English and Portuguese assets, two LinkedIn posts, and three Google Business Profile posts. Those batches will be reviewed, placed, and published before the v5.2 model begins.",
  approve: {
    heading: "What each completed week contains",
    metrics: [
      { value: "13", label: "deliverables" },
      { value: "2", label: "languages" },
      { value: "3", label: "channels" },
    ],
    note:
      "This is the current publication backlog, not the future weekly quota. The v5.2 capacity-controlled model starts after these completed weeks are live.",
  },
  promise: {
    metrics: [
      { value: "1", label: "weekly theme", underline: true },
      { value: "13", label: "deliverables" },
      { value: "3", label: "channels", underline: true },
    ],
    label: "One weekly theme, carried through the 13 deliverables already produced.",
  },
  sectionLabels: {
    pieces: "What the completed 13-deliverable week contains",
    schedule: "Where the 13 deliverables publish",
    magnet: "The Preparation Artifact also captures consented interest",
  },
  summaryCta: "See the 13-piece week",
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
  ],
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
            piece: "English reader entry point",
            detail: "extends the weekly theme",
            count: 1,
          },
        ],
        null,
        [
          {
            slot: "Native post · PT",
            piece: "Portuguese reader entry point",
            detail: "extends the weekly theme",
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
  counts: [
    { n: "8", l: "owned EN/PT assets" },
    { n: "2", l: "LinkedIn posts" },
    { n: "3", l: "Google profile posts" },
    { n: "13", l: "deliverables in one completed week" },
  ],
  magnet: {
    heading: "The EN/PT Preparation Artifact is also the week's lead magnet",
    body:
      "Each completed week includes the English and Portuguese PDFs and their matching landing pages. The form asks for delivery information and requires affirmative consent to marketing communications. When the reader consents, the PDF is delivered and the contact enters the approved follow-up path. Consent and unsubscribe state remain recorded.",
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
  transition: {
    heading: "Finish the existing 13-deliverable backlog first.",
    body:
      "The weeks already produced remain the current publication plan. Once those assets are reviewed, placed, and published, DRG moves to the v5.2 capacity-controlled model. The 13-piece week is a finite backlog, not the future quota.",
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
