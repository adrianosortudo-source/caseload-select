// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import NewFirmEvidenceReview from "../NewFirmEvidenceReview";
import ResearchPackageReview, { type ResearchPackageReviewView } from "../ResearchPackageReview";
import { type ProspectEnrichmentNewCoreOptions } from "@/lib/prospect-enrichment-core-evidence";
import type { ProspectEnrichmentEnvelope, ProspectEnrichmentObservation } from "@/lib/prospect-enrichment-contract";

const source = { sourceId: "site", url: "https://synthetic.example", requestedUrl: "https://synthetic.example", finalUrl: "https://synthetic.example",
  policyState: "public-source" as const, publicationLabel: null, publicationPrecision: "unknown" as const, publisher: "Synthetic Legal", observedAt: null,
  observedOn: "2026-09-23", retrievedAt: null, retrievalMethod: "public_html", retrievalOutcome: "success", httpStatus: 200, bodySha256: null,
  excerpt: "Synthetic Legal in Toronto", missingProvenanceReason: null };
const cityId = "00000000-0000-4000-8000-000000000010", rosterId = "00000000-0000-4000-8000-000000000011";
function observation(kind: string, data: unknown): ProspectEnrichmentObservation { return { observationId: kind, kind, data, evidenceState: "asserted",
  retractionReason: null, retractionSourceIds: [], missingProvenanceReason: null, sourceIds: ["site"], observedAt: null, observedOn: "2026-09-23", existingRecord: null } as ProspectEnrichmentObservation; }
function options(): ProspectEnrichmentNewCoreOptions {
  return { eligible: true, sourceRecordKey: "synthetic-legal", firmName: "Synthetic Legal", holds: [], firmNameSources: [source], websiteSources: [source], services: [],
    cities: [{ itemId: cityId, sourceId: "site", source, observation: observation("firm_fit", { practiceAreas: [], office: { city: "Toronto", province: "ON", address: null }, lawyerCount: 2, countQualifier: "exact", independence: "independent", fit: "pass" }) }],
    rosters: [{ itemId: rosterId, sourceId: "site", source, observation: observation("roster", { lawyerCount: 2, countQualifier: "exact", display: "2 lawyers", includedNames: [], excludedPeople: [] }) }] };
}
function prepareCore() {
  fireEvent.change(screen.getByLabelText(/Firm-name source/), { target: { value: "site" } });
  fireEvent.change(screen.getByLabelText(/Primary office city/), { target: { value: cityId + "|site" } });
  fireEvent.change(screen.getByLabelText(/Roster observation/), { target: { value: rosterId + "|site" } });
  fireEvent.change(screen.getByLabelText(/Reconciliation note/), { target: { value: "Synthetic Legal in Toronto is a separate firm supported by its roster dated 2026-09-23." } });
  fireEvent.click(screen.getByLabelText("I reviewed the source evidence for every selected field."));
  fireEvent.click(screen.getByRole("button", { name: "Prepare source-bound firm values" }));
}
afterEach(cleanup);
describe("source-bound new-firm operator selection", () => {
  it("starts with no source selections or authored note and invalidates a prepared value on edits", () => {
    const onChange = vi.fn(); render(createElement(NewFirmEvidenceReview, { options: options(), disabled: false, onChange }));
    expect((screen.getByLabelText(/Reconciliation note/) as HTMLTextAreaElement).value).toBe("");
    expect((screen.getByRole("button", { name: "Prepare source-bound firm values" }) as HTMLButtonElement).disabled).toBe(true);
    prepareCore(); expect(onChange.mock.lastCall?.[0]).toMatchObject({ firmName: "Synthetic Legal", city: "Toronto", websiteUrl: null });
    fireEvent.change(screen.getByLabelText(/Reconciliation note/), { target: { value: "Changed" } });
    expect(onChange.mock.lastCall?.[0]).toBeNull();
    expect((screen.getByLabelText("I reviewed the source evidence for every selected field.") as HTMLInputElement).checked).toBe(false);
  });
  it("resets the prepared core and item actions when switching identity choices", () => {
    const coreOptions = options();
    const payload = { schemaVersion: "prospect-enrichment/v1", packageId: "synthetic-package", subject: { displayName: "Synthetic Legal" },
      sources: [source], observations: [], assessment: null, originalResearch: { content: {}, unmappedPaths: [], sourcePath: "synthetic.json", sourcePointer: "/firm", sourceSha256: "a".repeat(64) } } as unknown as ProspectEnrichmentEnvelope;
    const view: ResearchPackageReviewView = { packageId: "00000000-0000-4000-8000-000000000001", clientPackageId: "synthetic-package", payloadSha256: "a".repeat(64),
      state: "identity_hold", identityState: "unresolved", firmId: null, payload, sources: [source], events: [], reviewJson: null, receipt: null, holds: [],
      newCoreOptions: coreOptions, identityOptions: [{ value: "new", label: "Create new", eligible: true }, { value: "unresolved", label: "Keep unresolved", eligible: true }],
      items: [{ itemId: "00000000-0000-4000-8000-000000000020", clientItemId: "obs:service", itemKind: "service", data: { name: "Family law" },
        sourceIds: ["site"], sourceEventId: null, hash: "b".repeat(64), targets: [], allowedDispositions: ["retain_only"], allowedDispositionsForNewIdentity: ["accept_new", "retain_only"] }] };
    render(createElement(ResearchPackageReview, { packageId: view.packageId, initialData: view }));
    fireEvent.click(screen.getByRole("radio", { name: "Create new firm" })); prepareCore();
    fireEvent.change(screen.getByLabelText(/Intended disposition/), { target: { value: "accept_new" } });
    expect((screen.getByRole("button", { name: "Prepare exact review" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole("radio", { name: "Keep identity unresolved" }));
    expect((screen.getByLabelText(/Intended disposition/) as HTMLSelectElement).value).toBe("");
    expect(screen.queryByRole("option", { name: "Add to evidence history" })).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "Create new firm" }));
    expect((screen.getByRole("button", { name: "Prepare exact review" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText(/Reconciliation note/) as HTMLTextAreaElement).value).toBe("");
  });
});
