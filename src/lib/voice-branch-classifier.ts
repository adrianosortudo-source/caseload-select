/**
 * Voice front-desk branch classification.
 *
 * The GHL agent emits a coarse marker (`RECORD_BRANCH: NEW_MATTER | OTHER |
 * UNCLEAR`) and the app independently classifies the transcript. The app is
 * authoritative for persistence and notification routing; the marker is only
 * one input.
 */

export type VoiceMacroBranch = 'NEW_MATTER' | 'OTHER' | 'UNCLEAR';

export type VoiceFineBranch =
  | 'new_matter'
  | 'existing_client'
  | 'admin'
  | 'court_or_counsel'
  | 'vendor'
  | 'wrong_number'
  | 'unclear';

export type VoiceCallbackBranch = Exclude<VoiceFineBranch, 'new_matter'>;

export type VoiceUrgency = 'normal' | 'urgent';

export interface VoiceBranchMarker {
  value: VoiceMacroBranch;
  raw: string;
}

export interface VoiceBranchDecision {
  marker: VoiceBranchMarker | null;
  classifierBranch: VoiceFineBranch;
  route: 'new_matter' | 'callback';
  callbackBranch: VoiceCallbackBranch | null;
  urgency: VoiceUrgency;
  urgencyTriggers: string[];
  operatorReview: boolean;
  reason: string;
}

const MARKER_RE = /\bRECORD_BRANCH\s*:\s*(NEW_MATTER|OTHER|UNCLEAR)\b/i;

const URGENCY_PATTERNS: Array<{ label: string; re: RegExp }> = [
  { label: 'court', re: /\bcourt\b/i },
  { label: 'judge', re: /\bjudge\b/i },
  { label: 'clerk', re: /\bclerk\b/i },
  { label: 'today', re: /\btoday\b/i },
  { label: 'tomorrow', re: /\btomorrow\b/i },
  { label: 'deadline', re: /\bdeadline\b/i },
  { label: 'served papers', re: /\bserved (?:with )?papers\b/i },
  { label: 'summons', re: /\bsummons\b/i },
  { label: 'subpoena', re: /\bsubpoena\b/i },
  { label: 'hearing', re: /\bhearing\b/i },
  { label: 'emergency', re: /\bemergency\b/i },
];

const WRONG_NUMBER_RE = /\b(wrong number|wrong person|not who i meant|called by mistake|mistake)\b/i;

const VENDOR_RE =
  /\b(vendor|sales|sell you|marketing services|seo|website services|lead generation|advertising|partnership opportunity|supplier|robocall)\b/i;

const COURT_OR_COUNSEL_RE =
  /\b(court clerk|judge'?s assistant|court office|courthouse|opposing counsel|counsel for|lawyer for the other|process server|bailiff|sheriff|subpoena|summons)\b/i;

const EXISTING_CLIENT_RE =
  /\b(existing client|current client|my case|my file|case update|file update|update on (?:my|the) case|already hired|i'?m a client|working with|retained|my lawyer)\b/i;

const ADMIN_RE =
  /\b(billing|invoice|payment|receipt|schedule|scheduling|appointment|book(?:ing)?|reschedule|cancel my appointment|documents?|send files?|upload|office hours|address|paralegal|callback|call back)\b/i;

const NEW_MATTER_RE =
  /\b(new legal matter|new matter|need (?:a )?lawyer|looking for (?:a )?lawyer|legal help|want help|need help with|consult(?:ation)?|will|estate|probate|power of attorney|severance|fired|terminated|wrongful dismissal|harassment|wages?|business partner|shareholder|contract dispute|unpaid invoice|real estate|purchase|sale|landlord|tenant)\b/i;

export function extractVoiceBranchMarker(transcript: string): VoiceBranchMarker | null {
  const match = MARKER_RE.exec(transcript ?? '');
  if (!match) return null;
  return {
    value: match[1].toUpperCase() as VoiceMacroBranch,
    raw: match[0],
  };
}

export function detectVoiceUrgency(transcript: string): {
  urgency: VoiceUrgency;
  triggers: string[];
} {
  const text = transcript ?? '';
  const triggers = URGENCY_PATTERNS.filter((p) => p.re.test(text)).map((p) => p.label);
  return { urgency: triggers.length > 0 ? 'urgent' : 'normal', triggers };
}

export function classifyVoiceBranchHeuristic(transcript: string): VoiceFineBranch {
  const text = (transcript ?? '').replace(MARKER_RE, ' ');
  if (!text.trim()) return 'unclear';
  if (WRONG_NUMBER_RE.test(text)) return 'wrong_number';
  if (COURT_OR_COUNSEL_RE.test(text)) return 'court_or_counsel';
  if (VENDOR_RE.test(text)) return 'vendor';
  if (EXISTING_CLIENT_RE.test(text)) return 'existing_client';
  // "unpaid invoice" is a corporate collection matter, not an admin billing
  // request. Check it before the broad admin "invoice" keyword.
  if (/\bunpaid invoice\b/i.test(text)) return 'new_matter';
  if (ADMIN_RE.test(text)) return 'admin';
  if (NEW_MATTER_RE.test(text)) return 'new_matter';
  return 'unclear';
}

export function reconcileVoiceBranch(args: {
  transcript: string;
  classifierBranch?: VoiceFineBranch;
  /**
   * Backward compatibility: while GHL is still transitioning from the v2.x
   * prompt, clear new-matter calls without a marker may continue to intake.
   * Set VOICE_ROUTER_STRICT_MARKER=true after v3.0 is verified if missing
   * markers should always route to operator review.
   */
  strictMissingMarker?: boolean;
}): VoiceBranchDecision {
  const marker = extractVoiceBranchMarker(args.transcript);
  const classifierBranch = args.classifierBranch ?? classifyVoiceBranchHeuristic(args.transcript);
  const { urgency, triggers } = detectVoiceUrgency(args.transcript);

  if (marker?.value === 'NEW_MATTER') {
    if (classifierBranch === 'new_matter') {
      return {
        marker,
        classifierBranch,
        route: 'new_matter',
        callbackBranch: null,
        urgency,
        urgencyTriggers: triggers,
        operatorReview: false,
        reason: 'marker_and_classifier_new_matter',
      };
    }
    return {
      marker,
      classifierBranch,
      route: 'callback',
      callbackBranch: 'unclear',
      urgency,
      urgencyTriggers: triggers,
      operatorReview: true,
      reason: 'marker_new_matter_classifier_non_intake',
    };
  }

  if (marker?.value === 'OTHER' || marker?.value === 'UNCLEAR') {
    if (classifierBranch === 'new_matter') {
      return {
        marker,
        classifierBranch,
        route: 'callback',
        callbackBranch: 'unclear',
        urgency,
        urgencyTriggers: triggers,
        operatorReview: true,
        reason: 'marker_non_intake_classifier_new_matter',
      };
    }
    return {
      marker,
      classifierBranch,
      route: 'callback',
      callbackBranch: classifierBranch,
      urgency,
      urgencyTriggers: triggers,
      operatorReview: marker.value === 'UNCLEAR',
      reason: marker.value === 'UNCLEAR' ? 'marker_unclear' : 'marker_other_classifier_non_intake',
    };
  }

  if (classifierBranch === 'new_matter' && !args.strictMissingMarker) {
    return {
      marker: null,
      classifierBranch,
      route: 'new_matter',
      callbackBranch: null,
      urgency,
      urgencyTriggers: triggers,
      operatorReview: true,
      reason: 'missing_marker_legacy_new_matter',
    };
  }

  return {
    marker: null,
    classifierBranch,
    route: 'callback',
    callbackBranch: classifierBranch === 'new_matter' ? 'unclear' : classifierBranch,
    urgency,
    urgencyTriggers: triggers,
    operatorReview: true,
    reason: 'missing_marker',
  };
}

export function buildVoiceCallbackMessage(transcript: string): string {
  const lines = (transcript ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !MARKER_RE.test(line))
    .filter((line) => /^(human|caller|user)\s*:/i.test(line))
    .map((line) => line.replace(/^(human|caller|user)\s*:\s*/i, '').trim());

  const text = (lines.length > 0 ? lines.join(' ') : (transcript ?? '').replace(MARKER_RE, ' '))
    .replace(/\s+/g, ' ')
    .trim();

  return text.slice(0, 1200);
}
