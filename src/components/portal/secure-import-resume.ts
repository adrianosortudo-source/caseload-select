export type SecureImportCounts = {
  processed: number;
  created: number;
  existing: number;
  held: number;
  invalid: number;
  failed: number;
  reconcile: number;
};

export type SecureImportResumeState = {
  batchId: string;
  fileHash: string;
  rowCount: number;
  resumeIndex: number;
  counts?: SecureImportCounts;
};

type ResumeStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const RESUME_STORAGE_VERSION = "v1";
export const SECURE_IMPORT_CHUNK_SIZE = 25;

export function secureImportResumeStorageKey(firmId: string): string {
  return `secure-import:${RESUME_STORAGE_VERSION}:${firmId}`;
}

export function loadSecureImportResumeState(
  firmId: string,
  storage: ResumeStorage = localStorage,
): SecureImportResumeState | null {
  try {
    const value = storage.getItem(secureImportResumeStorageKey(firmId));
    return value ? (JSON.parse(value) as SecureImportResumeState) : null;
  } catch {
    return null;
  }
}

export function saveSecureImportResumeState(
  firmId: string,
  state: SecureImportResumeState,
  storage: ResumeStorage = localStorage,
): void {
  try {
    storage.setItem(secureImportResumeStorageKey(firmId), JSON.stringify(state));
  } catch {
    // Resumability is best-effort; import authorization and idempotency stay server-side.
  }
}

export function clearSecureImportResumeState(
  firmId: string,
  storage: ResumeStorage = localStorage,
): void {
  try {
    storage.removeItem(secureImportResumeStorageKey(firmId));
  } catch {
    // Disabled storage must not prevent a securely authorized import.
  }
}

export function isMatchingSecureImportResume(
  state: SecureImportResumeState | null,
  fileHash: string,
  rowCount: number,
): state is SecureImportResumeState {
  return Boolean(state?.batchId && state.fileHash === fileHash && state.rowCount === rowCount);
}

export function secureImportChunk<T>(rows: readonly T[], startIndex: number): T[] {
  return rows.slice(startIndex, startIndex + SECURE_IMPORT_CHUNK_SIZE);
}

export function nextSecureImportResumeIndex(startIndex: number): number {
  return startIndex + SECURE_IMPORT_CHUNK_SIZE;
}
