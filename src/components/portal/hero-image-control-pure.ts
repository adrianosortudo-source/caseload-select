export const HERO_UPLOAD_ACCEPT = ".png,.jpg,.jpeg,.webp";
export const HERO_UPLOAD_HELPER_TEXT = "PNG, JPG, JPEG, or WebP \u00b7 max 10 MB";

export type HeroImageViewerRole = "operator" | "lawyer" | "client";

export function shouldShowHeroImageControl(
  selectedVersionId: string | null,
  viewerRole: HeroImageViewerRole,
): boolean {
  return Boolean(selectedVersionId) && viewerRole === "operator";
}

const ALLOWED_MIME_BY_EXTENSION: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

export function isAllowedHeroFile(file: Pick<File, "name" | "type">): boolean {
  const extension = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
  return ALLOWED_MIME_BY_EXTENSION[extension] === file.type;
}

export function heroUploadPath(firmId: string, deliverableId: string): string {
  return `/api/portal/${encodeURIComponent(firmId)}/deliverables/${encodeURIComponent(deliverableId)}/hero`;
}

export async function readHeroUploadError(response: Response): Promise<string> {
  try {
    const json = (await response.json()) as { error?: unknown };
    if (typeof json.error === "string" && json.error) return json.error;
  } catch {
    // Use a stable fallback when the server did not return JSON.
  }
  return "Could not save hero image.";
}
