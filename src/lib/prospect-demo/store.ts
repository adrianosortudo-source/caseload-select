import { ProspectDemoPackageError, validateProfile } from "./package";
import type { ProspectDemoAsset, ProspectDemoProfile } from "./types";
import { upgradeWalkerLawProspectDemoProfile } from "@/lib/prospect-demo-profiles/walker-law";

const DATABASE = "caseload-select-prospect-demos";
const VERSION = 1;
const PROFILES = "profiles";
const ASSETS = "assets";

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, VERSION);
    request.onerror = () => reject(request.error ?? new Error("Could not open browser demo storage."));
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PROFILES)) db.createObjectStore(PROFILES, { keyPath: "id" });
      if (!db.objectStoreNames.contains(ASSETS)) db.createObjectStore(ASSETS, { keyPath: "assetId" });
    };
    request.onsuccess = () => resolve(request.result);
  });
}

function completed(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Browser demo storage could not save the profile."));
    transaction.onabort = () => reject(transaction.error ?? new Error("Browser demo storage aborted the update."));
  });
}

function value<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Browser demo storage could not read the profile."));
  });
}

export async function listProspectDemoProfiles(): Promise<ProspectDemoProfile[]> {
  const db = await database();
  try {
    const transaction = db.transaction(PROFILES, "readonly");
    const records = await value(transaction.objectStore(PROFILES).getAll());
    await completed(transaction);
    return records.map(validateProfile).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  } finally {
    db.close();
  }
}

export async function readProspectDemoAsset(assetId: string): Promise<ProspectDemoAsset | null> {
  const db = await database();
  try {
    const transaction = db.transaction(ASSETS, "readonly");
    const stored = await value(transaction.objectStore(ASSETS).get(assetId) as IDBRequest<ProspectDemoAsset | undefined>);
    await completed(transaction);
    return stored ?? null;
  } finally {
    db.close();
  }
}

/** Profile and screenshot are stored atomically. The caller already validates imported files. */
export async function saveProspectDemoProfile(profile: ProspectDemoProfile, asset: ProspectDemoAsset): Promise<void> {
  const safeProfile = validateProfile(profile);
  if (safeProfile.screenshot.assetId !== asset.assetId) throw new Error("Profile screenshot and selected asset do not match.");
  const db = await database();
  try {
    const transaction = db.transaction([PROFILES, ASSETS], "readwrite");
    transaction.objectStore(PROFILES).put(safeProfile);
    transaction.objectStore(ASSETS).put(asset);
    await completed(transaction);
  } finally {
    db.close();
  }
}

/**
 * Seeds a built-in config only when the browser has no profile with that id.
 * It deliberately does not overwrite a presenter’s local adjustments.
 */
export async function ensureProspectDemoProfile(profile: ProspectDemoProfile, asset: ProspectDemoAsset): Promise<void> {
  const existing = await readProspectDemoProfile(profile.id);
  if (!existing) {
    await saveProspectDemoProfile(profile, asset);
    return;
  }
  const upgraded = upgradeWalkerLawProspectDemoProfile(existing);
  if (upgraded !== existing) await saveProspectDemoProfile(upgraded, asset);
}

export async function readProspectDemoProfile(id: string): Promise<ProspectDemoProfile | null> {
  const db = await database();
  try {
    const transaction = db.transaction(PROFILES, "readonly");
    const stored = await value(transaction.objectStore(PROFILES).get(id) as IDBRequest<unknown>);
    await completed(transaction);
    return stored ? validateProfile(stored) : null;
  } finally {
    db.close();
  }
}

export async function deleteProspectDemoProfile(id: string): Promise<void> {
  const profile = await readProspectDemoProfile(id);
  if (!profile) return;
  const db = await database();
  try {
    const transaction = db.transaction([PROFILES, ASSETS], "readwrite");
    transaction.objectStore(PROFILES).delete(id);
    transaction.objectStore(ASSETS).delete(profile.screenshot.assetId);
    await completed(transaction);
  } finally {
    db.close();
  }
}

export function isProspectDemoStorageError(error: unknown): error is ProspectDemoPackageError {
  return error instanceof ProspectDemoPackageError;
}
