import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";

export const OPERATOR_WORKSPACE_COOKIE = "operator_workspace";

interface WorkspacePayload {
  operator_id: string;
  firm_id: string;
  exp: number;
}

function key(): string {
  const value = process.env.PORTAL_SECRET ?? process.env.CRON_SECRET;
  if (!value) throw new Error("PORTAL_SECRET not set");
  return value;
}

function sign(payload: string): string {
  return createHmac("sha256", key()).update(payload).digest("base64url");
}

export function makeOperatorWorkspaceCookie(input: {
  operatorId: string;
  firmId: string;
  ttlSeconds?: number;
}) {
  const payload = Buffer.from(JSON.stringify({
    operator_id: input.operatorId,
    firm_id: input.firmId,
    exp: Date.now() + (input.ttlSeconds ?? 4 * 60 * 60) * 1000,
  })).toString("base64url");
  return {
    name: OPERATOR_WORKSPACE_COOKIE,
    value: `${payload}.${sign(payload)}`,
    options: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax" as const,
      path: "/",
      maxAge: input.ttlSeconds ?? 4 * 60 * 60,
    },
  };
}

export function clearOperatorWorkspaceCookie() {
  return {
    name: OPERATOR_WORKSPACE_COOKIE,
    value: "",
    options: { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/", maxAge: 0 },
  };
}

export function verifyOperatorWorkspaceValue(raw: string | null | undefined): WorkspacePayload | null {
  if (!raw) return null;
  const dot = raw.lastIndexOf(".");
  if (dot < 1) return null;
  const payload = raw.slice(0, dot);
  const signature = raw.slice(dot + 1);
  const expected = sign(payload);
  if (expected.length !== signature.length) return null;
  try {
    if (!timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) return null;
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<WorkspacePayload>;
    if (!data.operator_id || !data.firm_id || typeof data.exp !== "number" || Date.now() > data.exp) return null;
    return { operator_id: data.operator_id, firm_id: data.firm_id, exp: data.exp };
  } catch {
    return null;
  }
}

export async function getOperatorWorkspace(firmId?: string) {
  try {
    const store = await cookies();
    const workspace = verifyOperatorWorkspaceValue(store.get(OPERATOR_WORKSPACE_COOKIE)?.value);
    return workspace && (!firmId || workspace.firm_id === firmId) ? workspace : null;
  } catch {
    return null;
  }
}

export function isSafeWorkspaceDestination(value: string | null, firmId: string): boolean {
  if (!value || !value.startsWith(`/portal/${firmId}`)) return false;
  if (value.startsWith("//") || value.includes("\\") || value.includes("://")) return false;
  return value === `/portal/${firmId}` || value.startsWith(`/portal/${firmId}/`);
}
