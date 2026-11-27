// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { VoiceInput } from "../VoiceInput";
import { transcribeRecording } from "../voice-capture";

vi.mock("../voice-capture", () => ({
  pickMimeType: () => "audio/webm",
  transcribeRecording: vi.fn(async () => ({ ok: true, text: "Fictional transcript" })),
}));

class FixtureRecorder {
  state = "inactive";
  ondataavailable?: (event: { data: Blob }) => void;
  onstop?: () => void;
  start() { this.state = "recording"; }
  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["synthetic recording"], { type: "audio/webm" }) });
    this.onstop?.();
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("isSecureContext", true);
  vi.stubGlobal("MediaRecorder", FixtureRecorder);
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true, value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: vi.fn() }] })) },
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "mediaDevices");
});

it.each([false, true])("records one draft with the visitor's selected provider (%s)", async chooseOpenAI => {
  const onTranscript = vi.fn();
  render(<VoiceInput transcriptionOffer="signed-fixture" onTranscript={onTranscript} />);
  const checkbox = await screen.findByRole("checkbox", { name: /Send this recording to OpenAI/ }) as HTMLInputElement;
  expect(checkbox.checked).toBe(false);
  if (chooseOpenAI) fireEvent.click(checkbox);
  fireEvent.click(screen.getByRole("button", { name: "Record voice" }));
  const stop = await screen.findByRole("button", { name: "Stop recording" });
  expect(checkbox.disabled).toBe(true);
  fireEvent.click(stop);
  await waitFor(() => expect(onTranscript).toHaveBeenCalledWith("Fictional transcript"));
  expect(transcribeRecording).toHaveBeenCalledWith(expect.any(Blob), chooseOpenAI ? "signed-fixture" : undefined);
  expect(checkbox.checked).toBe(false);
});

it("leaves an unfinished recording in the browser when the widget is closed", async () => {
  const { unmount } = render(<VoiceInput onTranscript={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: "Record voice" }));
  await screen.findByRole("button", { name: "Stop recording" });
  expect(screen.queryByRole("checkbox")).toBeNull();
  unmount();
  expect(transcribeRecording).not.toHaveBeenCalled();
});
