"use client";

import { useState, useRef, type FormEvent, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import type { MatterAttachment } from "@/lib/types";

export default function ComposeForm({ firmId, matterId }: { firmId: string; matterId: string }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingAttachments, setPendingAttachments] = useState<MatterAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function onFileChange(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    e.target.value = "";
    setUploadError(null);
    setUploading(true);
    try {
      for (const file of files) {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch(`/api/portal/${firmId}/matters/${matterId}/messages/upload`, { method: "POST", body: fd });
        const json = await res.json();
        if (!res.ok || !json.ok) {
          setUploadError(json.error ?? "Upload failed. Please try again.");
        } else {
          setPendingAttachments((prev) => [...prev, json.attachment as MatterAttachment]);
        }
      }
    } finally {
      setUploading(false);
    }
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!body.trim() && pendingAttachments.length === 0) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/portal/${firmId}/matters/${matterId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel_type: "client", body: body.trim() || "(attachment)", attachments: pendingAttachments }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json.error ?? "Could not send. Please try again.");
        setSending(false);
        return;
      }
      setBody("");
      setPendingAttachments([]);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? `Network error: ${err.message}` : "Network error. Please try again.");
      setSending(false);
    }
  }

  const canSend = (body.trim().length > 0 || pendingAttachments.length > 0) && !sending;

  return (
    <form onSubmit={onSubmit} className="mt-5">
      {pendingAttachments.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {pendingAttachments.map((a, i) => (
            <span key={i} className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-white border border-gold text-xs text-body rounded">
              {a.name}
              <button
                type="button"
                onClick={() => setPendingAttachments((prev) => prev.filter((_, j) => j !== i))}
                className="text-muted hover:text-body leading-none"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <textarea
        name="body"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Write a message to your lawyer..."
        rows={4}
        disabled={sending}
        className="w-full px-3 py-2.5 border border-gold bg-white text-sm resize-y rounded focus:outline-none focus:border-navy disabled:opacity-60"
      />

      <div className="flex items-center gap-2.5 mt-2.5">
        <button
          type="submit"
          disabled={!canSend}
          className={`px-5 py-2.5 font-display font-bold text-sm transition rounded ${
            canSend ? "bg-navy text-white hover:bg-deep-black cursor-pointer" : "bg-muted text-white/60 cursor-not-allowed"
          }`}
        >
          {sending ? "Sending..." : "Send to your lawyer"}
        </button>

        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading || sending}
          className="border border-gold text-xs text-body px-3.5 py-2.5 hover:bg-parchment transition rounded disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {uploading ? "Uploading..." : "Attach file"}
        </button>

        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.txt,.csv"
          onChange={onFileChange}
          className="hidden"
        />
      </div>

      {uploadError && <p className="text-xs text-red-fail mt-1.5">{uploadError}</p>}
      {error ? (
        <p className="text-xs text-red-fail mt-2">
          {error} You can also reply to your last email and your lawyer will see it.
        </p>
      ) : (
        <p className="text-xs text-muted mt-1.5">Replies usually arrive within one business day.</p>
      )}
    </form>
  );
}
