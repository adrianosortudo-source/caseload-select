// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import ConversationRailPortal from "../ConversationRailPortal";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("ConversationRailPortal", () => {
  it("mounts the compact live panel into the stored brief slot", async () => {
    document.body.innerHTML =
      '<div data-lead-report-page><div data-channel-conversation-slot></div></div>';

    render(
      <ConversationRailPortal
        messages={[]}
        channel="instagram"
        firmName="DRG Law"
        assetId="fixture-asset"
        replyWindow={{ isOpen: false, closesAt: null, reason: "expired" }}
        supportPreview={false}
        actorIdentityAvailable
        replyEndpoint="/api/test/reply"
      />,
    );

    await waitFor(() => expect(screen.getByRole("heading", { name: "Message thread" })).toBeTruthy());
    const slot = document.querySelector("[data-channel-conversation-slot]");
    expect(slot?.querySelector(".conversation-panel-compact")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Reply unavailable" })).toBeTruthy();
  });

  it("moves the panel when navigation replaces the stored brief slot", async () => {
    document.body.innerHTML =
      '<div data-lead-report-page><div data-channel-conversation-slot data-old-slot></div></div>';

    render(
      <ConversationRailPortal
        messages={[]}
        channel="instagram"
        firmName="DRG Law"
        assetId="fixture-asset"
        replyWindow={{ isOpen: false, closesAt: null, reason: "expired" }}
        supportPreview={false}
        actorIdentityAvailable
        replyEndpoint="/api/test/reply"
      />,
    );

    await waitFor(() =>
      expect(document.querySelector("[data-old-slot] [data-channel-conversation-panel]")).toBeTruthy(),
    );

    document.querySelector("[data-lead-report-page]")!.innerHTML =
      '<div data-channel-conversation-slot data-new-slot></div>';

    await waitFor(() =>
      expect(document.querySelector("[data-new-slot] [data-channel-conversation-panel]")).toBeTruthy(),
    );
  });
});
