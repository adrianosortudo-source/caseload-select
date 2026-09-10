/**
 * Cross-surface refresh signal for prospect operations reads. It carries no
 * prospect data; listeners re-read their own operator-gated endpoints.
 */
export const PROSPECT_OPERATIONS_CHANGED_EVENT = 'caseload:prospect-operations-changed';

export function notifyProspectOperationsChanged(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(PROSPECT_OPERATIONS_CHANGED_EVENT));
}
