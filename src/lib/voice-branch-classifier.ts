/**
 * Voice front-desk branch classification.
 *
 * Current GHL agents write a structured call intent silently. Older agents
 * emitted a coarse transcript marker (`RECORD_BRANCH: NEW_MATTER | OTHER |
 * UNCLEAR`). The app independently classifies caller speech in either case.
 * Structured intent is preferred; the legacy marker remains a compatibility
 * input until every live agent has migrated.
 */

export type VoiceMacroBranch = 'NEW_MATTER' | 'OTHER' | 'UNCLEAR';

export type VoiceStructuredIntent =
  | 'new_legal_help'
  | 'existing_client'
  | 'admin_business'
  | 'unknown_recovery';

export type VoiceFineBranch =
  | 'new_matter'
  | 'existing_client'
  | 'admin'
  | 'court_or_counsel'
  | 'vendor'
  | 'wrong_number'
  | 'caller_declined'
  | 'unclear';

export type VoiceCallbackBranch = Exclude<VoiceFineBranch, 'new_matter'>;

export type VoiceUrgency = 'normal' | 'urgent';

export interface VoiceBranchMarker {
  value: VoiceMacroBranch;
  raw: string;
}

export interface VoiceBranchDecision {
  structuredIntent: VoiceStructuredIntent | null;
  marker: VoiceBranchMarker | null;
  classifierBranch: VoiceFineBranch;
  route: 'new_matter' | 'callback';
  callbackBranch: VoiceCallbackBranch | null;
  urgency: VoiceUrgency;
  urgencyTriggers: string[];
  operatorReview: boolean;
  reason: string;
}

/**
 * Routing and urgency are about the caller's situation, never the agent's
 * scripted language. GHL transcripts normally label speakers; when they do,
 * discard bot/agent lines before matching. If a provider gives us unlabeled
 * text we keep it rather than silently losing a possible urgent request.
 */
export function callerSpeechOnly(transcript: string): string {
  const lines = (transcript ?? '').split(/\r?\n/).filter(Boolean);
  const callerLines = lines.filter((line) => /^(human|caller|user|client)\s*:/i.test(line));
  if (callerLines.length === 0) return transcript ?? '';
  return callerLines
    .map((line) => line.replace(/^(human|caller|user|client)\s*:\s*/i, ''))
    .join('\n');
}

const MARKER_RE = /\bRECORD_BRANCH\s*:\s*(NEW_MATTER|OTHER|UNCLEAR)\b/i;

const STRUCTURED_INTENT_ALIASES: Record<string, VoiceStructuredIntent> = {
  new_legal_help: 'new_legal_help',
  new_matter: 'new_legal_help',
  legal_help: 'new_legal_help',
  existing_client: 'existing_client',
  current_client: 'existing_client',
  admin_business: 'admin_business',
  administrative: 'admin_business',
  admin: 'admin_business',
  unknown_recovery: 'unknown_recovery',
  unknown: 'unknown_recovery',
  unclear: 'unknown_recovery',
};

/** Normalize the constrained GHL field while rejecting unresolved template
 * placeholders and unrecognized free text. */
export function parseVoiceStructuredIntent(value: string | undefined | null): VoiceStructuredIntent | null {
  const normalized = (value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  if (!normalized || /^\{\{[^{}]+\}\}$/.test(normalized)) return null;
  return STRUCTURED_INTENT_ALIASES[normalized] ?? null;
}

const URGENCY_PATTERNS: Array<{ label: string; re: RegExp }> = [
  { label: 'today', re: /\btoday\b/i },
  { label: 'tomorrow', re: /\btomorrow\b/i },
  { label: 'tonight', re: /\btonight\b/i },
  { label: 'within 24 hours', re: /\bwithin (?:one|1|twenty[- ]four|24) hours?\b/i },
  { label: 'same-day period', re: /\bthis (?:morning|afternoon|evening)\b/i },
  { label: 'immediate', re: /\b(?:right now|immediately)\b/i },
  { label: 'emergency', re: /\b(?:an |a |it is |it's |this is )?emergency\b/i },
];

const NEGATED_URGENCY_CLAUSE_RE =
  /\b(?:no|not|isn't|is not|aren't|are not|without)\b[^.!?\n]{0,50}\b(?:urgent|emergency|deadline|due|hearing|court|today|tomorrow|tonight)\b[^.!?\n]*/gi;

const WRONG_NUMBER_RE = /\b(wrong number|wrong person|not who i meant|called by mistake|mistake)\b/i;
// A refusal of further contact is a recovery disposition. Refusing SMS alone
// is only a channel-consent decision and must never override a legal-help
// classification.
const CALLER_DECLINED_RE = /\b(do not call|don't call|do not contact|don't contact|stop calling|remove me)\b/i;

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
  // Remove explicitly negated urgency clauses before matching. This keeps
  // statements such as "No deadline that I know of" from becoming urgent,
  // while a separate caller statement such as "The hearing is tomorrow"
  // still supplies affirmative evidence.
  const text = callerSpeechOnly(transcript).replace(NEGATED_URGENCY_CLAUSE_RE, ' ');
  const triggers = URGENCY_PATTERNS.filter((p) => p.re.test(text)).map((p) => p.label);
  return { urgency: triggers.length > 0 ? 'urgent' : 'normal', triggers };
}

export function classifyVoiceBranchHeuristic(transcript: string): VoiceFineBranch {
  const text = callerSpeechOnly(transcript).replace(MARKER_RE, ' ');
  if (!text.trim()) return 'unclear';
  if (CALLER_DECLINED_RE.test(text)) return 'caller_declined';
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
  structuredCallIntent?: string | null;
  /**
   * Backward compatibility: while GHL is still transitioning from the v2.x
   * prompt, clear new-matter calls without a marker may continue to intake.
   * Set VOICE_ROUTER_STRICT_MARKER=true after v3.0 is verified if missing
   * markers should always route to operator review.
   */
  strictMissingMarker?: boolean;
}): VoiceBranchDecision {
  const structuredIntent = parseVoiceStructuredIntent(args.structuredCallIntent);
  const marker = extractVoiceBranchMarker(args.transcript);
  const classifierBranch = args.classifierBranch ?? classifyVoiceBranchHeuristic(args.transcript);
  const { urgency, triggers } = detectVoiceUrgency(args.transcript);

  if (structuredIntent) {
    if (structuredIntent === 'new_legal_help') {
      if (classifierBranch === 'new_matter') {
        return {
          structuredIntent,
          marker,
          classifierBranch,
          route: 'new_matter',
          callbackBranch: null,
          urgency,
          urgencyTriggers: triggers,
          operatorReview: marker !== null && marker.value !== 'NEW_MATTER',
          reason: marker !== null && marker.value !== 'NEW_MATTER'
            ? 'structured_new_matter_legacy_marker_conflict'
            : 'structured_and_classifier_new_matter',
        };
      }
      return {
        structuredIntent,
        marker,
        classifierBranch,
        route: 'callback',
        callbackBranch: 'unclear',
        urgency,
        urgencyTriggers: triggers,
        operatorReview: true,
        reason: 'structured_new_matter_classifier_non_intake',
      };
    }

    if (structuredIntent === 'unknown_recovery') {
      return {
        structuredIntent,
        marker,
        classifierBranch,
        route: 'callback',
        callbackBranch: classifierBranch === 'new_matter' ? 'unclear' : classifierBranch,
        urgency,
        urgencyTriggers: triggers,
        operatorReview: true,
        reason: classifierBranch === 'new_matter'
          ? 'structured_recovery_classifier_new_matter'
          : 'structured_recovery',
      };
    }

    const expectedBranch: VoiceFineBranch = structuredIntent === 'existing_client'
      ? 'existing_client'
      : 'admin';
    if (classifierBranch === 'new_matter') {
      return {
        structuredIntent,
        marker,
        classifierBranch,
        route: 'callback',
        callbackBranch: 'unclear',
        urgency,
        urgencyTriggers: triggers,
        operatorReview: true,
        reason: 'structured_non_intake_classifier_new_matter',
      };
    }
    const callbackBranch = structuredIntent === 'existing_client'
      ? 'existing_client'
      : classifierBranch === 'court_or_counsel' || classifierBranch === 'vendor' || classifierBranch === 'wrong_number'
        ? classifierBranch
        : expectedBranch;
    return {
      structuredIntent,
      marker,
      classifierBranch,
      route: 'callback',
      callbackBranch,
      urgency,
      urgencyTriggers: triggers,
      operatorReview: classifierBranch !== expectedBranch,
      reason: classifierBranch === expectedBranch
        ? 'structured_and_classifier_non_intake'
        : 'structured_non_intake_classifier_mismatch',
    };
  }

  if (marker?.value === 'NEW_MATTER') {
    if (classifierBranch === 'new_matter') {
      return {
        structuredIntent: null,
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
      structuredIntent: null,
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
        structuredIntent: null,
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
      structuredIntent: null,
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
      structuredIntent: null,
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
    structuredIntent: null,
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
