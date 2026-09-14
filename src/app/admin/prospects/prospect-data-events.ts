export const PROSPECT_DATA_CHANGED_EVENT = "caseload:prospect-data-changed";

export function notifyProspectDataChanged(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(PROSPECT_DATA_CHANGED_EVENT));
  }
}
