// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { ProspectDemoPresentation } from "../ProspectDemoPresentation";
import { ProspectDemoClient } from "../ProspectDemoClient";
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
function PersistentIntake() {
  const [answer, setAnswer] = useState("");
  return <input aria-label="Test answer" value={answer} onChange={(event) => setAnswer(event.target.value)} />;
}
const asset = { assetId: profile.screenshot.assetId, blob: new Blob(["image"]), width: 2340, height: 1650, mimeType: "image/png" as const };
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("ResizeObserver", Observer);
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, blob: async () => asset.blob })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe("canonical prospect presentation", () => {
  it("starts with Website and preserves the inquiry when switching layouts", async () => {
    const { container } = render(<ProspectDemoPresentation registrations={[{ profile, asset }]} initialProfileId={profile.id} browserLocalProfiles={false} appearance="caseload" sessionAdapter={{ renderIntake: () => <PersistentIntake />, renderReview: () => <p>Lawyer brief</p> }} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Website" }).getAttribute("aria-pressed")).toBe("true"));
    expect(screen.getByRole("button", { name: "Live AI" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.change(screen.getByLabelText("Test answer"), { target: { value: "An answer already provided" } });
    fireEvent.click(screen.getByRole("button", { name: "Lawyer view" }));
    fireEvent.click(screen.getByRole("button", { name: "Split view" }));
    fireEvent.click(screen.getByRole("button", { name: "Website" }));
    expect((screen.getByLabelText("Test answer") as HTMLInputElement).value).toBe("An answer already provided");
    expect(container.querySelector("[data-prospect-demo-intake-overlay]")).toBeTruthy();
    expect(store.listProspectDemoProfiles).not.toHaveBeenCalled();
    expect(store.readProspectDemoAsset).not.toHaveBeenCalled();
  });
  it("loads the same fixed sample without touching the private profile library", async () => {
    render(<ProspectDemoClient profileId="walker-law" sampleOnly embedded />);
    await waitFor(() => expect(screen.getByLabelText("Fictional inquiry")).toBeTruthy());
    expect(screen.getByLabelText("Fictional inquiry").getAttribute("data-runtime")).toBe("demo-live-ai");
    expect(screen.queryByRole("img", { name: "CaseLoad Select" })).toBeNull();
    expect(store.ensureProspectDemoProfile).not.toHaveBeenCalled();
    expect(store.readProspectDemoProfile).not.toHaveBeenCalled();
    expect(store.listProspectDemoProfiles).not.toHaveBeenCalled();
    expect(store.readProspectDemoAsset).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith("/prospect-demos/walker-law/walker-law-consultation-reference.png", { cache: "force-cache" });
  });
});
