/**
 * voice-handoff - cross-tab transport for the iOS voice handoff.
 *
 * On iOS every browser runs on WebKit, and WebKit refuses getUserMedia inside
 * a cross-origin iframe. The intake widget is always embedded cross-origin on
 * a firm site, so inline recording is impossible there. The handoff opens a
 * top-level first-party page on this same origin (app.caseloadselect.ca), where
 * the mic works, records + transcribes there, and sends the transcript back to
 * the embedded widget.
 *
 * Transport: the record tab and the widget iframe are the SAME origin
 * (app.caseloadselect.ca), so they share localStorage. The record tab writes
 * the result under a nonce-keyed localStorage entry; every other same-origin
 * context receives a `storage` event. A `window.opener.postMessage` is sent as
 * a secondary path. The embedding firm origin (e.g. drglaw.ca) cannot read or
 * write our localStorage and cannot see the message, so the channel is private
 * to our origin. The per-open `session` nonce + firmId guarantee the widget
 * only accepts the transcript it actually asked for.
 */

export const VOICE_HANDOFF_PATH = "/voice-handoff";
export const HANDOFF_MESSAGE_TYPE = "CLS_VOICE_TRANSCRIPT" as const;
const RESULT_KEY_PREFIX = "cls-voice-result:";

export interface VoiceHandoffResult {
  type: typeof HANDOFF_MESSAGE_TYPE;
  firmId: string;
  session: string;
  transcript: string;
}

function resultKey(session: string): string {
  return `${RESULT_KEY_PREFIX}${session}`;
}

/** A random, unguessable session id for one handoff round-trip. */
export function makeSession(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
    }
  } catch {
    // fall through
  }
  // Last-resort: not cryptographically strong, but the channel is already
  // origin-scoped; the nonce only disambiguates concurrent handoffs.
  return `s${Date.now().toString(36)}${Math.floor(performance.now()).toString(36)}`;
}

/** Build the top-level record URL on this origin. */
export function buildHandoffUrl(origin: string, firmId: string, session: string): string {
  const u = new URL(VOICE_HANDOFF_PATH, origin);
  u.searchParams.set("firmId", firmId);
  u.searchParams.set("session", session);
  return u.toString();
}

function isValidResult(value: unknown, firmId: string, session: string): value is VoiceHandoffResult {
  if (!value || typeof value !== "object") return false;
  const r = value as Record<string, unknown>;
  return (
    r.type === HANDOFF_MESSAGE_TYPE &&
    r.firmId === firmId &&
    r.session === session &&
    typeof r.transcript === "string" &&
    r.transcript.trim().length > 0
  );
}

/**
 * Widget side. Start listening for the transcript for this firmId + session.
 * Calls onResult once with the transcript, then stops. Returns a cleanup
 * function the caller must invoke (on unmount or after receiving).
 */
export function listenForHandoffResult(opts: {
  firmId: string;
  session: string;
  onResult: (transcript: string) => void;
}): () => void {
  const { firmId, session, onResult } = opts;
  let done = false;

  const finish = (transcript: string) => {
    if (done) return;
    done = true;
    try {
      window.localStorage.removeItem(resultKey(session));
    } catch {
      // ignore
    }
    cleanup();
    onResult(transcript);
  };

  const onStorage = (e: StorageEvent) => {
    if (e.key !== resultKey(session) || !e.newValue) return;
    try {
      const parsed = JSON.parse(e.newValue);
      if (isValidResult(parsed, firmId, session)) finish(parsed.transcript);
    } catch {
      // ignore malformed
    }
  };

  const onMessage = (e: MessageEvent) => {
    // Only accept messages from our own origin (the record tab).
    if (e.origin !== window.location.origin) return;
    if (isValidResult(e.data, firmId, session)) finish(e.data.transcript);
  };

  // Re-read localStorage directly. Covers two cases: the result was written
  // before this listener attached, and (the important one on iOS) the widget
  // tab was backgrounded while the user recorded in the new tab. iOS suspends
  // background tabs, so a `storage` event fired during recording may never be
  // delivered; re-checking when the tab regains visibility recovers it.
  const checkExisting = () => {
    try {
      const raw = window.localStorage.getItem(resultKey(session));
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (isValidResult(parsed, firmId, session)) finish(parsed.transcript);
    } catch {
      // ignore
    }
  };

  const onVisible = () => {
    if (document.visibilityState === "visible") checkExisting();
  };

  window.addEventListener("storage", onStorage);
  window.addEventListener("message", onMessage);
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("focus", checkExisting);
  window.addEventListener("pageshow", checkExisting);
  checkExisting();

  function cleanup() {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener("message", onMessage);
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("focus", checkExisting);
    window.removeEventListener("pageshow", checkExisting);
  }

  return cleanup;
}

/**
 * Record side. Publish the transcript back to the widget. Writes the
 * nonce-keyed localStorage entry (fires a storage event in the widget) and
 * also posts to the opener as a secondary path.
 */
export function publishHandoffResult(result: VoiceHandoffResult): void {
  try {
    window.localStorage.setItem(resultKey(result.session), JSON.stringify(result));
  } catch {
    // ignore: opener postMessage below is the fallback
  }
  try {
    // The opener is the widget iframe, which is our own origin.
    window.opener?.postMessage(result, window.location.origin);
  } catch {
    // ignore
  }
}
