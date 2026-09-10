import {
  MAX_PACKAGE_BYTES,
  MAX_SCREENSHOT_BYTES,
  ProspectDemoPackageError,
  assetFromPackage,
  packageForExport,
  validatePackage,
} from "./package";
import type { ProspectDemoAsset, ProspectDemoProfile } from "./types";

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export function newProspectDemoId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

export async function assetFromImageFile(file: File, assetId = newProspectDemoId("screenshot")): Promise<ProspectDemoAsset> {
  if (!IMAGE_TYPES.has(file.type)) throw new ProspectDemoPackageError("Choose a PNG, JPEG, or WebP screenshot.");
  if (file.size === 0 || file.size > MAX_SCREENSHOT_BYTES) throw new ProspectDemoPackageError("The screenshot must be between 1 byte and 10 MB.");
  const url = URL.createObjectURL(file);
  try {
    const dimensions = await new Promise<{ width: number; height: number }>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
      image.onerror = () => reject(new ProspectDemoPackageError("The screenshot could not be read as an image."));
      image.src = url;
    });
    if (dimensions.width < 200 || dimensions.height < 200 || dimensions.width > 20000 || dimensions.height > 20000) {
      throw new ProspectDemoPackageError("The screenshot dimensions must be between 200 and 20,000 pixels.");
    }
    return { assetId, blob: file, width: dimensions.width, height: dimensions.height, mimeType: file.type as ProspectDemoAsset["mimeType"] };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function exportPackageFile(profile: ProspectDemoProfile, asset: ProspectDemoAsset): Promise<File> {
  const content = await packageForExport(profile, asset);
  return new File([JSON.stringify(content)], `${profile.slug}-prospect-demo.json`, { type: "application/json" });
}

export async function importPackageFile(file: File): Promise<{ profile: ProspectDemoProfile; asset: ProspectDemoAsset }> {
  if (file.size === 0 || file.size > MAX_PACKAGE_BYTES) throw new ProspectDemoPackageError("The demo package must be smaller than 14 MB.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    throw new ProspectDemoPackageError("The selected file is not valid JSON.");
  }
  const packageValue = validatePackage(parsed);
  return { profile: packageValue.profile, asset: assetFromPackage(packageValue) };
}

export function downloadFile(file: File): void {
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
