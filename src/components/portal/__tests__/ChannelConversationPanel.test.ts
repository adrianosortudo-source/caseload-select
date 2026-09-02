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
    actorIdentityAvailable: boolean;
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
      actorIdentityAvailable: overrides.actorIdentityAvailable ?? true,
      replyEndpoint: "/api/portal/firm-1/triage/lead-1/reply",
      intakeTranscript: overrides.intakeTranscript,
    }),
  );
}

describe("ChannelConversationPanel", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis.crypto, "randomUUID", {
      configurable: true,
      value: vi.fn(() => "44444444-4444-4444-8444-444444444444"),
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("shows the workspace and configured asset without claiming a verified Meta display identity", () => {
    renderPanel({
      channel: "instagram",
      messages: [{ ...MESSAGE, direction: "outbound", status: "failed" }],
      intakeTranscript: "Legacy intake answer",
    });

    expect(screen.getByRole("heading", { name: "Message thread" })).toBeTruthy();
    const channelLabel = screen.getByText("Channel:");
    const workspaceLabel = screen.getByText("Firm workspace:");
    const assetLabel = screen.getByText("Configured Meta asset ID:");
    expect(channelLabel.parentElement?.textContent).toContain("Instagram");
    expect(workspaceLabel.parentElement?.textContent).toContain("DRG Law");
    expect(assetLabel.parentElement?.textContent).toContain("page-123");
    expect(screen.queryByText(/Connected as/i)).toBeNull();
    expect(screen.getByText("failed")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Inbound intake transcript" })).toBeTruthy();
    expect(screen.getByText(/shown separately from message history/i)).toBeTruthy();
  });

  it("disables replies with a clear reason in support preview", () => {
    renderPanel({ supportPreview: true });

    expect((screen.getByRole("textbox", { name: "Write a reply" }) as HTMLTextAreaElement).disabled).toBe(true);
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

    expect((screen.getByRole("textbox", { name: "Write a reply" }) as HTMLTextAreaElement).disabled).toBe(true);
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

    expect((screen.getByRole("textbox", { name: "Write a reply" }) as HTMLTextAreaElement).disabled).toBe(true);
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
    const textbox = screen.getByRole("textbox", { name: "Write a reply" });

    fireEvent.change(textbox, { target: { value: "We can help. What time works for a call?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send reply" }));

    await waitFor(() => expect(screen.getByText("Reply sent.")).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = fetchMock.mock.calls[0];
    expect(request[0]).toBe("/api/portal/firm-1/triage/lead-1/reply");
    expect(JSON.parse(String((request[1] as RequestInit).body))).toEqual({
      body: "We can help. What time works for a call?",
      client_request_id: "44444444-4444-4444-8444-444444444444",
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
    const textbox = screen.getByRole("textbox", { name: "Write a reply" });

    fireEvent.change(textbox, { target: { value: "Please call our office." } });
    fireEvent.click(screen.getByRole("button", { name: "Send reply" }));

    await waitFor(() => expect(screen.getByText(/window closed before this message/i)).toBeTruthy());
    expect((textbox as HTMLTextAreaElement).value).toBe("Please call our office.");
  });

  it("enforces Instagram's byte limit without discarding the draft", () => {
    renderPanel({ channel: "instagram" });
    const textbox = screen.getByRole("textbox", { name: "Write a reply" });
    const oversized = "é".repeat(501);

    fireEvent.change(textbox, { target: { value: oversized } });

    expect(screen.getByText(/1002\/1000 Instagram bytes/i)).toBeTruthy();
    expect(screen.getByText(/must be 1000 UTF-8 bytes or fewer/i)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Send reply" }) as HTMLButtonElement).disabled).toBe(true);
    expect((textbox as HTMLTextAreaElement).value).toBe(oversized);
  });

  it("requires a stable authenticated member identity before enabling the composer", () => {
    renderPanel({ actorIdentityAvailable: false });

    expect((screen.getByRole("textbox", { name: "Write a reply" }) as HTMLTextAreaElement).disabled).toBe(true);
    expect(screen.getByText(/sign in again before sending a reply/i)).toBeTruthy();
  });

  it("reuses one request ID after a timeout and a pending 409 until a verified sent event arrives", async () => {
    const sentMessage = {
      id: "message-2",
      direction: "outbound",
      source: "operator",
      body: "Please call our office.",
      status: "sent",
      occurredAt: "2026-09-01T02:00:00.000Z",
    };
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new TypeError("network timeout"))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: "request is already in progress or awaiting delivery reconciliation",
            code: "request_in_progress",
            deliveryUnknown: true,
          }),
          { status: 409, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: sentMessage }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    renderPanel();
    const textbox = screen.getByRole("textbox", { name: "Write a reply" });
    const button = screen.getByRole("button", { name: "Send reply" });

    fireEvent.change(textbox, { target: { value: "Please call our office." } });
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByText(/connection ended before delivery/i)).toBeTruthy());

    fireEvent.click(button);
    await waitFor(() => expect(screen.getByText(/delivery is not yet verified/i)).toBeTruthy());

    fireEvent.click(button);
    await waitFor(() => expect(screen.getByText("Reply sent.")).toBeTruthy());

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const requestIds = fetchMock.mock.calls.map((call) =>
      JSON.parse(String((call[1] as RequestInit).body)).client_request_id,
    );
    expect(requestIds).toEqual([
      "44444444-4444-4444-8444-444444444444",
      "44444444-4444-4444-8444-444444444444",
      "44444444-4444-4444-8444-444444444444",
    ]);
    expect(globalThis.crypto.randomUUID).toHaveBeenCalledTimes(1);
    expect((textbox as HTMLTextAreaElement).value).toBe("");
  });

  it("does not fabricate a sent event when a successful response has no verified terminal event", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    renderPanel();
    const textbox = screen.getByRole("textbox", { name: "Write a reply" });

    fireEvent.change(textbox, { target: { value: "Unverified reply body" } });
    fireEvent.click(screen.getByRole("button", { name: "Send reply" }));

    await waitFor(() => expect(screen.getByText(/delivery is not yet verified/i)).toBeTruthy());
    expect((textbox as HTMLTextAreaElement).value).toBe("Unverified reply body");
    expect(screen.queryByText("Reply sent.")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Send reply" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const requestIds = fetchMock.mock.calls.map((call) =>
      JSON.parse(String((call[1] as RequestInit).body)).client_request_id,
    );
    expect(new Set(requestIds).size).toBe(1);
  });

  it("creates a new request ID only after the operator changes the message body", async () => {
    vi.mocked(globalThis.crypto.randomUUID)
      .mockReturnValueOnce("44444444-4444-4444-8444-444444444444")
      .mockReturnValueOnce("77777777-7777-4777-8777-777777777777");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    renderPanel();
    const textbox = screen.getByRole("textbox", { name: "Write a reply" });
    const button = screen.getByRole("button", { name: "Send reply" });

    fireEvent.change(textbox, { target: { value: "First message body" } });
    fireEvent.click(button);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    fireEvent.change(textbox, { target: { value: "Revised message body" } });
    fireEvent.click(button);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    const requestIds = fetchMock.mock.calls.map((call) =>
      JSON.parse(String((call[1] as RequestInit).body)).client_request_id,
    );
    expect(requestIds).toEqual([
      "44444444-4444-4444-8444-444444444444",
      "77777777-7777-4777-8777-777777777777",
    ]);
  });
});
