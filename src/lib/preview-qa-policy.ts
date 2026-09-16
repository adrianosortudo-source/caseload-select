/**
 * Narrow, environment-independent policy for the preview QA principal.
 *
 * This module deliberately has no Node-only imports so middleware can enforce
 * its unsafe-method boundary at the edge before route handlers run.
 */

export const PREVIEW_QA_COOKIE_NAME = "preview_qa_session";

const PREVIEW_QA_READ_PATHS = new Set([
  "/admin/prospects",
  "/admin/prospects/agent-drafts",
  "/admin/prospects/reconciled",
  "/admin/prospects/research-import",
  "/admin/prospects/view",
  "/api/admin/prospect-operations/conversations/source",
  "/api/admin/prospect-operations/sources",
]);

const UUID_PATH_SEGMENT = "[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const SOURCE_RECORD_KEY_SEGMENT = "[a-z0-9][a-z0-9-]{1,159}";
const PREVIEW_QA_AGENT_DRAFT_MANIFEST_PATH = new RegExp(`^/admin/prospects/agent-drafts/${UUID_PATH_SEGMENT}/review$`, "i");
const PREVIEW_QA_AGENT_DRAFT_RECORD_PATH = new RegExp(`^/admin/prospects/agent-drafts/${UUID_PATH_SEGMENT}/records/${SOURCE_RECORD_KEY_SEGMENT}$`, "i");

/**
 * The QA principal needs the Next runtime and presentational assets to render
 * an allowlisted page.  These are the only non-application paths it may
 * request, and only with safe methods.  Deliberately do not treat a generic
 * file extension as static: an application route can end in one.
 */
export function isPreviewQaStaticAssetPath(pathname: string): boolean {
  return pathname === "/favicon.ico"
    || pathname.startsWith("/_next/static/")
    || pathname === "/_next/image";
}

export const PREVIEW_QA_BOOTSTRAP_PATH = "/api/operator/preview-qa-session";

export function isPreviewQaReadMethod(method: string): boolean {
  return method === "GET" || method === "HEAD";
}

export function isPreviewQaReadPath(pathname: string): boolean {
  return PREVIEW_QA_READ_PATHS.has(pathname)
    || PREVIEW_QA_AGENT_DRAFT_MANIFEST_PATH.test(pathname)
    || PREVIEW_QA_AGENT_DRAFT_RECORD_PATH.test(pathname);
}

export function isPreviewQaReadRequest(pathname: string, method: string): boolean {
  return isPreviewQaReadMethod(method)
    && (isPreviewQaReadPath(pathname) || isPreviewQaStaticAssetPath(pathname));
}

export function isPreviewQaBootstrapRequest(pathname: string, method: string): boolean {
  return pathname === PREVIEW_QA_BOOTSTRAP_PATH && method === "POST";
}
