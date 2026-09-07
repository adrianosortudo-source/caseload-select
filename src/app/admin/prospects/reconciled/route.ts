import { NextResponse } from "next/server";
import { getOperatorSession } from "@/lib/portal-auth";
import {
  GtaProspectLedgerUnavailableError,
  listGtaProspectResearchForOperator,
} from "@/lib/gta-prospect-research-reader";
import { RECONCILED_GTA_PROSPECTS } from "../reconciled-prospects";

export const dynamic = "force-dynamic";

type RecordsResponse = {
  records: readonly (typeof RECONCILED_GTA_PROSPECTS)[number][];
  source: "fixture" | "ledger";
  fallbackReason?: "ledger_unavailable" | "fixture_seed_incomplete";
};

function fixtureResponse(fallbackReason: NonNullable<RecordsResponse["fallbackReason"]>) {
  return NextResponse.json<RecordsResponse>(
    { records: RECONCILED_GTA_PROSPECTS, source: "fixture", fallbackReason },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

function coversEveryFixtureRecord(records: readonly { id: string }[]): boolean {
  const ledgerKeys = new Set(records.map((record) => record.id));
  return ledgerKeys.size === records.length && RECONCILED_GTA_PROSPECTS.every((record) => ledgerKeys.has(record.id));
}

/** Operator-gated read endpoint for the reviewed firm-expansion records. */
export async function GET() {
  if (!(await getOperatorSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const records = await listGtaProspectResearchForOperator();
    if (!coversEveryFixtureRecord(records)) return fixtureResponse("fixture_seed_incomplete");
    return NextResponse.json<RecordsResponse>(
      { records, source: "ledger" },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    if (error instanceof GtaProspectLedgerUnavailableError) return fixtureResponse("ledger_unavailable");
    console.error("[gta-prospect-research] operator read failed", error);
    return NextResponse.json({ error: "GTA prospect research records could not be loaded." }, { status: 500 });
  }
}
