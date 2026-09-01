"use client";

import { type FormEvent, useRef, useState } from "react";
import { SUPPORT_PREVIEW_READ_ONLY_MESSAGE } from "@/lib/support-preview-copy";

export type ReplyChannel = "facebook" | "instagram" | "whatsapp";

export interface ChannelConversationMessage {
  id: string;
  direction: "inbound" | "outbound";
  source: string;
  body: string;
  status: string;
  occurredAt: string;
}

export interface ChannelReplyWindow {
  isOpen: boolean;
  closesAt: string | null;
  reason: string | null;
}

interface Props {
  messages: ChannelConversationMessage[];
  channel: ReplyChannel;
  firmName: string;
  assetId?: string | null;
  replyWindow: ChannelReplyWindow;
  supportPreview: boolean;
  replyEndpoint: string;
  intakeTranscript?: string | null;
}

const CHANNEL_LABELS: Record<ReplyChannel, string> = {
  facebook: "Facebook Messenger",
  instagram: "Instagram",
  whatsapp: "WhatsApp",
};

function formatOccurredAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Time unavailable";

  return new Intl.DateTimeFormat("en-CA", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Toronto",
    timeZoneName: "short",
  }).format(date);
}

function replyUnavailableReason({
  supportPreview,
  replyWindow,
}: Pick<Props, "supportPreview" | "replyWindow">): string | null {
  if (supportPreview) return SUPPORT_PREVIEW_READ_ONLY_MESSAGE;
  if (replyWindow.isOpen) return null;
  if (replyWindow.reason === "expired") {
    return "The 24-hour response window has closed. Wait for a new inbound message before replying.";
  }
  if (replyWindow.reason === "no_authoritative_inbound") {
    return "Replying is unavailable because no authoritative inbound message timestamp is available.";
  }
  return (
    replyWindow.reason ??
    "Replying is unavailable because this conversation does not have an open 24-hour response window."
  );
}

function isMessage(value: unknown): value is ChannelConversationMessage {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ChannelConversationMessage>;
  return (
    typeof candidate.id === "string" &&
    (candidate.direction === "inbound" || candidate.direction === "outbound") &&
    typeof candidate.source === "string" &&
    typeof candidate.body === "string" &&
    typeof candidate.status === "string" &&
    typeof candidate.occurredAt === "string"
  );
}

export default function ChannelConversationPanel({
  messages,
  channel,
  firmName,
  assetId,
  replyWindow,
  supportPreview,
  replyEndpoint,
  intakeTranscript,
}: Props) {
  const [conversation, setConversation] = useState(messages);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState("");
  const sendInFlight = useRef(false);
  const unavailableReason = replyUnavailableReason({ supportPreview, replyWindow });
  const instagramByteCount = channel === "instagram" ? new TextEncoder().encode(draft).length : 0;
  const exceedsChannelLimit = channel === "instagram" && instagramByteCount > 1000;
  const sendDisabled =
    sending || unavailableReason !== null || exceedsChannelLimit || draft.trim().length === 0;

  async function sendReply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = draft.trim();
    if (sendInFlight.current || sendDisabled || body.length === 0) return;

    sendInFlight.current = true;
    setSending(true);
    setFeedback("Sending reply.");
    const clientRequestId = crypto.randomUUID();

    try {
      const response = await fetch(replyEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          body,
          client_request_id: clientRequestId,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        message?: unknown;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "The reply could not be sent. Try again.");
      }

      const sentMessage: ChannelConversationMessage = isMessage(payload.message)
        ? payload.message
        : {
            id: clientRequestId,
            direction: "outbound",
            source: "portal",
            body,
            status: "sent",
            occurredAt: new Date().toISOString(),
          };

      setConversation((current) => [...current, sentMessage]);
      setDraft("");
      setFeedback("Reply sent.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "The reply could not be sent. Try again.");
    } finally {
      sendInFlight.current = false;
      setSending(false);
    }
  }

  return (
    <section className="border border-black/10 bg-white" aria-labelledby="channel-conversation-heading">
      <div
        className="border-b border-black/10 px-4 py-4 sm:px-6"
        data-ui-component-content="channel-conversation-heading"
      >
        <p
          className="w-full text-xs font-semibold uppercase tracking-wider text-gold"
          data-ui-copy="supporting"
        >
          Lead conversation
        </p>
        <h2
          id="channel-conversation-heading"
          className="mt-1 w-full text-xl font-bold text-navy text-pretty"
          data-ui-copy="heading"
        >
          {CHANNEL_LABELS[channel]} with {firmName}
        </h2>
        <div className="mt-2 flex w-full flex-wrap items-center gap-x-3 gap-y-1 text-xs text-black/55">
          <span>Connected as {firmName}</span>
          {assetId && <span>Meta asset {assetId}</span>}
        </div>
      </div>

      <div className="space-y-3 bg-parchment px-4 py-4 sm:px-6" aria-label="Conversation history">
        {conversation.length === 0 ? (
          <p className="w-full text-sm text-black/55">No conversation messages are available yet.</p>
        ) : (
          conversation.map((message) => {
            const failed = message.status.toLowerCase() === "failed";
            return (
              <article
                key={message.id}
                className={`max-w-[88%] border px-3 py-2 sm:max-w-[72%] ${
                  message.direction === "outbound"
                    ? "ml-auto border-navy/20 bg-navy text-white"
                    : "mr-auto border-black/10 bg-white text-deep-black"
                } ${failed ? "border-red-500" : ""}`}
              >
                <p className="whitespace-pre-wrap break-words text-sm">{message.body}</p>
                <div
                  className={`mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] ${
                    message.direction === "outbound" ? "text-white/70" : "text-black/45"
                  }`}
                >
                  <time dateTime={message.occurredAt}>{formatOccurredAt(message.occurredAt)}</time>
                  <span>{message.source}</span>
                  <span className={failed ? "font-semibold text-red-300" : ""}>{message.status}</span>
                </div>
              </article>
            );
          })
        )}
      </div>

      {intakeTranscript && (
        <div
          className="border-t border-black/10 px-4 py-4 sm:px-6"
          data-ui-component-content="channel-intake-transcript"
        >
          <h3 className="w-full text-sm font-bold text-navy" data-ui-copy="heading">
            Inbound intake transcript
          </h3>
          <p className="mt-1 w-full text-xs text-black/55 text-pretty" data-ui-copy="supporting">
            This legacy transcript preserves intake text. It is separate from the conversation history and may not contain every message.
          </p>
          <div className="mt-3 whitespace-pre-wrap break-words border border-black/10 bg-parchment px-3 py-3 text-sm text-black/70">
            {intakeTranscript}
          </div>
        </div>
      )}

      <form
        onSubmit={sendReply}
        className="border-t border-black/10 px-4 py-4 sm:px-6"
        data-ui-component-content="channel-reply-composer"
      >
        <label htmlFor="channel-reply-body" className="block w-full text-sm font-bold text-navy" data-ui-copy="heading">
          Reply as {firmName}
        </label>
        <textarea
          id="channel-reply-body"
          rows={4}
          maxLength={2000}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          disabled={unavailableReason !== null || sending}
          placeholder="Write a plain-text reply"
          className="mt-2 min-h-[112px] w-full resize-y border border-black/15 bg-parchment px-3 py-2 text-sm text-deep-black focus:border-navy focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
        />
        <div className="mt-2 flex w-full items-center justify-between gap-3 text-xs text-black/50">
          <span>
            {draft.length}/2000 characters
            {channel === "instagram" && ` · ${instagramByteCount}/1000 Instagram bytes`}
          </span>
          {replyWindow.isOpen && replyWindow.closesAt && !supportPreview && (
            <span>Reply window closes {formatOccurredAt(replyWindow.closesAt)}</span>
          )}
        </div>
        {unavailableReason && (
          <p className="mt-3 w-full text-sm text-red-700 text-pretty" data-ui-copy="supporting">
            {unavailableReason}
          </p>
        )}
        {exceedsChannelLimit && (
          <p className="mt-3 w-full text-sm text-red-700 text-pretty" data-ui-copy="supporting">
            Instagram replies must be 1000 UTF-8 bytes or fewer. Shorten this reply before sending.
          </p>
        )}
        <div className="mt-3 flex w-full items-center justify-end">
          <button
            type="submit"
            disabled={sendDisabled}
            className="min-h-[44px] bg-gold px-5 py-2.5 text-sm font-semibold uppercase tracking-wider text-navy disabled:cursor-not-allowed disabled:opacity-50"
          >
            {sending ? "Sending..." : "Send reply"}
          </button>
        </div>
        <p className="mt-2 min-h-5 w-full text-sm text-black/65" aria-live="polite" data-ui-copy="supporting">
          {feedback}
        </p>
      </form>
    </section>
  );
}
