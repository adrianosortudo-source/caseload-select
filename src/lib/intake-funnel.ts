import { supabaseAdmin } from "@/lib/supabase-admin";

export interface FunnelMetric {
  value: number;
  delta: number | null;
}

export interface BandCount {
  band: string;
  count: number;
}

export interface TopEntry {
  label: string;
  count: number;
}

export interface StageCount {
  stage: string;
  count: number;
}

export interface IntakeFunnelReport {
  totalLeads: FunnelMetric;
  taken: FunnelMetric;
  passed: FunnelMetric;
  takeRate: FunnelMetric;
  bands: BandCount[];
  topPracticeAreas: TopEntry[];
  topMatterTypes: TopEntry[];
  mattersCreated: FunnelMetric;
  mattersByStage: StageCount[];
}

function sevenDaysAgo(): string {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  return d.toISOString();
}

function fourteenDaysAgo(): string {
  const d = new Date();
  d.setDate(d.getDate() - 14);
  return d.toISOString();
}

function computeDelta(current: number, previous: number): number | null {
  // No prior-week baseline means no meaningful percentage change. A flat +100%
  // read as real growth when it only meant "the prior week was zero". Suppress
  // the delta; the card renders the value with no delta badge.
  if (previous === 0) return null;
  return (current - previous) / previous;
}

interface LeadRow {
  band: string | null;
  status: string;
  practice_area: string;
  matter_type: string;
  created_at: string;
}

interface MatterRow {
  matter_stage: string;
}

const SCAN_PAGE_SIZE = 1000;
const SCAN_HARD_CAP = 100000; // safety ceiling for the per-firm windowed scans

type PageResult = { data: unknown; error: { message: string } | null };

/**
 * Range-pages a query to completion. Used only where the metric genuinely
 * needs the rows (grouped distributions). A bare .select() is silently capped
 * by PostgREST at ~1000 rows, so at scale the old array-length counting
 * undercounted every total and distribution (Codex audit 2026-07-07,
 * finding 5). The (from, to) window is passed to a fresh builder per page.
 */
async function fetchAllRows<T>(
  build: (from: number, to: number) => PromiseLike<PageResult>,
): Promise<T[]> {
  const all: T[] = [];
  for (let offset = 0; offset < SCAN_HARD_CAP; offset += SCAN_PAGE_SIZE) {
    const { data, error } = await build(offset, offset + SCAN_PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as T[];
    all.push(...rows);
    if (rows.length < SCAN_PAGE_SIZE) break; // short page => last page
  }
  return all;
}

/** Exact row count via a head query, immune to the PostgREST row cap. */
async function countRows(
  build: () => PromiseLike<{ count: number | null; error: { message: string } | null }>,
): Promise<number> {
  const { count, error } = await build();
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function fetchIntakeFunnel(
  firmId: string,
): Promise<IntakeFunnelReport> {
  const now = new Date().toISOString();
  const seven = sevenDaysAgo();
  const fourteen = fourteenDaysAgo();

  // Current-week leads and all open matters are the only sets whose ROWS are
  // needed (for the band / practice-area / matter-type / stage distributions),
  // so those are range-paged to completion. Every pure total is an exact head
  // count, which never fetches rows and never hits the cap.
  const [
    leads,
    allOpenMatters,
    priorTotal,
    priorTaken,
    priorPassed,
    currentMattersCreated,
    priorMattersCreated,
  ] = await Promise.all([
    fetchAllRows<LeadRow>((from, to) =>
      supabaseAdmin
        .from("screened_leads")
        .select("band, status, practice_area, matter_type, created_at")
        .eq("firm_id", firmId)
        .gte("created_at", seven)
        .lte("created_at", now)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to),
    ),
    fetchAllRows<MatterRow>((from, to) =>
      supabaseAdmin
        .from("client_matters")
        .select("matter_stage")
        .eq("firm_id", firmId)
        .is("closed_at", null)
        .order("id", { ascending: true })
        .range(from, to),
    ),
    countRows(() =>
      supabaseAdmin
        .from("screened_leads")
        .select("*", { count: "exact", head: true })
        .eq("firm_id", firmId)
        .gte("created_at", fourteen)
        .lt("created_at", seven),
    ),
    countRows(() =>
      supabaseAdmin
        .from("screened_leads")
        .select("*", { count: "exact", head: true })
        .eq("firm_id", firmId)
        .eq("status", "taken")
        .gte("created_at", fourteen)
        .lt("created_at", seven),
    ),
    countRows(() =>
      supabaseAdmin
        .from("screened_leads")
        .select("*", { count: "exact", head: true })
        .eq("firm_id", firmId)
        .eq("status", "passed")
        .gte("created_at", fourteen)
        .lt("created_at", seven),
    ),
    countRows(() =>
      supabaseAdmin
        .from("client_matters")
        .select("*", { count: "exact", head: true })
        .eq("firm_id", firmId)
        .gte("created_at", seven)
        .lte("created_at", now),
    ),
    countRows(() =>
      supabaseAdmin
        .from("client_matters")
        .select("*", { count: "exact", head: true })
        .eq("firm_id", firmId)
        .gte("created_at", fourteen)
        .lt("created_at", seven),
    ),
  ]);

  // Current-week totals are derived from the fully-paged leads set, so they are
  // complete regardless of scale.
  const currentTotal = leads.length;
  const currentTaken = leads.filter((l) => l.status === "taken").length;
  const currentPassed = leads.filter((l) => l.status === "passed").length;

  const currentRate = currentTotal > 0 ? currentTaken / currentTotal : 0;
  const priorRate = priorTotal > 0 ? priorTaken / priorTotal : 0;

  const bandMap: Record<string, number> = {};
  for (const l of leads) {
    const b = l.band ?? "unscored";
    bandMap[b] = (bandMap[b] ?? 0) + 1;
  }
  const bandOrder = ["A", "B", "C", "D", "E", "unscored"];
  const bands: BandCount[] = bandOrder
    .filter((b) => bandMap[b])
    .map((b) => ({ band: b, count: bandMap[b] }));

  const paMap: Record<string, number> = {};
  for (const l of leads) {
    paMap[l.practice_area] = (paMap[l.practice_area] ?? 0) + 1;
  }
  const topPracticeAreas: TopEntry[] = Object.entries(paMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([label, count]) => ({ label, count }));

  const mtMap: Record<string, number> = {};
  for (const l of leads) {
    mtMap[l.matter_type] = (mtMap[l.matter_type] ?? 0) + 1;
  }
  const topMatterTypes: TopEntry[] = Object.entries(mtMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([label, count]) => ({ label, count }));

  const stageMap: Record<string, number> = {};
  for (const m of allOpenMatters) {
    stageMap[m.matter_stage] = (stageMap[m.matter_stage] ?? 0) + 1;
  }
  const mattersByStage: StageCount[] = Object.entries(stageMap)
    .sort((a, b) => b[1] - a[1])
    .map(([stage, count]) => ({ stage, count }));

  return {
    totalLeads: {
      value: currentTotal,
      delta: computeDelta(currentTotal, priorTotal),
    },
    taken: {
      value: currentTaken,
      delta: computeDelta(currentTaken, priorTaken),
    },
    passed: {
      value: currentPassed,
      delta: computeDelta(currentPassed, priorPassed),
    },
    takeRate: {
      value: currentRate,
      delta: computeDelta(currentRate, priorRate),
    },
    bands,
    topPracticeAreas,
    topMatterTypes,
    mattersCreated: {
      value: currentMattersCreated,
      delta: computeDelta(currentMattersCreated, priorMattersCreated),
    },
    mattersByStage,
  };
}
