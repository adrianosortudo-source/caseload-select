"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import TriageQueueCard, { type QueueCardRow } from "./TriageQueueCard";
import { channelLabel } from "@/lib/channel-labels";
import {
  searchAndRankQueue,
  SAVED_VIEWS,
  type SavedView,
} from "@/lib/triage-search";
import {
  loadSearchHistory,
  pushSearchHistory,
  removeSearchHistoryEntry,
  clearSearchHistory,
} from "@/lib/triage-search-history";
import {
  loadUserViews,
  saveUserView,
  deleteUserView,
  type UserSavedView,
} from "@/lib/triage-search-views";

/**
 * Triage queue search + filter chrome.
 *
 * Capabilities:
 *   - Ranked search (lib/triage-search)
 *   - Multi-token AND, qualified fields, quoted phrases, negation, fuzzy
 *   - System-preset views: Top priority / Whales / Voice / Stale (4h+)
 *   - User-defined saved views, persisted to localStorage per firm
 *   - Search history dropdown when search field is focused + empty
 *   - Keyboard shortcuts:
 *       /         focus search
 *       Esc       clear (from search), then reset all (from elsewhere)
 *       ↓ / ↑     navigate cards in the visible list
 *       Enter     open the focused card (or recent search entry)
 *
 * URL params are the source of truth for shareable links:
 *   ?q=<query>&band=A,B&channel=voice&view=priority
 */

const BAND_VALUES: Array<"A" | "B" | "C" | "D"> = ["A", "B", "C", "D"];
const CHANNEL_VALUES = ["web", "voice", "facebook", "instagram", "whatsapp", "sms", "gbp", "tool"];
const HISTORY_PERSIST_DELAY_MS = 1_800;

interface Props {
  firmId: string;
  rows: QueueCardRow[];
  view: "active" | "history";
}

function parseBands(raw: string | null): Array<"A" | "B" | "C" | "D"> {
  if (!raw) return [];
  return raw
    .split(",")
    .map((b) => b.trim().toUpperCase())
    .filter((b): b is "A" | "B" | "C" | "D" => BAND_VALUES.includes(b as "A" | "B" | "C" | "D"));
}

function parseChannels(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((c) => c.trim().toLowerCase())
    .filter((c) => CHANNEL_VALUES.includes(c));
}

function parseSystemView(raw: string | null): SavedView | null {
  if (!raw) return null;
  return SAVED_VIEWS.find((v) => v.id === raw) ?? null;
}

export default function TriageQueueClient({ firmId, rows, view }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // ── Filter state ─────────────────────────────────────────────────────
  const [query, setQuery] = useState<string>(searchParams?.get("q") ?? "");
  const [bands, setBands] = useState<Array<"A" | "B" | "C" | "D">>(parseBands(searchParams?.get("band") ?? null));
  const [channels, setChannels] = useState<string[]>(parseChannels(searchParams?.get("channel") ?? null));
  const [systemView, setSystemView] = useState<SavedView | null>(parseSystemView(searchParams?.get("view") ?? null));

  // ── Persistent state (localStorage) ──────────────────────────────────
  const [history, setHistory] = useState<string[]>([]);
  const [userViews, setUserViews] = useState<UserSavedView[]>([]);
  useEffect(() => {
    setHistory(loadSearchHistory(firmId));
    setUserViews(loadUserViews(firmId));
  }, [firmId]);

  // ── UI state ─────────────────────────────────────────────────────────
  const [helpOpen, setHelpOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyHighlight, setHistoryHighlight] = useState<number>(-1);
  const [focusedCardIndex, setFocusedCardIndex] = useState<number>(-1);
  const [saveFormOpen, setSaveFormOpen] = useState(false);
  const [saveLabel, setSaveLabel] = useState("");

  // ── Refs ─────────────────────────────────────────────────────────────
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const cardRefs = useRef<Array<HTMLAnchorElement | null>>([]);
  const historyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── URL sync (debounced) ─────────────────────────────────────────────
  useEffect(() => {
    const timer = setTimeout(() => {
      const next = new URLSearchParams(searchParams?.toString() ?? "");
      if (query.trim()) next.set("q", query.trim());
      else next.delete("q");
      if (bands.length > 0) next.set("band", bands.join(","));
      else next.delete("band");
      if (channels.length > 0) next.set("channel", channels.join(","));
      else next.delete("channel");
      if (systemView) next.set("view", systemView.id);
      else next.delete("view");
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    }, 200);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, bands, channels, systemView]);

  // ── Persist successful searches to history after idle ─────────────────
  // We don't push to history on every keystroke. Wait ~1.8s of idle. Also
  // push on Enter / on blur (handled inline).
  useEffect(() => {
    if (historyTimer.current) clearTimeout(historyTimer.current);
    if (query.trim().length >= 2) {
      historyTimer.current = setTimeout(() => {
        setHistory(pushSearchHistory(firmId, query));
      }, HISTORY_PERSIST_DELAY_MS);
    }
    return () => {
      if (historyTimer.current) clearTimeout(historyTimer.current);
    };
  }, [query, firmId]);

  // ── Run the ranked search ────────────────────────────────────────────
  const scored = useMemo(
    () => searchAndRankQueue(rows, { query, bands, channels, view: systemView }),
    [rows, query, bands, channels, systemView],
  );

  // Reset card focus when the filtered set changes — otherwise focusedCardIndex
  // becomes stale and might point at a card that no longer exists.
  useEffect(() => {
    setFocusedCardIndex(-1);
  }, [scored.length, query]);

  // Apply focus when focusedCardIndex changes (and is valid).
  useEffect(() => {
    if (focusedCardIndex >= 0 && focusedCardIndex < scored.length) {
      const el = cardRefs.current[focusedCardIndex];
      if (el) {
        el.focus({ preventScroll: false });
        el.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    }
  }, [focusedCardIndex, scored.length]);

  // ── Chip counts ──────────────────────────────────────────────────────
  const counts = useMemo(() => {
    const bandCounts: Record<"A" | "B" | "C" | "D", number> = { A: 0, B: 0, C: 0, D: 0 };
    const channelCounts: Record<string, number> = {};
    for (const r of rows) {
      if (r.band && bandCounts[r.band] !== undefined) bandCounts[r.band] += 1;
      const ch = r.slot_answers?.channel;
      if (ch) channelCounts[ch] = (channelCounts[ch] ?? 0) + 1;
    }
    return { bandCounts, channelCounts };
  }, [rows]);

  const totalCount = rows.length;
  const matchCount = scored.length;
  const hasFilters =
    query.trim().length > 0 || bands.length > 0 || channels.length > 0 || systemView !== null;

  // ── Handlers ─────────────────────────────────────────────────────────
  const toggleBand = useCallback((band: "A" | "B" | "C" | "D") => {
    setBands((prev) => (prev.includes(band) ? prev.filter((b) => b !== band) : [...prev, band]));
  }, []);

  const toggleChannel = useCallback((channel: string) => {
    setChannels((prev) => (prev.includes(channel) ? prev.filter((c) => c !== channel) : [...prev, channel]));
  }, []);

  const selectSystemView = useCallback((v: SavedView) => {
    setSystemView((prev) => (prev?.id === v.id ? null : v));
  }, []);

  const selectUserView = useCallback((uv: UserSavedView) => {
    // Applying a user view REPLACES current filter state. The user view is
    // a complete filter bundle.
    setQuery(uv.query);
    setBands(uv.bands);
    setChannels(uv.channels);
    setSystemView(null);
    setSaveFormOpen(false);
  }, []);

  const handleDeleteUserView = useCallback((id: string) => {
    setUserViews(deleteUserView(firmId, id));
  }, [firmId]);

  const resetAll = useCallback(() => {
    setQuery("");
    setBands([]);
    setChannels([]);
    setSystemView(null);
    setFocusedCardIndex(-1);
    setHistoryOpen(false);
    setHistoryHighlight(-1);
  }, []);

  const handleSaveCurrentView = useCallback(() => {
    const label = saveLabel.trim();
    if (!label) return;
    setUserViews(saveUserView(firmId, { label, query, bands, channels }));
    setSaveFormOpen(false);
    setSaveLabel("");
  }, [firmId, saveLabel, query, bands, channels]);

  const handleHistoryPick = useCallback((entry: string) => {
    setQuery(entry);
    setHistoryOpen(false);
    setHistoryHighlight(-1);
    setHistory(pushSearchHistory(firmId, entry));
    searchInputRef.current?.focus();
  }, [firmId]);

  const handleHistoryRemove = useCallback((entry: string) => {
    setHistory(removeSearchHistoryEntry(firmId, entry));
  }, [firmId]);

  const handleHistoryClear = useCallback(() => {
    clearSearchHistory(firmId);
    setHistory([]);
    setHistoryOpen(false);
    setHistoryHighlight(-1);
  }, [firmId]);

  // ── Keyboard shortcuts ───────────────────────────────────────────────
  useEffect(() => {
    function isEditableTarget(el: EventTarget | null): boolean {
      if (!(el instanceof HTMLElement)) return false;
      const tag = el.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable;
    }
    function handleKey(e: KeyboardEvent) {
      // `/` focuses search (when not already typing).
      if (e.key === "/" && !isEditableTarget(document.activeElement)) {
        e.preventDefault();
        searchInputRef.current?.focus();
        return;
      }

      // Escape: hierarchical clear behavior.
      if (e.key === "Escape") {
        if (historyOpen) {
          setHistoryOpen(false);
          setHistoryHighlight(-1);
          e.preventDefault();
          return;
        }
        if (document.activeElement === searchInputRef.current) {
          if (query) {
            setQuery("");
            e.preventDefault();
          }
          return;
        }
        if (focusedCardIndex >= 0) {
          setFocusedCardIndex(-1);
          searchInputRef.current?.focus();
          e.preventDefault();
          return;
        }
        if (hasFilters && !isEditableTarget(document.activeElement)) {
          resetAll();
          e.preventDefault();
        }
        return;
      }

      // ↓ / ↑ navigation.
      if (e.key === "ArrowDown") {
        if (historyOpen && history.length > 0) {
          setHistoryHighlight((h) => Math.min(h + 1, history.length - 1));
          e.preventDefault();
          return;
        }
        if (document.activeElement === searchInputRef.current || focusedCardIndex < 0) {
          if (scored.length > 0) {
            setFocusedCardIndex(0);
            e.preventDefault();
          }
          return;
        }
        if (focusedCardIndex < scored.length - 1) {
          setFocusedCardIndex(focusedCardIndex + 1);
          e.preventDefault();
        }
        return;
      }

      if (e.key === "ArrowUp") {
        if (historyOpen && history.length > 0) {
          setHistoryHighlight((h) => Math.max(h - 1, 0));
          e.preventDefault();
          return;
        }
        if (focusedCardIndex > 0) {
          setFocusedCardIndex(focusedCardIndex - 1);
          e.preventDefault();
          return;
        }
        if (focusedCardIndex === 0) {
          setFocusedCardIndex(-1);
          searchInputRef.current?.focus();
          e.preventDefault();
        }
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [historyOpen, history.length, query, hasFilters, focusedCardIndex, scored.length, resetAll]);

  return (
    <>
      <QueueHeader
        view={view}
        totalCount={totalCount}
        matchCount={matchCount}
        hasFilters={hasFilters}
        query={query}
        onQueryChange={(q) => { setQuery(q); setHistoryHighlight(-1); }}
        searchInputRef={searchInputRef}
        bands={bands}
        channels={channels}
        systemView={systemView}
        userViews={userViews}
        bandCounts={counts.bandCounts}
        channelCounts={counts.channelCounts}
        onToggleBand={toggleBand}
        onToggleChannel={toggleChannel}
        onSelectSystemView={selectSystemView}
        onSelectUserView={selectUserView}
        onDeleteUserView={handleDeleteUserView}
        onResetAll={resetAll}
        helpOpen={helpOpen}
        onToggleHelp={() => setHelpOpen((v) => !v)}
        historyOpen={historyOpen}
        history={history}
        historyHighlight={historyHighlight}
        onHistoryOpenChange={setHistoryOpen}
        onHistoryPick={handleHistoryPick}
        onHistoryRemove={handleHistoryRemove}
        onHistoryClear={handleHistoryClear}
        onHistorySubmit={() => {
          if (historyHighlight >= 0 && historyHighlight < history.length) {
            handleHistoryPick(history[historyHighlight]);
          } else if (query.trim().length >= 2) {
            setHistory(pushSearchHistory(firmId, query));
          }
        }}
        saveFormOpen={saveFormOpen}
        saveLabel={saveLabel}
        onSaveLabelChange={setSaveLabel}
        onOpenSaveForm={() => setSaveFormOpen(true)}
        onCancelSaveForm={() => { setSaveFormOpen(false); setSaveLabel(""); }}
        onSaveCurrentView={handleSaveCurrentView}
      />
      {scored.length === 0 ? (
        <EmptyState view={view} hasFilters={hasFilters} onResetAll={resetAll} />
      ) : (
        <ul className="space-y-3" role="listbox" aria-label="Triage queue">
          {scored.map((s, i) => (
            <li key={s.row.lead_id}>
              <TriageQueueCard
                ref={(el) => { cardRefs.current[i] = el; }}
                firmId={firmId}
                row={s.row}
                view={view}
                highlights={s.highlights}
                cardIndex={i}
                isFocused={focusedCardIndex === i}
              />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

// ───────────────────────────────────────────────────────────────────────
// Queue Header (search + chips + views + history + save form)
// ───────────────────────────────────────────────────────────────────────

interface QueueHeaderProps {
  view: "active" | "history";
  totalCount: number;
  matchCount: number;
  hasFilters: boolean;
  query: string;
  onQueryChange: (q: string) => void;
  searchInputRef: React.MutableRefObject<HTMLInputElement | null>;
  bands: Array<"A" | "B" | "C" | "D">;
  channels: string[];
  systemView: SavedView | null;
  userViews: UserSavedView[];
  bandCounts: Record<"A" | "B" | "C" | "D", number>;
  channelCounts: Record<string, number>;
  onToggleBand: (b: "A" | "B" | "C" | "D") => void;
  onToggleChannel: (c: string) => void;
  onSelectSystemView: (v: SavedView) => void;
  onSelectUserView: (v: UserSavedView) => void;
  onDeleteUserView: (id: string) => void;
  onResetAll: () => void;
  helpOpen: boolean;
  onToggleHelp: () => void;
  historyOpen: boolean;
  history: string[];
  historyHighlight: number;
  onHistoryOpenChange: (open: boolean) => void;
  onHistoryPick: (entry: string) => void;
  onHistoryRemove: (entry: string) => void;
  onHistoryClear: () => void;
  onHistorySubmit: () => void;
  saveFormOpen: boolean;
  saveLabel: string;
  onSaveLabelChange: (label: string) => void;
  onOpenSaveForm: () => void;
  onCancelSaveForm: () => void;
  onSaveCurrentView: () => void;
}

function QueueHeader(props: QueueHeaderProps) {
  const {
    view, totalCount, matchCount, hasFilters,
    query, onQueryChange, searchInputRef,
    bands, channels, systemView, userViews,
    bandCounts, channelCounts,
    onToggleBand, onToggleChannel, onSelectSystemView, onSelectUserView,
    onDeleteUserView, onResetAll,
    helpOpen, onToggleHelp,
    historyOpen, history, historyHighlight,
    onHistoryOpenChange, onHistoryPick, onHistoryRemove, onHistoryClear, onHistorySubmit,
    saveFormOpen, saveLabel, onSaveLabelChange, onOpenSaveForm, onCancelSaveForm, onSaveCurrentView,
  } = props;

  const totalNoun = view === "history" ? "finalised" : "waiting";
  const visibleChannels = CHANNEL_VALUES.filter((c) => (channelCounts[c] ?? 0) > 0);

  // Search input event handlers — focus opens history dropdown; blur closes
  // (with a small delay so the mousedown on a history entry registers).
  const handleSearchFocus = () => {
    if (history.length > 0 && !query) onHistoryOpenChange(true);
  };
  const handleSearchBlur = () => {
    // Delay so a click on a history row can register before we close.
    setTimeout(() => onHistoryOpenChange(false), 120);
  };
  const handleSearchKeyDown: React.KeyboardEventHandler<HTMLInputElement> = (e) => {
    if (e.key === "Enter") {
      onHistorySubmit();
      e.preventDefault();
    }
  };

  return (
    <div className="bg-white border border-black/10 px-4 py-4 space-y-3">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <span className="text-[11px] uppercase tracking-wider font-bold text-navy">
          {view === "history" ? "History" : "Queue"}
        </span>
        <span className="text-[11px] uppercase tracking-wider text-black/55">
          <b className="text-navy font-bold">{totalCount}</b> {totalCount === 1 ? "lead" : "leads"} {totalNoun}
        </span>
      </div>

      {/* ── Views row: system presets + user views + save button ──────── */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-[10px] uppercase tracking-wider font-bold text-black/40 mr-1 min-w-[52px]">
          Views
        </span>
        {SAVED_VIEWS.map((v) => {
          const active = systemView?.id === v.id;
          return (
            <button
              key={v.id}
              type="button"
              onClick={() => onSelectSystemView(v)}
              className={`px-2.5 py-1 text-xs border transition-colors ${
                active
                  ? "bg-gold text-navy border-gold font-bold"
                  : "bg-parchment text-black/75 border-black/15 hover:border-navy hover:text-navy"
              }`}
              title={`View: ${v.label}`}
            >
              {v.label}
            </button>
          );
        })}
        {userViews.length > 0 && <span className="text-black/20 mx-1" aria-hidden>·</span>}
        {userViews.map((uv) => (
          <span key={uv.id} className="inline-flex items-stretch border border-black/15 group">
            <button
              type="button"
              onClick={() => onSelectUserView(uv)}
              className="px-2.5 py-1 text-xs text-black/75 hover:text-navy bg-parchment hover:bg-white"
              title={`Your view: ${uv.label} — query: "${uv.query}"`}
            >
              {uv.label}
            </button>
            <button
              type="button"
              onClick={() => onDeleteUserView(uv.id)}
              aria-label={`Delete view ${uv.label}`}
              title="Delete view"
              className="px-1.5 text-black/30 hover:text-red-700 border-l border-black/10 bg-parchment hover:bg-white"
            >
              &times;
            </button>
          </span>
        ))}
        {hasFilters && !saveFormOpen && (
          <button
            type="button"
            onClick={onOpenSaveForm}
            className="px-2.5 py-1 text-xs text-navy border border-dashed border-navy/40 hover:bg-parchment ml-1"
            title="Save current filters as a view"
          >
            + Save view
          </button>
        )}
      </div>

      {/* ── Inline save-view form ─────────────────────────────────────── */}
      {saveFormOpen && (
        <div className="bg-parchment border border-black/10 px-3 py-2.5 flex items-center gap-2 flex-wrap">
          <span className="text-[10px] uppercase tracking-wider font-bold text-black/55">
            Save as
          </span>
          <input
            type="text"
            value={saveLabel}
            onChange={(e) => onSaveLabelChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onSaveCurrentView();
              if (e.key === "Escape") onCancelSaveForm();
            }}
            placeholder="View name (e.g. Patel pending)"
            autoFocus
            className="flex-1 min-w-[180px] px-2 py-1 text-sm bg-white border border-black/15 focus:border-navy outline-none"
          />
          <button
            type="button"
            onClick={onSaveCurrentView}
            disabled={!saveLabel.trim()}
            className="px-3 py-1 text-xs font-bold uppercase tracking-wider bg-navy text-white border border-navy hover:bg-navy/85 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Save
          </button>
          <button
            type="button"
            onClick={onCancelSaveForm}
            className="px-3 py-1 text-xs uppercase tracking-wider text-black/60 hover:text-navy"
          >
            Cancel
          </button>
        </div>
      )}

      {/* ── Search input + dropdowns ──────────────────────────────────── */}
      <div className="relative">
        <svg
          className="absolute left-3 top-[14px] text-black/40 pointer-events-none"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <circle cx="11" cy="11" r="8"></circle>
          <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
        </svg>
        <input
          ref={searchInputRef}
          type="text"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onFocus={handleSearchFocus}
          onBlur={handleSearchBlur}
          onKeyDown={handleSearchKeyDown}
          placeholder="Search — name, phone, email, postal, ref, matter. Try band:A or channel:voice or -channel:web"
          aria-label="Search leads"
          className="w-full pl-9 pr-24 py-2 text-sm bg-parchment border border-black/15 focus:bg-white focus:border-navy outline-none transition-colors"
        />
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
          {query && (
            <button
              type="button"
              onClick={() => onQueryChange("")}
              aria-label="Clear search"
              title="Clear (Esc)"
              className="text-black/40 hover:text-navy text-base leading-none px-2"
            >
              &times;
            </button>
          )}
          <button
            type="button"
            onClick={onToggleHelp}
            aria-label="Search help"
            title="Search syntax"
            className={`text-[10px] uppercase tracking-wider font-bold border px-1.5 py-0.5 transition-colors ${
              helpOpen
                ? "bg-navy text-white border-navy"
                : "border-black/15 text-black/45 hover:border-navy hover:text-navy"
            }`}
          >
            ?
          </button>
          <kbd className="hidden sm:inline-flex items-center px-1.5 py-0.5 text-[10px] font-mono border border-black/15 text-black/40 bg-white">
            /
          </kbd>
        </div>

        {/* History dropdown */}
        {historyOpen && history.length > 0 && !query && (
          <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-white border border-black/15 shadow-md max-h-72 overflow-y-auto">
            <div className="flex items-baseline justify-between px-3 py-1.5 border-b border-black/5 bg-parchment">
              <span className="text-[10px] uppercase tracking-wider font-bold text-black/45">Recent searches</span>
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); onHistoryClear(); }}
                className="text-[10px] uppercase tracking-wider text-navy hover:text-navy/70 underline"
              >
                Clear all
              </button>
            </div>
            <ul role="listbox" aria-label="Recent searches">
              {history.map((entry, i) => (
                <li key={entry} className={`flex items-center justify-between px-3 py-1.5 cursor-pointer text-sm border-b border-black/5 last:border-b-0 ${
                  historyHighlight === i ? "bg-parchment" : "hover:bg-parchment"
                }`}>
                  <button
                    type="button"
                    onMouseDown={(e) => { e.preventDefault(); onHistoryPick(entry); }}
                    className="flex-1 text-left text-black/80 truncate"
                  >
                    {entry}
                  </button>
                  <button
                    type="button"
                    onMouseDown={(e) => { e.preventDefault(); onHistoryRemove(entry); }}
                    aria-label={`Remove ${entry} from history`}
                    title="Remove"
                    className="text-black/30 hover:text-red-700 px-2 text-base leading-none"
                  >
                    &times;
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* ── Help dropdown ─────────────────────────────────────────────── */}
      {helpOpen && (
        <div className="bg-parchment border border-black/10 px-3 py-2.5 text-[11px] text-black/70 space-y-1.5">
          <p>
            <b className="text-navy">Multi-word</b>: <code className="font-mono">patel messenger</code> — both must match (AND).
          </p>
          <p>
            <b className="text-navy">Quoted phrase</b>: <code className="font-mono">&quot;van der berg&quot;</code> — contiguous match.
          </p>
          <p>
            <b className="text-navy">Negation</b>: <code className="font-mono">-channel:voice</code>, <code className="font-mono">-patel</code> — exclude matching rows.
          </p>
          <p>
            <b className="text-navy">Field prefixes</b>: <code className="font-mono">name:</code>, <code className="font-mono">phone:</code>, <code className="font-mono">email:</code>, <code className="font-mono">postal:</code>, <code className="font-mono">band:</code>, <code className="font-mono">channel:</code>, <code className="font-mono">matter:</code>, <code className="font-mono">ref:</code>, <code className="font-mono">text:</code>.
          </p>
          <p>
            <b className="text-navy">Typo tolerance</b>: 4+ char queries fuzzy-match (1 edit for 4–5 chars, 2 edits for 6+).
          </p>
          <p>
            <b className="text-navy">Keyboard</b>: <kbd className="font-mono">/</kbd> focus, <kbd className="font-mono">↓</kbd> first card, <kbd className="font-mono">↑/↓</kbd> navigate, <kbd className="font-mono">Enter</kbd> open, <kbd className="font-mono">Esc</kbd> clear.
          </p>
        </div>
      )}

      {/* ── Band chips ────────────────────────────────────────────────── */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-[10px] uppercase tracking-wider font-bold text-black/40 mr-1 min-w-[52px]">
          Band
        </span>
        {BAND_VALUES.map((band) => {
          const active = bands.includes(band);
          const count = bandCounts[band];
          return (
            <button
              key={band}
              type="button"
              onClick={() => onToggleBand(band)}
              className={`inline-flex items-baseline gap-1.5 px-2.5 py-1 text-xs border transition-colors ${
                active
                  ? "bg-navy text-white border-navy"
                  : "bg-parchment text-black/75 border-black/15 hover:border-navy hover:text-navy"
              }`}
            >
              <span className="font-semibold">{band}</span>
              <span className={`font-mono text-[10px] ${active ? "text-white/70" : "text-black/40"}`}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* ── Channel chips ─────────────────────────────────────────────── */}
      {visibleChannels.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] uppercase tracking-wider font-bold text-black/40 mr-1 min-w-[52px]">
            Channel
          </span>
          {visibleChannels.map((channel) => {
            const active = channels.includes(channel);
            const count = channelCounts[channel] ?? 0;
            return (
              <button
                key={channel}
                type="button"
                onClick={() => onToggleChannel(channel)}
                className={`inline-flex items-baseline gap-1.5 px-2.5 py-1 text-xs border transition-colors ${
                  active
                    ? "bg-navy text-white border-navy"
                    : "bg-parchment text-black/75 border-black/15 hover:border-navy hover:text-navy"
                }`}
              >
                <span className="font-semibold">{channelLabel(channel)}</span>
                <span className={`font-mono text-[10px] ${active ? "text-white/70" : "text-black/40"}`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* ── Result count + reset ──────────────────────────────────────── */}
      {hasFilters && (
        <div className="pt-2 border-t border-black/5 flex items-baseline gap-3 flex-wrap text-[10px] uppercase tracking-wider">
          <span className="text-black/55">
            Showing <b className="text-navy font-bold">{matchCount}</b> of <b className="text-navy font-bold">{totalCount}</b>
            {systemView && <> · view: <b className="text-navy font-bold">{systemView.label}</b></>}
          </span>
          <button
            type="button"
            onClick={onResetAll}
            className="text-navy hover:text-navy/70 underline font-semibold"
          >
            Reset filters
          </button>
        </div>
      )}
    </div>
  );
}

function EmptyState({
  view,
  hasFilters,
  onResetAll,
}: {
  view: "active" | "history";
  hasFilters: boolean;
  onResetAll: () => void;
}) {
  if (hasFilters) {
    return (
      <div className="bg-white border border-black/8 px-6 py-10 text-center">
        <p className="text-sm text-black/60">No leads match the current search or filters.</p>
        <button
          type="button"
          onClick={onResetAll}
          className="mt-3 text-xs uppercase tracking-wider font-semibold text-navy hover:text-navy/70 underline"
        >
          Reset filters
        </button>
      </div>
    );
  }
  const message =
    view === "history"
      ? "No finalised leads yet. Leads you Take, Pass, or Refer land here."
      : "No leads currently in triage. New screenings land here as they arrive.";
  return (
    <div className="bg-white border border-black/8 px-6 py-10 text-center">
      <p className="text-sm text-black/60">{message}</p>
    </div>
  );
}
