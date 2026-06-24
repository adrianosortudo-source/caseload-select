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
  if (previous === 0) return current > 0 ? 1 : null;
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
  created_at: string;
}

export async function fetchIntakeFunnel(
  firmId: string,
): Promise<IntakeFunnelReport> {
  const now = new Date().toISOString();
  const seven = sevenDaysAgo();
  const fourteen = fourteenDaysAgo();

  const [leadsRes, priorLeadsRes, mattersRes, priorMattersRes, allMattersRes] =
    await Promise.all([
      supabaseAdmin
        .from("screened_leads")
        .select("band, status, practice_area, matter_type, created_at")
        .eq("firm_id", firmId)
        .gte("created_at", seven)
        .lte("created_at", now),
      supabaseAdmin
        .from("screened_leads")
        .select("band, status, created_at")
        .eq("firm_id", firmId)
        .gte("created_at", fourteen)
        .lt("created_at", seven),
      supabaseAdmin
        .from("client_matters")
        .select("matter_stage, created_at")
        .eq("firm_id", firmId)
        .gte("created_at", seven)
        .lte("created_at", now),
      supabaseAdmin
        .from("client_matters")
        .select("created_at")
        .eq("firm_id", firmId)
        .gte("created_at", fourteen)
        .lt("created_at", seven),
      supabaseAdmin
        .from("client_matters")
        .select("matter_stage")
        .eq("firm_id", firmId)
        .is("closed_at", null),
    ]);

  const leads = (leadsRes.data ?? []) as LeadRow[];
  const priorLeads = (priorLeadsRes.data ?? []) as LeadRow[];
  const matters = (mattersRes.data ?? []) as MatterRow[];
  const priorMatters = (priorMattersRes.data ?? []) as { created_at: string }[];
  const allOpenMatters = (allMattersRes.data ?? []) as MatterRow[];

  const currentTotal = leads.length;
  const priorTotal = priorLeads.length;
  const currentTaken = leads.filter((l) => l.status === "taken").length;
  const priorTaken = priorLeads.filter(
    (l: LeadRow) => l.status === "taken",
  ).length;
  const currentPassed = leads.filter((l) => l.status === "passed").length;
  const priorPassed = priorLeads.filter(
    (l: LeadRow) => l.status === "passed",
  ).length;

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
      value: matters.length,
      delta: computeDelta(matters.length, priorMatters.length),
    },
    mattersByStage,
  };
}
