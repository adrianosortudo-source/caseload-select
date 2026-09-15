"use client";

import { createPortal } from "react-dom";
import { useSyncExternalStore } from "react";
import ChannelConversationPanel, {
  type ChannelConversationMessage,
  type ChannelReplyWindow,
  type ReplyChannel,
} from "./ChannelConversationPanel";

interface Props {
  messages: ChannelConversationMessage[];
  channel: ReplyChannel;
  firmName: string;
  assetId?: string | null;
  replyWindow: ChannelReplyWindow;
  supportPreview: boolean;
  actorIdentityAvailable: boolean;
  replyEndpoint: string;
}

const SLOT_SELECTOR = "[data-lead-report-page] [data-channel-conversation-slot]";

function subscribeToSlotChanges(onStoreChange: () => void): () => void {
  const observer = new MutationObserver(onStoreChange);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  return () => observer.disconnect();
}

function getSlotSnapshot(): Element | null {
  return document.querySelector(SLOT_SELECTOR);
}

function getServerSlotSnapshot(): null {
  return null;
}

/**
 * Mount the live conversation controls into the stable slot carried by the
 * stored brief HTML. The target exists before effects run because BriefFrame
 * renders the stored markup on the server.
 */
export default function ConversationRailPortal(props: Props) {
  const target = useSyncExternalStore(
    subscribeToSlotChanges,
    getSlotSnapshot,
    getServerSlotSnapshot,
  );

  if (!target) return null;

  return createPortal(<ChannelConversationPanel {...props} compact />, target);
}
