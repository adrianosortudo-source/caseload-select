// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { ProspectDemoPresentation } from "../ProspectDemoPresentation";
import { ProspectDemoClient } from "../ProspectDemoClient";
import { exampleLawFirmProspectDemoProfile } from "@/lib/prospect-demo-profiles/example-law-firm";
import { walkerLawProspectDemoProfile as profile } from "@/lib/prospect-demo-profiles/walker-law";
import * as store from "@/lib/prospect-demo/store";

vi.mock("@/lib/prospect-demo/store", () => ({
  ensureProspectDemoProfile: vi.fn(), listProspectDemoProfiles: vi.fn(),
  readProspectDemoProfile: vi.fn(), readProspectDemoAsset: vi.fn(),
}));
vi.mock("@/lib/prospect-demo/browser", () => ({ screenshotDataUrl: vi.fn(async () => "data:image/png;base64,iVBORw0KGgo=") }));
vi.mock("next/image", () => ({ default: ({ unoptimized: _u, priority: _p, ...props }: Record<string, unknown>) => <img {...props} /> }));
vi.mock("@/components/intake-v2/ScreenEnginePublicWidget", () => ({
  ScreenEnginePublicWidget: ({ initialDescription, runtime }: { initialDescription: string; runtime: string }) => <textarea aria-label="Fictional inquiry" defaultValue={initialDescription} data-runtime={runtime} />,
}));
vi.mock("@/components/intake-v2/DemoOperatorPanel", () => ({ DemoOperatorPanel: () => <p>Lawyer brief</p> }));
class Observer { observe() {} disconnect() {} }
function PersistentIntake({ showReview }: { showReview?: () => void }) {
  const [answer, setAnswer] = useState("");
  return <><input aria-label="Test answer" value={answer} onChange={(event) => setAnswer(event.target.value)} /><button type="button" onClick={showReview}>Open lawyer brief</button></>;
}
const asset = { assetId: profile.screenshot.assetId, blob: new Blob(["image"]), width: 2340, height: 1650, mimeType: "image/png" as const };
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("ResizeObserver", Observer);
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, blob: async () => asset.blob })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe("canonical prospect presentation", () => {
  it("labels the public controls, keeps both views mounted, and resets only on explicit session changes", async () => {
    const onSessionReset = vi.fn();
    const { container } = render(<ProspectDemoPresentation registrations={[{ profile, asset }]} initialProfileId={profile.id} browserLocalProfiles={false} appearance="caseload" sessionAdapter={{
      renderIntake: (context) => <PersistentIntake showReview={context.showReview} />,
      renderReview: () => <p>Lawyer brief</p>,
      onSessionReset,
    }} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Website preview" }).getAttribute("aria-pressed")).toBe("true"));
    expect(screen.queryByLabelText("Prospect")).toBeNull();
    expect(screen.getByRole("group", { name: "View" })).toBeTruthy();
    expect(screen.getByText("AI mode: Live AI")).toBeTruthy();
    expect(screen.getByText("Changing a sample or mode resets this demo.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Start over" })).toBeTruthy();
    expect(screen.getByText("Demo options").closest("details")?.open).toBe(false);

    fireEvent.change(screen.getByLabelText("Test answer"), { target: { value: "An answer already provided" } });
    fireEvent.click(screen.getByRole("button", { name: "Open lawyer brief" }));
    expect(screen.getByRole("button", { name: "Lawyer brief" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Side by side" }));
    fireEvent.click(screen.getByRole("button", { name: "Website preview" }));
    expect((screen.getByLabelText("Test answer") as HTMLInputElement).value).toBe("An answer already provided");
    expect(container.querySelector("[data-prospect-demo-intake-overlay]")).toBeTruthy();
    expect(store.listProspectDemoProfiles).not.toHaveBeenCalled();
    expect(store.readProspectDemoAsset).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Sample case"), { target: { value: profile.scenarios[1].id } });
    expect(onSessionReset.mock.calls.at(-1)?.[1]).toBe("sample");
    fireEvent.click(screen.getByText("Demo options"));
    fireEvent.click(screen.getByRole("button", { name: "Guided sample" }));
    expect(onSessionReset.mock.calls.at(-1)?.[1]).toBe("mode");
    expect(screen.getByText("AI mode: Guided sample")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Start over" }));
    expect(onSessionReset.mock.calls.at(-1)?.[1]).toBe("start-over");
  });

  it("keeps the operator profile selector when multiple profiles are available", async () => {
    const secondProfile = { ...profile, id: "second-firm", slug: "second-firm", firmName: "Second Example Firm" };
    const onSessionReset = vi.fn();
    render(<ProspectDemoPresentation registrations={[{ profile, asset }, { profile: secondProfile, asset }]} initialProfileId={profile.id} browserLocalProfiles={false} appearance="caseload" sessionAdapter={{ renderIntake: () => null, renderReview: () => null, onSessionReset }} />);
    await waitFor(() => expect(screen.getByLabelText("Prospect")).toBeTruthy());
    expect((screen.getByLabelText("Prospect") as HTMLSelectElement).options).toHaveLength(2);
    fireEvent.change(screen.getByLabelText("Prospect"), { target: { value: secondProfile.id } });
    expect(onSessionReset.mock.calls.at(-1)?.[1]).toBe("profile");
  });

  it("opens free entry and family-law samples without touching the private profile library", async () => {
    render(<ProspectDemoClient profileId="example-law-firm" sampleOnly embedded />);
    await waitFor(() => expect(screen.getByLabelText("Fictional inquiry").getAttribute("data-runtime")).toBe("demo-live-ai"));
    expect(screen.queryByRole("img", { name: "CaseLoad Select" })).toBeNull();
    expect(screen.queryByLabelText("Prospect")).toBeNull();
    const sampleCase = screen.getByLabelText("Sample case") as HTMLSelectElement;
    expect(Array.from(sampleCase.options).map((option) => option.text)).toEqual(["Write your own inquiry", "Family law", "Unpaid invoice", "Employment issue"]);
    expect(sampleCase.value).toBe(exampleLawFirmProspectDemoProfile.scenarios[0].id);
    expect((screen.getByLabelText("Fictional inquiry") as HTMLTextAreaElement).value).toBe("");
    expect(store.ensureProspectDemoProfile).not.toHaveBeenCalled();
    expect(store.readProspectDemoProfile).not.toHaveBeenCalled();
    expect(store.listProspectDemoProfiles).not.toHaveBeenCalled();
    expect(store.readProspectDemoAsset).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith("/prospect-demos/example-law-firm/example-law-firm.png", { cache: "force-cache" });
  });
});