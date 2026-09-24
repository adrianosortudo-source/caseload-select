import type { CandidateInput } from "../inventory";
import { protocolHash } from "../model";

export const snapshot = { manifestSha256: "a".repeat(64), snapshotAt: "2026-09-23T12:00:00.000Z" };
export function candidate(original: Record<string, unknown>, override: Partial<CandidateInput> = {}): CandidateInput {
  return { original, parentMetadata: {}, pointer: "", artifact: { sourceRoot: "root-a", relativePath: "data/synthetic-candidates.json", sourcePointer: "", snapshotAt: snapshot.snapshotAt, size: 1, fileSha256: protocolHash(original), archivePath: "synthetic-only", classification: "research", status: "snapshotted" }, ...override };
}
export function sample(status: string = "held") {
  return {
    resultId: "synthetic-result-1", workKey: "candidate:synthetic-association-pc", disposition: status,
    record: {
      firmName: "Synthetic Association PC", canonicalDomain: "synthetic.example", databaseFirmId: null, firmId: null, sourceRecordKey: null,
      office: { city: "Toronto", province: "ON", address: "1 Synthetic Street", sourceUrl: "https://synthetic.example/contact", observedAt: "2026-09-23" },
      services: [{ id: "synthetic-service-1", name: "Family law", sourceUrl: "https://synthetic.example/family", observedAt: "2026-09-23" }],
      lawyerCount: { count: 3, firmWide: true, activePractisingOnly: true, roster: [{ name: "Synthetic Lawyer", role: "Principal" }], exclusions: ["Staff member, not a lawyer"], sourceUrl: "https://synthetic.example/team", observedAt: "2026-09-23" },
      decisionMaker: { name: "Synthetic Lawyer", role: "Principal", roleEvidence: { sourceUrl: "https://synthetic.example/team", observedAt: "2026-09-23" } },
      email: { address: null, attributedTo: "Synthetic Lawyer", kind: "direct-email-not-verified", observedAt: "2026-09-23", inferred: false },
      generalInbox: { address: "general@synthetic.example", sourceUrl: "https://synthetic.example/contact", observedAt: "2026-09-23" },
      advertising: { status: "pixels-detected", observations: [{ vendor: "google_ads", kind: "ads-tag", identifier: "AW-1234567", sourceUrl: "https://synthetic.example/", observedAt: "2026-09-23", configured: true, fired: false }] },
      opportunity: { confidence: "medium", observation: "The contact form has a general message field.", interpretation: "An optional service choice could be tested.", recommendation: "Test a non-sensitive service selector.", strengths: ["Contact path is visible"], unknowns: ["Internal routing was not inspected"], sourceUrl: "https://synthetic.example/contact", observedAt: "2026-09-23" },
      missingGates: ["published-direct-email"], selectionRationale: "Retain the observed evidence; direct individual email is unverified.",
      unusualLegacyField: { "key/with~pointer": [null, false, "retained"] },
    },
  };
}
