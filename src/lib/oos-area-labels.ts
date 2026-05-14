/**
 * OOS practice-area display labels.
 *
 * Used by every channel that fires a `declined_oos` GHL webhook: the
 * receiver needs to interpolate a human-readable practice-area label into
 * the decline copy ("Sorry, we don't currently practice in family law").
 *
 * History: this constant was first inlined in `/api/intake-v2/route.ts`,
 * then duplicated in `/api/voice-intake/route.ts` with a TODO comment
 * pointing here as the doctrine fix. As of the Meta-channels-engine-wiring
 * patch (Block 2 of Meta App Review prep), every new server-side intake
 * processor imports from here. The legacy duplicates in intake-v2 and
 * voice-intake remain because their patches were instructed not to be
 * modified; a follow-up cleanup can route those imports here too.
 */

export const OOS_AREA_LABELS: Record<string, string> = {
  family: 'family law',
  immigration: 'immigration',
  employment: 'employment',
  criminal: 'criminal',
  personal_injury: 'personal injury',
  estates: 'wills and estates',
};
