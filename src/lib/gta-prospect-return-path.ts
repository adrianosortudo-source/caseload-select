const LIST_PATH = "/admin/prospects";
const MAX_RETURN_LENGTH = 8192;

/** Only the bounded local Admin list URL can be a firm-profile return target. */
export function validatedProspectListReturnPath(value: unknown): string {
  if (typeof value !== "string" || value.length > MAX_RETURN_LENGTH ||
      /[\\\u0000-\u0020\u007f]/.test(value) || !/^\/admin\/prospects(?:[?#]|$)/.test(value)) return LIST_PATH;
  try {
    const url = new URL(value,"https://admin-return.invalid");
    if (url.origin !== "https://admin-return.invalid" || url.pathname !== LIST_PATH) return LIST_PATH;
    return url.pathname + url.search + url.hash;
  } catch { return LIST_PATH; }
}

export function prospectListReturnPath(search: string, hash: string): string {
  return validatedProspectListReturnPath(LIST_PATH + search + hash);
}

export function prospectFirmResearchHref(firmId: string, returnTo?: string): string {
  const target = `/admin/prospects/firms/${encodeURIComponent(firmId)}`;
  const safe = validatedProspectListReturnPath(returnTo);
  return safe === LIST_PATH ? target : `${target}?${new URLSearchParams({returnTo:safe})}`;
}
