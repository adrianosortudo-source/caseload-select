/**
 * Pure aggregation for the Screen 2.0 operator metrics page (audit item 10,
 * 2026-07-02). Takes the raw screened_leads rows + an unconfirmed_inquiries
 * count and computes every summary the qualification audit's finding set
 * called for: band distribution, take/pass/refer by band, thin-brief rate,
 * inferred-classification rate, contact-capture rate, channel quality
 * (including the questions-asked gap the audit found between web and
 * voice/Meta), and source quality.
 *
 * No I/O here. The page (screen-metrics/page.tsx) does the Supabase reads
 * and passes rows into computeScreenMetrics.
 */

export type Band = "A" | "B" | "C" | "D" | null;
export type Status = "triaging" | "taken" | "passed" | "declined" | "referred";

export interface MetricsRow {
  band: Band;
  status: Status;
  matter_type: string;
  channel: string | null;
  score_confidence: string | null;
  score_completeness: number | null;
  matter_type_provenance: string | null;
  missing_field_count: number;
  utm_source: string | null;
  submitted_at: string;
  status_changed_at: string | null;
  question_count: number;
}

export interface ScreenMetrics {
  totalLeads: number;
  unconfirmedCount: number;
  contactCaptureRate: number | null; // totalLeads / (totalLeads + unconfirmedCount)
  bandDistribution: Record<string, number>; // "A" | "B" | "C" | "D" | "unrated" -> count
  actionByBand: Record<string, Record<Status, number>>;
  thinBriefRate: number | null; // share of scored rows at low confidence
  thinBriefScoredCount: number;
  inferredClassificationRate: number | null; // share of provenance-tagged rows that are llm_inferred
  provenanceTaggedCount: number;
  missingCriticalFactRate: number | null; // share of rows with score_missing_fields.length > 0, among rows with a completeness score
  channelMix: Array<{
    channel: string;
    count: number;
    bandARate: number | null; // share of this channel's rows that are Band A or B
    avgQuestionsAsked: number | null;
  }>;
  sourceQuality: Array<{
    source: string;
    count: number;
    bandABRate: number | null;
  }>;
  avgResponseHours: number | null; // avg time from submitted_at to status_changed_at for decided rows
  decidedCount: number;
}

const BAND_KEYS = ["A", "B", "C", "D", "unrated"] as const;
const STATUS_KEYS: Status[] = ["triaging", "taken", "passed", "declined", "referred"];

function bandKey(band: Band): string {
  return band ?? "unrated";
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function computeScreenMetrics(
  rows: MetricsRow[],
  unconfirmedCount: number,
): ScreenMetrics {
  const totalLeads = rows.length;

  const contactCaptureRate =
    totalLeads + unconfirmedCount > 0
      ? totalLeads / (totalLeads + unconfirmedCount)
      : null;

  const bandDistribution: Record<string, number> = {};
  for (const key of BAND_KEYS) bandDistribution[key] = 0;

  const actionByBand: Record<string, Record<Status, number>> = {};
  for (const key of BAND_KEYS) {
    actionByBand[key] = { triaging: 0, taken: 0, passed: 0, declined: 0, referred: 0 };
  }

  const scoredRows: MetricsRow[] = [];
  const provenanceTaggedRows: MetricsRow[] = [];
  const missingFactEligibleRows: MetricsRow[] = [];
  const decidedDurationsHours: number[] = [];

  const channelBuckets = new Map<string, MetricsRow[]>();
  const sourceBuckets = new Map<string, MetricsRow[]>();

  for (const row of rows) {
    const bk = bandKey(row.band);
    bandDistribution[bk] += 1;
    actionByBand[bk][row.status] += 1;

    if (row.score_confidence !== null) scoredRows.push(row);
    if (row.matter_type_provenance !== null) provenanceTaggedRows.push(row);
    if (row.score_completeness !== null) missingFactEligibleRows.push(row);

    if (row.status !== "triaging" && row.status_changed_at) {
      const submitted = new Date(row.submitted_at).getTime();
      const decided = new Date(row.status_changed_at).getTime();
      if (Number.isFinite(submitted) && Number.isFinite(decided) && decided >= submitted) {
        decidedDurationsHours.push((decided - submitted) / 3600_000);
      }
    }

    const channelKey = row.channel ?? "web";
    if (!channelBuckets.has(channelKey)) channelBuckets.set(channelKey, []);
    channelBuckets.get(channelKey)!.push(row);

    const sourceKey = row.utm_source ?? "none";
    if (!sourceBuckets.has(sourceKey)) sourceBuckets.set(sourceKey, []);
    sourceBuckets.get(sourceKey)!.push(row);
  }

  const thinBriefRate =
    scoredRows.length > 0
      ? scoredRows.filter((r) => r.score_confidence === "low").length / scoredRows.length
      : null;

  const inferredClassificationRate =
    provenanceTaggedRows.length > 0
      ? provenanceTaggedRows.filter((r) => r.matter_type_provenance === "llm_inferred").length /
        provenanceTaggedRows.length
      : null;

  const missingCriticalFactRate =
    missingFactEligibleRows.length > 0
      ? missingFactEligibleRows.filter((r) => r.missing_field_count > 0).length /
        missingFactEligibleRows.length
      : null;

  function bandABRateOf(bucket: MetricsRow[]): number | null {
    if (bucket.length === 0) return null;
    return bucket.filter((r) => r.band === "A" || r.band === "B").length / bucket.length;
  }

  const channelMix = Array.from(channelBuckets.entries())
    .map(([channel, bucket]) => ({
      channel,
      count: bucket.length,
      bandARate: bandABRateOf(bucket),
      avgQuestionsAsked: average(bucket.map((r) => r.question_count)),
    }))
    .sort((a, b) => b.count - a.count);

  const sourceQuality = Array.from(sourceBuckets.entries())
    .map(([source, bucket]) => ({
      source,
      count: bucket.length,
      bandABRate: bandABRateOf(bucket),
    }))
    .sort((a, b) => b.count - a.count);

  return {
    totalLeads,
    unconfirmedCount,
    contactCaptureRate,
    bandDistribution,
    actionByBand,
    thinBriefRate,
    thinBriefScoredCount: scoredRows.length,
    inferredClassificationRate,
    provenanceTaggedCount: provenanceTaggedRows.length,
    missingCriticalFactRate,
    channelMix,
    sourceQuality,
    avgResponseHours: average(decidedDurationsHours),
    decidedCount: decidedDurationsHours.length,
  };
}

export { BAND_KEYS, STATUS_KEYS };
