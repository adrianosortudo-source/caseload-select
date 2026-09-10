import {
  PROSPECT_DEMO_FORMAT_VERSION,
  type ProspectDemoAsset,
  type ProspectDemoPackage,
  type ProspectDemoProfile,
  type ProspectDemoScenario,
  type ProspectDemoView,
  type ScreenshotPlacement,
} from "./types";

export const MAX_SCREENSHOT_BYTES = 10 * 1024 * 1024;
export const MAX_PACKAGE_BYTES = 14 * 1024 * 1024;

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const VIEWS = new Set<ProspectDemoView>(["website", "review", "split"]);
const MODES = new Set(["guided", "live-ai"]);

export class ProspectDemoPackageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProspectDemoPackageError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown, name: string, maximum = 4000): string {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) {
    throw new ProspectDemoPackageError(`${name} must be a non-empty string no longer than ${maximum} characters.`);
  }
  return value.trim();
}

function integer(value: unknown, name: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new ProspectDemoPackageError(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value as number;
}

function unit(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new ProspectDemoPackageError(`${name} must be a number from 0 to 1.`);
  }
  return value;
}

function color(value: unknown, name: string): string {
  const candidate = nonEmptyString(value, name, 32);
  if (!/^#[0-9a-f]{6}$/i.test(candidate)) {
    throw new ProspectDemoPackageError(`${name} must be a six-digit hex colour.`);
  }
  return candidate;
}

function dateString(value: unknown, name: string): string {
  const candidate = nonEmptyString(value, name, 64);
  if (Number.isNaN(Date.parse(candidate))) {
    throw new ProspectDemoPackageError(`${name} must be an ISO-compatible date.`);
  }
  return candidate;
}

function placement(value: unknown): ScreenshotPlacement {
  if (!isRecord(value)) throw new ProspectDemoPackageError("placement must be an object.");
  const parsed = {
    x: unit(value.x, "placement.x"),
    y: unit(value.y, "placement.y"),
    width: unit(value.width, "placement.width"),
    height: unit(value.height, "placement.height"),
  };
  if (parsed.width === 0 || parsed.height === 0 || parsed.x + parsed.width > 1 || parsed.y + parsed.height > 1) {
    throw new ProspectDemoPackageError("placement must fit inside the screenshot and have a visible size.");
  }
  return parsed;
}

function scenarios(value: unknown): ProspectDemoScenario[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 12) {
    throw new ProspectDemoPackageError("scenarios must contain between 1 and 12 items.");
  }
  const seen = new Set<string>();
  return value.map((item, index) => {
    if (!isRecord(item)) throw new ProspectDemoPackageError(`scenarios[${index}] must be an object.`);
    const scenario = {
      id: nonEmptyString(item.id, `scenarios[${index}].id`, 80),
      label: nonEmptyString(item.label, `scenarios[${index}].label`, 120),
      description: nonEmptyString(item.description, `scenarios[${index}].description`, 6000),
    };
    if (seen.has(scenario.id)) throw new ProspectDemoPackageError("Each scenario needs a distinct id.");
    seen.add(scenario.id);
    return scenario;
  });
}

export function validateProfile(value: unknown): ProspectDemoProfile {
  if (!isRecord(value)) throw new ProspectDemoPackageError("profile must be an object.");
  if (value.formatVersion !== PROSPECT_DEMO_FORMAT_VERSION) {
    throw new ProspectDemoPackageError("This profile uses an unsupported format version.");
  }
  if (!isRecord(value.reference) || !isRecord(value.screenshot) || !isRecord(value.theme)) {
    throw new ProspectDemoPackageError("profile.reference, profile.screenshot, and profile.theme are required objects.");
  }
  const mimeType = nonEmptyString(value.screenshot.mimeType, "screenshot.mimeType", 30);
  if (!IMAGE_TYPES.has(mimeType)) throw new ProspectDemoPackageError("Only PNG, JPEG, and WebP screenshots are supported.");
  const defaultView = nonEmptyString(value.defaultView, "defaultView", 20) as ProspectDemoView;
  if (!VIEWS.has(defaultView)) throw new ProspectDemoPackageError("defaultView is invalid.");
  const defaultMode = nonEmptyString(value.defaultMode, "defaultMode", 20);
  if (!MODES.has(defaultMode)) throw new ProspectDemoPackageError("defaultMode is invalid.");

  return {
    formatVersion: PROSPECT_DEMO_FORMAT_VERSION,
    id: nonEmptyString(value.id, "id", 120),
    slug: nonEmptyString(value.slug, "slug", 120),
    revision: integer(value.revision, "revision", 1, 100000),
    createdAt: dateString(value.createdAt, "createdAt"),
    updatedAt: dateString(value.updatedAt, "updatedAt"),
    firmName: nonEmptyString(value.firmName, "firmName", 200),
    websiteTitle: nonEmptyString(value.websiteTitle, "websiteTitle", 200),
    reference: {
      url: nonEmptyString(value.reference.url, "reference.url", 2000),
      capturedAt: dateString(value.reference.capturedAt, "reference.capturedAt"),
      ...(typeof value.reference.notes === "string" && value.reference.notes.trim()
        ? { notes: value.reference.notes.trim().slice(0, 1000) }
        : {}),
    },
    screenshot: {
      assetId: nonEmptyString(value.screenshot.assetId, "screenshot.assetId", 120),
      width: integer(value.screenshot.width, "screenshot.width", 1, 20000),
      height: integer(value.screenshot.height, "screenshot.height", 1, 20000),
      mimeType: mimeType as ProspectDemoProfile["screenshot"]["mimeType"],
    },
    placement: placement(value.placement),
    theme: {
      accent: color(value.theme.accent, "theme.accent"),
      surface: color(value.theme.surface, "theme.surface"),
      text: color(value.theme.text, "theme.text"),
      buttonText: color(value.theme.buttonText, "theme.buttonText"),
    },
    scenarios: scenarios(value.scenarios),
    defaultView,
    defaultMode: defaultMode as ProspectDemoProfile["defaultMode"],
  };
}

function decodeBase64(data: string): Uint8Array {
  if (!/^[a-z0-9+/]*={0,2}$/i.test(data) || data.length % 4 !== 0) {
    throw new ProspectDemoPackageError("Screenshot data is not valid base64.");
  }
  const decoded = atob(data);
  const bytes = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index += 1) bytes[index] = decoded.charCodeAt(index);
  return bytes;
}

export function validatePackage(value: unknown): ProspectDemoPackage {
  if (!isRecord(value) || value.packageType !== "caseload-select.prospect-demo" || value.packageVersion !== 1) {
    throw new ProspectDemoPackageError("This is not a CaseLoad Select prospect-demo package.");
  }
  if (!isRecord(value.screenshot)) throw new ProspectDemoPackageError("Package screenshot is required.");
  const profile = validateProfile(value.profile);
  const screenshot = value.screenshot;
  const assetId = nonEmptyString(screenshot.assetId, "screenshot.assetId", 120);
  const mimeType = nonEmptyString(screenshot.mimeType, "screenshot.mimeType", 30);
  if (!IMAGE_TYPES.has(mimeType)) throw new ProspectDemoPackageError("Only PNG, JPEG, and WebP screenshots are supported.");
  const width = integer(screenshot.width, "screenshot.width", 1, 20000);
  const height = integer(screenshot.height, "screenshot.height", 1, 20000);
  const dataBase64 = nonEmptyString(screenshot.dataBase64, "screenshot.dataBase64", Math.ceil(MAX_SCREENSHOT_BYTES * 1.37));
  const bytes = decodeBase64(dataBase64);
  if (bytes.byteLength > MAX_SCREENSHOT_BYTES) throw new ProspectDemoPackageError("The screenshot exceeds the 10 MB limit.");
  if (assetId !== profile.screenshot.assetId || mimeType !== profile.screenshot.mimeType || width !== profile.screenshot.width || height !== profile.screenshot.height) {
    throw new ProspectDemoPackageError("Package screenshot metadata does not match the profile.");
  }
  return {
    packageType: "caseload-select.prospect-demo",
    packageVersion: 1,
    exportedAt: dateString(value.exportedAt, "exportedAt"),
    profile,
    screenshot: { assetId, mimeType: mimeType as ProspectDemoPackage["screenshot"]["mimeType"], width, height, dataBase64 },
  };
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

export async function packageForExport(profile: ProspectDemoProfile, asset: ProspectDemoAsset): Promise<ProspectDemoPackage> {
  if (asset.blob.size > MAX_SCREENSHOT_BYTES) throw new ProspectDemoPackageError("The screenshot exceeds the 10 MB limit.");
  if (asset.assetId !== profile.screenshot.assetId) throw new ProspectDemoPackageError("The selected screenshot does not belong to this profile.");
  const bytes = new Uint8Array(await asset.blob.arrayBuffer());
  return {
    packageType: "caseload-select.prospect-demo",
    packageVersion: 1,
    exportedAt: new Date().toISOString(),
    profile: validateProfile(profile),
    screenshot: {
      assetId: asset.assetId,
      mimeType: asset.mimeType,
      width: asset.width,
      height: asset.height,
      dataBase64: encodeBase64(bytes),
    },
  };
}

export function assetFromPackage(value: ProspectDemoPackage): ProspectDemoAsset {
  const bytes = decodeBase64(value.screenshot.dataBase64);
  return {
    assetId: value.screenshot.assetId,
    blob: new Blob([bytes], { type: value.screenshot.mimeType }),
    width: value.screenshot.width,
    height: value.screenshot.height,
    mimeType: value.screenshot.mimeType,
  };
}
