"use client";

/**
 * MilestoneDraftPanel
 *
 * J8 Milestone Assistant: lawyer-facing UI for generating and approving
 * AI-drafted client update messages at key matter milestones.
 *
 * Flow:
 *   1. Lawyer selects a milestone from the practice-area-aware picklist.
 *   2. Optionally adds a personal note to weave into the draft.
 *   3. Clicks "Generate draft" to call POST /api/portal/.../milestone-draft.
 *   4. Reviews the returned draft; can edit inline before approving.
 *   5. Clicks "Send to client" to POST the final text to the messages route.
 *
 * Only renders when matter_stage === 'active'.
 * Does NOT auto-send. Every message requires explicit lawyer approval.
 */

import { useState } from "react";
import { getMilestoneOptions, CUSTOM_MILESTONE_OPTION } from "@/lib/milestone-options";

interface MilestoneDraftPanelProps {
  firmId: string;
  matterId: string;
  practiceArea: string;
  currentMilestone?: string | null;
}

type PanelState =
  | { kind: "idle" }
  | { kind: "generating" }
  | { kind: "draft"; text: string }
  | { kind: "sending" }
  | { kind: "sent" }
  | { kind: "error"; message: string };

export default function MilestoneDraftPanel({
  firmId,
  matterId,
  practiceArea,
  currentMilestone,
}: MilestoneDraftPanelProps) {
  const options = getMilestoneOptions(practiceArea);

  const [expanded, setExpanded] = useState(false);
  const [milestone, setMilestone] = useState(currentMilestone ?? options[0] ?? "");
  const [isCustom, setIsCustom] = useState(false);
  const [customMilestone, setCustomMilestone] = useState("");
  const [note, setNote] = useState("");
  const [state, setState] = useState<PanelState>({ kind: "idle" });

  const activeMilestone = isCustom ? customMilestone.trim() : milestone;

  async function onGenerate() {
    if (!activeMilestone) return;
    setState({ kind: "generating" });

    try {
      const res = await fetch(
        `/api/portal/${firmId}/matters/${matterId}/milestone-draft`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ milestone: activeMilestone, note: note.trim() || undefined }),
        },
      );
      const json = await res.json();
      if (!res.ok) {
        setState({ kind: "error", message: json.error ?? "Draft generation failed. Please try again." });
        return;
      }
      setState({ kind: "draft", text: json.draft ?? "" });
    } catch {
      setState({ kind: "error", message: "Network error. Please try again." });
    }
  }

  async function onSend(text: string) {
    if (!text.trim()) return;
    setState({ kind: "sending" });

    try {
      const res = await fetch(
        `/api/portal/${firmId}/matters/${matterId}/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ channel_type: "client", body: text.trim() }),
        },
      );
      if (!res.ok) {
        const json = await res.json();
        setState({ kind: "error", message: json.error ?? "Send failed. Please try again." });
        return;
      }
      setState({ kind: "sent" });
      setNote("");
    } catch {
      setState({ kind: "error", message: "Network error. Please try again." });
    }
  }

  function onReset() {
    setState({ kind: "idle" });
  }

  const canGenerate =
    activeMilestone.length > 0 &&
    state.kind !== "generating" &&
    state.kind !== "sending";

  return (
    <section style={cardStyle}>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        style={headerButtonStyle}
        aria-expanded={expanded}
      >
        <span style={eyebrowStyle}>Milestone update</span>
        <span style={chevronStyle}>{expanded ? "▲" : "▼"}</span>
      </button>

      {expanded && (
        <div style={bodyStyle}>
          {state.kind === "sent" ? (
            <div style={successStyle}>
              <p style={{ margin: 0 }}>Message sent to client.</p>
              <button type="button" onClick={onReset} style={linkButtonStyle}>
                Send another update
              </button>
            </div>
          ) : (
            <>
              <div style={fieldRowStyle}>
                <label style={labelStyle} htmlFor="milestone-select">
                  Milestone reached
                </label>
                <select
                  id="milestone-select"
                  value={isCustom ? CUSTOM_MILESTONE_OPTION : milestone}
                  onChange={(e) => {
                    if (e.target.value === CUSTOM_MILESTONE_OPTION) {
                      setIsCustom(true);
                    } else {
                      setIsCustom(false);
                      setMilestone(e.target.value);
                    }
                    setState({ kind: "idle" });
                  }}
                  style={inputStyle}
                  disabled={state.kind === "generating" || state.kind === "sending"}
                >
                  {options.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                  <option value={CUSTOM_MILESTONE_OPTION}>{CUSTOM_MILESTONE_OPTION}</option>
                </select>
              </div>

              {isCustom && (
                <div style={fieldRowStyle}>
                  <label style={labelStyle} htmlFor="custom-milestone">
                    Describe the milestone
                  </label>
                  <input
                    id="custom-milestone"
                    type="text"
                    value={customMilestone}
                    onChange={(e) => {
                      setCustomMilestone(e.target.value);
                      setState({ kind: "idle" });
                    }}
                    placeholder="e.g. Certificate of title received"
                    style={inputStyle}
                    maxLength={120}
                    disabled={state.kind === "generating" || state.kind === "sending"}
                  />
                </div>
              )}

              <div style={fieldRowStyle}>
                <label style={labelStyle} htmlFor="milestone-note">
                  Personal note (optional)
                </label>
                <textarea
                  id="milestone-note"
                  value={note}
                  onChange={(e) => {
                    setNote(e.target.value);
                    setState({ kind: "idle" });
                  }}
                  placeholder="Anything specific to mention? The AI will weave it in."
                  style={{ ...inputStyle, height: 56, resize: "vertical" }}
                  maxLength={300}
                  disabled={state.kind === "generating" || state.kind === "sending"}
                />
              </div>

              {state.kind === "error" && (
                <p style={errorStyle}>{state.message}</p>
              )}

              {state.kind !== "draft" && (
                <button
                  type="button"
                  onClick={onGenerate}
                  disabled={!canGenerate}
                  style={canGenerate ? primaryButtonStyle : disabledButtonStyle}
                >
                  {state.kind === "generating" ? "Generating draft..." : "Generate draft"}
                </button>
              )}

              {state.kind === "draft" && (
                <DraftReview
                  initialText={state.text}
                  onSend={onSend}
                  onRegenerate={onGenerate}
                  sending={false}
                />
              )}

              {state.kind === "sending" && (
                <p style={{ margin: "8px 0 0", fontSize: 13, color: "#555" }}>Sending...</p>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}

function DraftReview({
  initialText,
  onSend,
  onRegenerate,
  sending,
}: {
  initialText: string;
  onSend: (text: string) => void;
  onRegenerate: () => void;
  sending: boolean;
}) {
  const [text, setText] = useState(initialText);

  return (
    <div style={{ marginTop: 12 }}>
      <label style={labelStyle} htmlFor="draft-text">
        Draft (review and edit before sending)
      </label>
      <textarea
        id="draft-text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        style={{ ...inputStyle, height: 100, resize: "vertical", fontFamily: "inherit" }}
        disabled={sending}
      />
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button
          type="button"
          onClick={() => onSend(text)}
          disabled={!text.trim() || sending}
          style={text.trim() && !sending ? primaryButtonStyle : disabledButtonStyle}
        >
          Send to client
        </button>
        <button
          type="button"
          onClick={onRegenerate}
          disabled={sending}
          style={secondaryButtonStyle}
        >
          Regenerate
        </button>
      </div>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────

const cardStyle: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #e2ddd7",
  padding: 0,
  marginTop: 24,
};

const headerButtonStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  width: "100%",
  padding: "12px 16px",
  background: "none",
  border: "none",
  cursor: "pointer",
  textAlign: "left",
};

const eyebrowStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  color: "#1E2F58",
};

const chevronStyle: React.CSSProperties = {
  fontSize: 10,
  color: "#888",
};

const bodyStyle: React.CSSProperties = {
  padding: "0 16px 16px",
  borderTop: "1px solid #f0ece7",
};

const fieldRowStyle: React.CSSProperties = {
  marginTop: 12,
  display: "flex",
  flexDirection: "column",
  gap: 4,
};

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  color: "#555",
};

const inputStyle: React.CSSProperties = {
  fontSize: 13,
  padding: "6px 8px",
  border: "1px solid #d0ccc6",
  background: "#fafaf9",
  color: "#1E2F58",
  width: "100%",
  boxSizing: "border-box",
};

const primaryButtonStyle: React.CSSProperties = {
  marginTop: 12,
  fontSize: 12,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  padding: "8px 16px",
  background: "#1E2F58",
  color: "#fff",
  border: "none",
  cursor: "pointer",
};

const secondaryButtonStyle: React.CSSProperties = {
  marginTop: 12,
  fontSize: 12,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  padding: "8px 16px",
  background: "none",
  color: "#1E2F58",
  border: "1px solid #1E2F58",
  cursor: "pointer",
};

const disabledButtonStyle: React.CSSProperties = {
  ...primaryButtonStyle,
  background: "#ccc",
  cursor: "not-allowed",
};

const successStyle: React.CSSProperties = {
  padding: "12px 0",
  display: "flex",
  alignItems: "center",
  gap: 12,
  fontSize: 13,
  color: "#2d6a2d",
};

const linkButtonStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  cursor: "pointer",
  color: "#1E2F58",
  fontSize: 12,
  textDecoration: "underline",
};

const errorStyle: React.CSSProperties = {
  fontSize: 12,
  color: "#b00",
  margin: "8px 0 0",
};
