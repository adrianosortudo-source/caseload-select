import { NextResponse } from "next/server";
import { getOperatorSession } from "@/lib/portal-auth";
import {
  GtaProspectLedgerUnavailableError,
  listGtaProspectResearchForOperator,
} from "@/lib/gta-prospect-research-reader";
import type { ReconciledGtaProspect } from "@/lib/gta-prospect-records";
import { RECONCILED_GTA_PROSPECTS } from "../reconciled-prospects";
import {
  mergeQualifiedProspects,
  type QualifiedProspectImportReport,
} from "@/lib/qualified-gta-prospects";
import { combineUnifiedGtaProspects } from "@/lib/unified-gta-prospect-records";
import type {
  ReconciledProspectFallbackReason,
  ReconciledProspectSource,
  ReconciledProspectSourceCounts,
} from "../reconciled-prospects-source";

export const dynamic = "force-dynamic";

type RecordsResponse = {
  records: readonly ReconciledGtaProspect[];
  source: ReconciledProspectSource;
  sourceCounts: ReconciledProspectSourceCounts;
  qualifiedImport: QualifiedProspectImportReport;
  fallbackReason?: ReconciledProspectFallbackReason;
};

function fixtureResponse(fallbackReason: ReconciledProspectFallbackReason) {
  const merged = mergeQualifiedProspects(RECONCILED_GTA_PROSPECTS);
  return NextResponse.json<RecordsResponse>(
    {
      records: combineUnifiedGtaProspects(merged.records),
      source: "fixture",
      sourceCounts: { ledger: 0, fixture: RECONCILED_GTA_PROSPECTS.length },
      qualifiedImport: merged.report,
      fallbackReason,
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

function compareRecords(left: ReconciledGtaProspect, right: ReconciledGtaProspect): number {
  return left.firmName.localeCompare(right.firmName, "en-CA", { sensitivity: "base" })
    || left.id.localeCompare(right.id, "en-CA");
}

function mergeLedgerAndFixtureRecords(records: readonly ReconciledGtaProspect[]) {
  const ledgerKeys = new Set(records.map((record) => record.id));
  const missingFixtures = RECONCILED_GTA_PROSPECTS.filter((record) => !ledgerKeys.has(record.id));
  return {
    records: [...records, ...missingFixtures].sort(compareRecords),
    missingFixtureCount: missingFixtures.length,
  };
}

/** Operator-gated read endpoint for the reviewed firm-expansion records. */
export async function GET() {
  if (!(await getOperatorSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const records = await listGtaProspectResearchForOperator();
    if (records.length === 0) return fixtureResponse("ledger_empty");

    const merged = mergeLedgerAndFixtureRecords(records);
    const qualified = mergeQualifiedProspects(merged.records);
    return NextResponse.json<RecordsResponse>(
      {
        records: combineUnifiedGtaProspects(qualified.records),
        source: merged.missingFixtureCount > 0 ? "hybrid" : "ledger",
        sourceCounts: { ledger: records.length, fixture: merged.missingFixtureCount },
        qualifiedImport: qualified.report,
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    if (error instanceof GtaProspectLedgerUnavailableError) return fixtureResponse("ledger_unavailable");
    console.error("[gta-prospect-research] operator read failed", error);
    return NextResponse.json({ error: "GTA prospect research records could not be loaded." }, { status: 500 });
  }
}
