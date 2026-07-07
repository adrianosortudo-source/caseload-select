/**
 * Per-firm "How your content works" cadence config.
 *
 * Drives the ContentCadencePanel on the deliverables portal (summary variant)
 * and its own /portal/[firmId]/how-your-content-works page (full variant). This
 * is structured data, NOT operator free-HTML, so it renders as a real component
 * instead of going through the firm_about sanitizer allowlist.
 *
 * Source of truth for the schedule: drg_strategy_v2.upload.json
 * weekly_edition_cadence (6x/week: 3 GBP + 3 LinkedIn, Tuesday + Thursday).
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

export interface ContentCadence {
  eyebrow: string;
  headline: string;
  lede: string;
  approve: { pieces: string; theme: string; day: string; note: string };
  promise: { label: string };
  pieces: CadencePiece[];
  days: CadenceDay[];
  rows: CadenceRow[];
  counts: { n: string; l: string }[];
  magnet: { heading: string; body: string; steps: CadenceStep[] };
  adhoc: string;
  referenceLinks: CadenceReferenceLink[];
}

const DRG_CADENCE: ContentCadence = {
  eyebrow: "About this content",
  headline: "One approval builds a full week of visibility",
  lede:
    "Every Tuesday you approve three pieces in a single batch. From that one decision, your firm publishes an edition and posts to social six times across the week. Here is where each piece goes.",
  approve: {
    pieces: "pieces, one batch",
    theme: "theme, every channel",
    day: "publication day",
    note:
      "The weekly batch is the default. You can still add an off-cycle item any time something urgent needs to go out.",
  },
  promise: {
    label: "Your whole week of content, from one batch you sign off on.",
  },
  pieces: [
    {
      kind: "Counsel Note",
      name: "The main article",
      desc: "A full walk-through of one decision an Ontario business owner actually faces.",
      tag: "Anchor piece",
      icon: "note",
    },
    {
      kind: "Clause in the Margin",
      name: "One clause, read closely",
      desc: "A short close-read of a single clause owners sign without negotiating.",
      tag: "Clause review",
      icon: "clause",
    },
    {
      kind: "Checklist",
      name: "A one-page action list",
      desc: "A practical, download-ready page tied to the week's theme.",
      tag: "Action tool + lead magnet",
      icon: "checklist",
    },
  ],
  days: [{ label: "Tuesday" }, { label: "Wednesday", quiet: true }, { label: "Thursday" }],
  rows: [
    {
      channel: "website",
      label: "Website",
      cells: [
        [{ slot: "AM · full edition", piece: "All three pieces", detail: "publish together as one weekly edition" }],
        null,
        null,
      ],
    },
    {
      channel: "linkedin",
      label: "LinkedIn",
      cells: [
        [
          { slot: "Post · AM", piece: "Counsel Note", detail: "links to the new article" },
          { slot: "Post · PM", piece: "Checklist", detail: "promotes the free download" },
        ],
        null,
        [{ slot: "Post", piece: "Clause in the Margin", detail: "links to its own article" }],
      ],
    },
    {
      channel: "gbp",
      label: "Google profile",
      cells: [
        [
          { slot: "AM card", piece: "Counsel Note", detail: "drives readers to the article" },
          { slot: "PM card", piece: "Checklist", detail: "drives the free download" },
        ],
        null,
        [{ slot: "AM card", piece: "Clause in the Margin", detail: "drives readers to the article" }],
      ],
    },
  ],
  counts: [
    { n: "1×", l: "website edition" },
    { n: "3×", l: "LinkedIn posts" },
    { n: "3×", l: "Google profile posts" },
    { n: "6×", l: "social touches, one approval" },
  ],
  magnet: {
    heading: "The same Checklist, offered as a free download",
    body:
      "The Checklist you already approved also sits behind a short form on your site. A reader gives a name and email, the file unlocks, and you keep a way to reach someone who liked your content but was not ready to submit for review yet.",
    steps: [
      { title: "Reader wants it", desc: "The Checklist promises something practical." },
      { title: "Form asks name + email", desc: "Two fields unlock the PDF." },
      { title: "You keep the contact", desc: "A follow-up path stays open." },
    ],
  },
  adhoc:
    "The weekly batch is the default, not a limit. If you ever want to publish outside this rhythm, an off-cycle update, a one-off note, an urgent clarification, the portal still accepts it any time.",
  referenceLinks: [],
};

const CADENCE_BY_FIRM: Record<string, ContentCadence> = {
  [DRG_FIRM_ID]: DRG_CADENCE,
};

/** Returns the firm's cadence config, or null when the firm has none. Pure. */
export function getContentCadence(firmId: string): ContentCadence | null {
  return CADENCE_BY_FIRM[firmId] ?? null;
}
