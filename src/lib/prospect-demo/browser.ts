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

function supportedImageType(type: string): type is ProspectDemoAsset["mimeType"] {
  return IMAGE_TYPES.has(type);
}

function bytesStartWith(bytes: Uint8Array, expected: number[]): boolean {
  return expected.every((value, index) => bytes[index] === value);
}

async function verifyImageSignature(blob: Blob): Promise<void> {
  const bytes = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
  const valid = blob.type === "image/png"
    ? bytesStartWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    : blob.type === "image/jpeg"
      ? bytesStartWith(bytes, [0xff, 0xd8, 0xff])
      : blob.type === "image/webp"
        ? bytesStartWith(bytes, [0x52, 0x49, 0x46, 0x46])
          && bytesStartWith(bytes.slice(8), [0x57, 0x45, 0x42, 0x50])
        : false;
  if (!valid) throw new ProspectDemoPackageError("The screenshot file does not match its declared image type.");
}

/**
 * CSP permits data: images but does not permit blob: images on the presenter
 * route. Keep blobs in IndexedDB and derive an in-memory data URL only for
 * rendering or decoding.
 */
export async function screenshotDataUrl(blob: Blob): Promise<string> {
  if (!supportedImageType(blob.type)) throw new ProspectDemoPackageError("Choose a PNG, JPEG, or WebP screenshot.");
  if (blob.size === 0 || blob.size > MAX_SCREENSHOT_BYTES) {
    throw new ProspectDemoPackageError("The screenshot must be between 1 byte and 10 MB.");
  }
  await verifyImageSignature(blob);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new ProspectDemoPackageError("The screenshot could not be read."));
    reader.onload = () => {
      if (typeof reader.result !== "string" || !reader.result.startsWith(`data:${blob.type};base64,`)) {
        reject(new ProspectDemoPackageError("The screenshot could not be read."));
        return;
      }
      resolve(reader.result);
    };
    reader.readAsDataURL(blob);
  });
}

async function decodedImageDimensions(blob: Blob): Promise<{ width: number; height: number }> {
  const source = await screenshotDataUrl(blob);
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new ProspectDemoPackageError("The screenshot could not be decoded as an image."));
    image.src = source;
  });
}

export async function assetFromImageBlob(blob: Blob, assetId = newProspectDemoId("screenshot")): Promise<ProspectDemoAsset> {
  if (!supportedImageType(blob.type)) throw new ProspectDemoPackageError("Choose a PNG, JPEG, or WebP screenshot.");
  if (blob.size === 0 || blob.size > MAX_SCREENSHOT_BYTES) throw new ProspectDemoPackageError("The screenshot must be between 1 byte and 10 MB.");
  const dimensions = await decodedImageDimensions(blob);
  if (dimensions.width < 200 || dimensions.height < 200 || dimensions.width > 20000 || dimensions.height > 20000) {
    throw new ProspectDemoPackageError("The screenshot dimensions must be between 200 and 20,000 pixels.");
  }
  return { assetId, blob, width: dimensions.width, height: dimensions.height, mimeType: blob.type as ProspectDemoAsset["mimeType"] };
}

export function newProspectDemoId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

export async function assetFromImageFile(file: File, assetId = newProspectDemoId("screenshot")): Promise<ProspectDemoAsset> {
  return assetFromImageBlob(file, assetId);
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
  const packageAsset = assetFromPackage(packageValue);
  const asset = await assetFromImageBlob(packageAsset.blob, packageAsset.assetId);
  if (asset.width !== packageValue.screenshot.width || asset.height !== packageValue.screenshot.height) {
    throw new ProspectDemoPackageError("The imported screenshot dimensions do not match its package metadata.");
  }
  return { profile: packageValue.profile, asset };
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
