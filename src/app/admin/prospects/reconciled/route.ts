import { NextResponse } from "next/server";
import { getOperatorSession } from "@/lib/portal-auth";
import {
  GtaProspectLedgerUnavailableError,
  listGtaProspectResearchForOperator,
} from "@/lib/gta-prospect-research-reader";
import {
  GtaProspectOwnerContactLedgerUnavailableError,
  listGtaProspectOwnerContactsForOperator,
  type GtaProspectOwnerContactSummary,
} from "@/lib/gta-prospect-owner-contact-reader";
import {
  GtaProspectDowntownGeographyLedgerUnavailableError,
  listGtaProspectDowntownGeographyForOperator,
  type GtaProspectDowntownGeographySummary,
} from "@/lib/gta-prospect-downtown-geography-reader";
import {
  GtaProspectSupplementalEvidenceLedgerUnavailableError,
  listGtaProspectSupplementalEvidenceForOperator,
  type GtaProspectSupplementalEvidenceSummary,
} from "@/lib/gta-prospect-supplemental-evidence-reader";
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

function attachOwnerContacts(
  records: readonly ReconciledGtaProspect[],
  contacts: readonly GtaProspectOwnerContactSummary[],
): ReconciledGtaProspect[] {
  const contactsBySourceRecordKey = new Map(contacts.map((contact) => [contact.sourceRecordKey, contact]));
  return records.map((record) => {
    const contact = contactsBySourceRecordKey.get(record.id);
    return {
      ...record,
      ownerContact: contact ? {
        ownerName: contact.ownerName,
        ownerRole: contact.ownerRole,
        ownershipConfidence: contact.ownershipConfidence,
        emailAvailability: contact.emailAvailability,
        emailAddress: contact.emailAddress,
      } : null,
    };
  });
}

function attachDowntownGeography(
  records: readonly ReconciledGtaProspect[],
  observations: readonly GtaProspectDowntownGeographySummary[],
): ReconciledGtaProspect[] {
  const bySourceRecordKey = new Map(observations.map((observation) => [observation.sourceRecordKey, observation]));
  return records.map((record) => {
    const observation = bySourceRecordKey.get(record.id);
    return {
      ...record,
      downtownGeography: observation ? {
        status: observation.status,
        boundaryGeometrySha256: observation.boundaryGeometrySha256,
        observedOn: observation.observedOn,
        confidence: observation.confidence,
      } : null,
    };
  });
}

function attachSupplementalEvidence(
  records: readonly ReconciledGtaProspect[],
  observations: readonly GtaProspectSupplementalEvidenceSummary[],
): ReconciledGtaProspect[] {
  const bySourceRecordKey = new Map(observations.map((observation) => [observation.sourceRecordKey, observation]));
  return records.map((record) => {
    const observation = bySourceRecordKey.get(record.id);
    if (!observation) return { ...record, supplementalEvidence: null };
    return {
      ...record,
      firmId: observation.identity?.matchState === "confirmed" ? observation.firmId : record.firmId,
      canonicalDomain: observation.identity?.matchState === "confirmed" ? observation.canonicalDomain : record.canonicalDomain,
      supplementalEvidence: {
        identity: observation.identity,
        websiteIntake: observation.websiteIntake,
        qualification: observation.qualification,
      },
    };
  });
}

async function ownerContactsForPresentation(): Promise<readonly GtaProspectOwnerContactSummary[]> {
  try {
    return await listGtaProspectOwnerContactsForOperator();
  } catch (error) {
    // The owner-contact migration can follow the research ledger migration.
    // Its absence must not make the established prospect list unavailable.
    if (error instanceof GtaProspectOwnerContactLedgerUnavailableError) return [];
    throw error;
  }
}

async function downtownGeographyForPresentation(): Promise<readonly GtaProspectDowntownGeographySummary[]> {
  try {
    return await listGtaProspectDowntownGeographyForOperator();
  } catch (error) {
    if (error instanceof GtaProspectDowntownGeographyLedgerUnavailableError) return [];
    throw error;
  }
}

async function supplementalEvidenceForPresentation(): Promise<readonly GtaProspectSupplementalEvidenceSummary[]> {
  try {
    return await listGtaProspectSupplementalEvidenceForOperator();
  } catch (error) {
    if (error instanceof GtaProspectSupplementalEvidenceLedgerUnavailableError) return [];
    throw error;
  }
}

async function fixtureResponse(
  fallbackReason: ReconciledProspectFallbackReason,
  ownerContacts?: readonly GtaProspectOwnerContactSummary[],
) {
  const merged = mergeQualifiedProspects(RECONCILED_GTA_PROSPECTS);
  const resolvedOwnerContacts = ownerContacts ?? await ownerContactsForPresentation();
  return NextResponse.json<RecordsResponse>(
    {
    records: attachSupplementalEvidence(attachDowntownGeography(attachOwnerContacts(combineUnifiedGtaProspects(merged.records), resolvedOwnerContacts), await downtownGeographyForPresentation()), await supplementalEvidenceForPresentation()),
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
    const ownerContacts = await ownerContactsForPresentation();
    const records = await listGtaProspectResearchForOperator();
    const [geography, supplementalEvidence] = await Promise.all([downtownGeographyForPresentation(), supplementalEvidenceForPresentation()]);
    if (records.length === 0) return fixtureResponse("ledger_empty", ownerContacts);

    const merged = mergeLedgerAndFixtureRecords(records);
    const qualified = mergeQualifiedProspects(merged.records);
    return NextResponse.json<RecordsResponse>(
      {
        records: attachSupplementalEvidence(attachDowntownGeography(attachOwnerContacts(combineUnifiedGtaProspects(qualified.records), ownerContacts), geography), supplementalEvidence),
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
