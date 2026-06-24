"use client";

/**
 * CaseLoad Connect chat surface, shared by the operator console
 * (/admin/firms/[firmId]/messages) and the firm portal
 * (/portal/[firmId]/messages). The only differences between the two are
 * passed as props: the API base path, who "I" am (for ownership +
 * alignment), and what the other party is called.
 *
 * Poll-based refresh (30s), matching the matter-thread surfaces. The GET
 * marks the channel read server-side, so opening the page clears unread.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const REACTION_PALETTE = ["👍", "✅", "🙏", "👀", "🎉", "❓"];

export interface ChatMessage {
  id: string;
  parent_message_id: string | null;
  sender_role: "operator" | "lawyer" | "system";
  sender_id: string | null;
  sender_name: string | null;
  body: string;
  attachments: { storage_path: string; name: string; size?: number; mime?: string; signed_url?: string }[];
  edited_at: string | null;
  deleted_at: string | null;
  pinned_at: string | null;
  pinned_by: string | null;
  reactions: { emoji: string; count: number; mine: boolean }[];
  context:
    | {
        kind: "deliverable_comment";
        deliverable_id: string;
        deliverable_title: string;
        comment_id: string;
        version_id: string;
        annotation_label: string;
      }
    | { kind: "deliverable_lifecycle"; deliverable_id: string; deliverable_title: string; event: string }
    | null;
  created_at: string;
}

interface FirmChatProps {
  apiBase: string;
  firmId: string;
  currentRole: "operator" | "lawyer";
  currentId: string;
  /** What the OTHER party is called, shown in the header. */
  counterpartLabel: string;
  initialMessages: ChatMessage[];
}

const POLL_MS = 30000;

export default function FirmChat({
  apiBase,
  firmId,
  currentRole,
  currentId,
  counterpartLabel,
  initialMessages,
}: FirmChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [pinnedOnly, setPinnedOnly] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(apiBase, { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data.messages)) setMessages(data.messages as ChatMessage[]);
    } catch {
      // transient; next poll retries
    }
  }, [apiBase]);

  const act = useCallback(
    async (messageId: string, action: string, emoji?: string) => {
      try {
        await fetch(`${apiBase}/${messageId}/action`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, emoji }),
        });
        refresh();
      } catch {
        // transient
      }
    },
    [apiBase, refresh],
  );

  useEffect(() => {
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  const roots = messages.filter((m) => !m.parent_message_id);
  const repliesByParent = new Map<string, ChatMessage[]>();
  for (const m of messages) {
    if (m.parent_message_id) {
      const list = repliesByParent.get(m.parent_message_id) ?? [];
      list.push(m);
      repliesByParent.set(m.parent_message_id, list);
    }
  }

  function isMine(m: ChatMessage): boolean {
    return m.sender_role === currentRole && m.sender_id === currentId;
  }

  const q = query.trim().toLowerCase();
  const searching = q !== "" || pinnedOnly;
  const pinnedCount = useMemo(
    () => messages.filter((m) => m.pinned_at && !m.deleted_at).length,
    [messages],
  );
  const filtered = useMemo(
    () =>
      messages.filter((m) => {
        if (m.deleted_at) return false;
        if (pinnedOnly && !m.pinned_at) return false;
        if (q) {
          const hay = `${m.body} ${m.sender_name ?? ""}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      }),
    [messages, q, pinnedOnly],
  );

  return (
    <div className="flex flex-col h-[calc(100vh-13rem)] bg-white border border-border-brand">
      <div className="px-4 py-3 border-b border-border-brand flex items-center justify-between gap-3 shrink-0 flex-wrap">
        <div className="min-w-0">
          <div className="text-sm font-display font-bold text-navy">CaseLoad Connect</div>
          <div className="text-[11px] text-muted">
            Direct line with {counterpartLabel}. Not visible to clients.
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {pinnedCount > 0 && (
            <button
              onClick={() => setPinnedOnly((v) => !v)}
              className={`text-[10px] uppercase tracking-wider font-semibold px-2 py-1.5 border transition-colors ${
                pinnedOnly
                  ? "bg-navy text-white border-navy"
                  : "border-border-brand text-muted hover:text-navy"
              }`}
            >
              Pinned {pinnedCount}
            </button>
          )}
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search"
            className="text-xs px-2 py-1.5 border border-border-brand bg-white focus:outline-none focus:border-navy w-32"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {searching ? (
          filtered.length === 0 ? (
            <p className="text-sm text-black/45 text-center py-10">
              {pinnedOnly && q === "" ? "No pinned messages." : "No messages match."}
            </p>
          ) : (
            filtered.map((m) => (
              <MessageRow key={m.id} m={m} mine={isMine(m)} apiBase={apiBase} firmId={firmId} act={act} onChanged={refresh} compact />
            ))
          )
        ) : roots.length === 0 ? (
          <p className="text-sm text-black/45 text-center py-10">
            No messages yet. Start the conversation below.
          </p>
        ) : (
          roots.map((m) => (
            <div key={m.id}>
              <MessageRow
                m={m}
                mine={isMine(m)}
                apiBase={apiBase}
                firmId={firmId}
                act={act}
                onChanged={refresh}
                onReply={() => setReplyTo(replyTo === m.id ? null : m.id)}
                replyOpen={replyTo === m.id}
              />
              {(repliesByParent.get(m.id) ?? []).length > 0 && (
                <div className="ml-6 mt-2 space-y-2 border-l-2 border-border-brand pl-3">
                  {(repliesByParent.get(m.id) ?? []).map((r) => (
                    <MessageRow key={r.id} m={r} mine={isMine(r)} apiBase={apiBase} firmId={firmId} act={act} onChanged={refresh} compact />
                  ))}
                </div>
              )}
              {replyTo === m.id && (
                <div className="ml-6 mt-2 pl-3">
                  <Composer
                    apiBase={apiBase}
                    parentId={m.id}
                    placeholder={`Reply to ${m.sender_name ?? "message"}`}
                    onSent={() => {
                      setReplyTo(null);
                      refresh();
                    }}
                  />
                </div>
              )}
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-border-brand p-3 shrink-0">
        <Composer apiBase={apiBase} parentId={null} placeholder="Write a message" onSent={refresh} />
      </div>
    </div>
  );
}

function contextHref(ctx: NonNullable<ChatMessage["context"]>, firmId: string): string {
  const fid = encodeURIComponent(firmId);
  const did = encodeURIComponent(ctx.deliverable_id);
  if (ctx.kind === "deliverable_comment") {
    return `/portal/${fid}/deliverables/${did}?comment=${encodeURIComponent(ctx.comment_id)}`;
  }
  return `/portal/${fid}/deliverables/${did}`;
}

function contextLabel(ctx: NonNullable<ChatMessage["context"]>): string {
  if (ctx.kind === "deliverable_comment") return `Open comment on ${ctx.deliverable_title}`;
  return `Open ${ctx.deliverable_title}`;
}

function MessageRow({
  m,
  mine,
  apiBase,
  firmId,
  act,
  onChanged,
  onReply,
  replyOpen,
  compact,
}: {
  m: ChatMessage;
  mine: boolean;
  apiBase: string;
  firmId: string;
  act: (messageId: string, action: string, emoji?: string) => void;
  onChanged: () => void;
  onReply?: () => void;
  replyOpen?: boolean;
  compact?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [editBody, setEditBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [showReact, setShowReact] = useState(false);

  const when = formatWhen(m.created_at);
  const isSystem = m.sender_role === "system";

  function toggleReaction(emoji: string) {
    const existing = m.reactions?.find((r) => r.emoji === emoji);
    act(m.id, existing?.mine ? "unreact" : "react", emoji);
    setShowReact(false);
  }

  async function saveEdit() {
    setBusy(true);
    try {
      await fetch(`${apiBase}/${m.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: editBody }),
      });
      setEditing(false);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm("Delete this message?")) return;
    setBusy(true);
    try {
      await fetch(`${apiBase}/${m.id}`, { method: "DELETE" });
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`${compact ? "" : "border-b border-border-brand pb-3"}`}>
      <div className="flex items-baseline gap-2">
        <span className={`text-xs font-display font-bold ${isSystem ? "text-muted" : "text-navy"}`}>
          {m.sender_name ?? (isSystem ? "System" : "Unknown")}
        </span>
        <span className="text-[10px] text-black/40 tabular-nums">{when}</span>
        {m.edited_at && <span className="text-[10px] text-black/35">(edited)</span>}
        {m.pinned_at && (
          <span className="text-[10px] uppercase tracking-wider font-semibold text-navy" title={m.pinned_by ? `Pinned by ${m.pinned_by}` : "Pinned"}>
            Pinned
          </span>
        )}
      </div>

      {m.deleted_at ? (
        <p className="text-xs text-black/35 mt-1">This message was deleted.</p>
      ) : editing ? (
        <div className="mt-1">
          <textarea
            value={editBody}
            onChange={(e) => setEditBody(e.target.value)}
            rows={2}
            className="w-full text-sm px-2 py-1.5 border border-border-brand focus:outline-none focus:border-navy"
          />
          <div className="flex gap-2 mt-1">
            <button
              onClick={saveEdit}
              disabled={busy}
              className="text-[10px] uppercase tracking-wider font-semibold px-2 py-1 bg-navy text-white disabled:opacity-40"
            >
              Save
            </button>
            <button
              onClick={() => setEditing(false)}
              className="text-[10px] uppercase tracking-wider font-semibold px-2 py-1 border border-border-brand text-muted"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div
          className="text-sm text-black/80 mt-1 whitespace-pre-wrap break-words [&_a]:text-navy [&_a]:underline"
          // Body is sanitized server-side (sanitizeMessageHtml) before storage.
          dangerouslySetInnerHTML={{ __html: m.body }}
        />
      )}

      {!m.deleted_at && m.attachments?.length > 0 && (
        <div className="mt-1.5 flex flex-col gap-1">
          {m.attachments.map((a, i) => (
            <a
              key={i}
              href={a.signed_url ?? "#"}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-navy underline truncate"
            >
              {a.name}
            </a>
          ))}
        </div>
      )}

      {!m.deleted_at && m.context && (
        <a
          href={contextHref(m.context, firmId)}
          className="mt-1.5 inline-flex items-center gap-1 text-[11px] uppercase tracking-wider font-semibold text-navy hover:underline"
        >
          {contextLabel(m.context)} <span aria-hidden>&#8599;</span>
        </a>
      )}

      {!m.deleted_at && m.reactions?.length > 0 && (
        <div className="mt-1.5 flex items-center gap-1 flex-wrap">
          {m.reactions.map((r) => (
            <button
              key={r.emoji}
              onClick={() => act(m.id, r.mine ? "unreact" : "react", r.emoji)}
              className={`inline-flex items-center gap-1 text-xs px-1.5 py-0.5 border ${
                r.mine ? "bg-navy/10 border-navy/30 text-navy" : "bg-parchment-2 border-border-brand text-black/60"
              }`}
            >
              <span>{r.emoji}</span>
              <span className="tabular-nums text-[10px]">{r.count}</span>
            </button>
          ))}
        </div>
      )}

      {!m.deleted_at && (
        <div className="mt-1.5 flex items-center gap-3 relative">
          {onReply && (
            <button
              onClick={onReply}
              className="text-[10px] uppercase tracking-wider font-semibold text-muted hover:text-navy"
            >
              {replyOpen ? "Close" : "Reply"}
            </button>
          )}
          <button
            onClick={() => setShowReact((v) => !v)}
            className="text-[10px] uppercase tracking-wider font-semibold text-muted hover:text-navy"
          >
            React
          </button>
          <button
            onClick={() => act(m.id, m.pinned_at ? "unpin" : "pin")}
            className="text-[10px] uppercase tracking-wider font-semibold text-muted hover:text-navy"
          >
            {m.pinned_at ? "Unpin" : "Pin"}
          </button>
          {mine && !editing && (
            <>
              <button
                onClick={() => {
                  setEditBody(stripTags(m.body));
                  setEditing(true);
                }}
                className="text-[10px] uppercase tracking-wider font-semibold text-muted hover:text-navy"
              >
                Edit
              </button>
              <button
                onClick={remove}
                disabled={busy}
                className="text-[10px] uppercase tracking-wider font-semibold text-muted hover:text-red-fail disabled:opacity-40"
              >
                Delete
              </button>
            </>
          )}
          {showReact && (
            <div className="absolute bottom-full left-0 mb-1 z-10 flex items-center gap-1 bg-white border border-border-brand p-1 shadow-none">
              {REACTION_PALETTE.map((emoji) => (
                <button
                  key={emoji}
                  onClick={() => toggleReaction(emoji)}
                  className="text-sm px-1 hover:bg-parchment-2"
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Composer({
  apiBase,
  parentId,
  placeholder,
  onSent,
}: {
  apiBase: string;
  parentId: string | null;
  placeholder: string;
  onSent: () => void;
}) {
  const [body, setBody] = useState("");
  const [attachments, setAttachments] = useState<
    { storage_path: string; name: string; size?: number; mime?: string }[]
  >([]);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`${apiBase}/upload`, { method: "POST", body: fd });
      const data = await res.json();
      if (res.ok && data.attachment) {
        setAttachments((prev) => [...prev, data.attachment]);
      } else {
        alert(data.error ?? "Upload failed");
      }
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function send() {
    if (!body.trim() && attachments.length === 0) return;
    setBusy(true);
    try {
      const res = await fetch(apiBase, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body, attachments, parent_message_id: parentId }),
      });
      if (res.ok) {
        setBody("");
        setAttachments([]);
        onSent();
      } else {
        const data = await res.json().catch(() => ({}));
        alert(data.error ?? "Send failed");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-1.5">
          {attachments.map((a, i) => (
            <span
              key={i}
              className="text-[10px] bg-parchment-2 border border-border-brand px-2 py-0.5 text-black/70"
            >
              {a.name}
            </span>
          ))}
        </div>
      )}
      <div className="flex items-end gap-2">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              send();
            }
          }}
          rows={2}
          placeholder={placeholder}
          className="flex-1 text-sm px-3 py-2 border border-border-brand focus:outline-none focus:border-navy resize-none"
        />
        <input ref={fileRef} type="file" onChange={onPickFile} className="hidden" />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          title="Attach a file"
          className="text-xs uppercase tracking-wider font-semibold px-2 py-2 border border-border-brand text-muted hover:text-navy disabled:opacity-40"
        >
          {uploading ? "..." : "Attach"}
        </button>
        <button
          onClick={send}
          disabled={busy || (!body.trim() && attachments.length === 0)}
          className="text-xs uppercase tracking-wider font-semibold px-4 py-2 bg-gold text-deep-black hover:bg-gold/90 disabled:opacity-40"
        >
          Send
        </button>
      </div>
    </div>
  );
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function stripTags(html: string): string {
  if (typeof document === "undefined") return html.replace(/<[^>]*>/g, "");
  const tmp = document.createElement("div");
  tmp.innerHTML = html;
  return tmp.textContent ?? "";
}
