// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ChannelConversationPanel, {
  type ChannelConversationMessage,
  type ChannelReplyWindow,
  type ReplyChannel,
} from "../ChannelConversationPanel";

const OPEN_WINDOW: ChannelReplyWindow = {
  isOpen: true,
  closesAt: "2026-09-02T01:00:00.000Z",
  reason: "open",
};

const MESSAGE: ChannelConversationMessage = {
  id: "message-1",
  direction: "inbound",
  source: "webhook",
  body: "I would like to speak with a lawyer.",
  status: "received",
  occurredAt: "2026-09-01T01:00:00.000Z",
};

function renderPanel(
  overrides: Partial<{
    messages: ChannelConversationMessage[];
    channel: ReplyChannel;
    replyWindow: ChannelReplyWindow;
    supportPreview: boolean;
    intakeTranscript: string | null;
  }> = {},
) {
  return render(
    createElement(ChannelConversationPanel, {
      messages: overrides.messages ?? [MESSAGE],
      channel: overrides.channel ?? "facebook",
      firmName: "DRG Law",
      assetId: "page-123",
      replyWindow: overrides.replyWindow ?? OPEN_WINDOW,
      supportPreview: overrides.supportPreview ?? false,
      replyEndpoint: "/api/portal/firm-1/triage/lead-1/reply",
      intakeTranscript: overrides.intakeTranscript,
    }),
  );
}

describe("ChannelConversationPanel", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis.crypto, "randomUUID", {
      configurable: true,
      value: vi.fn(() => "client-request-1"),
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("shows the channel, connected firm, failed status, and separate legacy transcript label", () => {
    renderPanel({
      channel: "instagram",
      messages: [{ ...MESSAGE, direction: "outbound", status: "failed" }],
      intakeTranscript: "Legacy intake answer",
    });

    expect(screen.getByRole("heading", { name: "Instagram with DRG Law" })).toBeTruthy();
    expect(screen.getByText("Connected as DRG Law")).toBeTruthy();
    expect(screen.getByText("failed")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Inbound intake transcript" })).toBeTruthy();
    expect(screen.getByText(/separate from the conversation history/i)).toBeTruthy();
  });

  it("disables replies with a clear reason in support preview", () => {
    renderPanel({ supportPreview: true });

    expect((screen.getByRole("textbox", { name: "Reply as DRG Law" }) as HTMLTextAreaElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Send reply" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/support preview is read-only/i)).toBeTruthy();
  });

  it("disables replies when there is no authoritative inbound timestamp", () => {
    renderPanel({
      replyWindow: {
        isOpen: false,
        closesAt: null,
        reason: "no_authoritative_inbound",
      },
    });

    expect((screen.getByRole("textbox", { name: "Reply as DRG Law" }) as HTMLTextAreaElement).disabled).toBe(true);
    expect(screen.getByText(/no authoritative inbound message timestamp/i)).toBeTruthy();
  });

  it("disables replies when the 24-hour window is closed", () => {
    renderPanel({
      replyWindow: {
        isOpen: false,
        closesAt: "2026-09-01T01:00:00.000Z",
        reason: "expired",
      },
    });

    expect((screen.getByRole("textbox", { name: "Reply as DRG Law" }) as HTMLTextAreaElement).disabled).toBe(true);
    expect(screen.getByText(/24-hour response window has closed/i)).toBeTruthy();
  });

  it("posts only body and client_request_id, then appends the sent message and clears the draft", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          message: {
            id: "message-2",
            direction: "outbound",
            source: "operator",
            body: "We can help. What time works for a call?",
            status: "sent",
            occurredAt: "2026-09-01T02:00:00.000Z",
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    renderPanel();
    const textbox = screen.getByRole("textbox", { name: "Reply as DRG Law" });

    fireEvent.change(textbox, { target: { value: "We can help. What time works for a call?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send reply" }));

    await waitFor(() => expect(screen.getByText("Reply sent.")).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = fetchMock.mock.calls[0];
    expect(request[0]).toBe("/api/portal/firm-1/triage/lead-1/reply");
    expect(JSON.parse(String((request[1] as RequestInit).body))).toEqual({
      body: "We can help. What time works for a call?",
      client_request_id: "client-request-1",
    });
    expect(screen.getByText("We can help. What time works for a call?")).toBeTruthy();
    expect((textbox as HTMLTextAreaElement).value).toBe("");
  });

  it("preserves the draft and reports the server error when sending fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "The Meta reply window closed before this message was sent." }), {
        status: 409,
        headers: { "Content-Type": "application/json" },
      }),
    );
    renderPanel();
    const textbox = screen.getByRole("textbox", { name: "Reply as DRG Law" });

    fireEvent.change(textbox, { target: { value: "Please call our office." } });
    fireEvent.click(screen.getByRole("button", { name: "Send reply" }));

    await waitFor(() => expect(screen.getByText(/window closed before this message/i)).toBeTruthy());
    expect((textbox as HTMLTextAreaElement).value).toBe("Please call our office.");
  });

  it("enforces Instagram's byte limit without discarding the draft", () => {
    renderPanel({ channel: "instagram" });
    const textbox = screen.getByRole("textbox", { name: "Reply as DRG Law" });
    const oversized = "é".repeat(501);

    fireEvent.change(textbox, { target: { value: oversized } });

    expect(screen.getByText(/1002\/1000 Instagram bytes/i)).toBeTruthy();
    expect(screen.getByText(/must be 1000 UTF-8 bytes or fewer/i)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Send reply" }) as HTMLButtonElement).disabled).toBe(true);
    expect((textbox as HTMLTextAreaElement).value).toBe(oversized);
  });
});
