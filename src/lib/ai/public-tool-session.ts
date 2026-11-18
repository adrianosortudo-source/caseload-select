export const PUBLIC_PILOT_COOKIE = "caseload_public_pilot";
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

export function publicPilotSession(headers?: Pick<Headers, "get">): string | undefined {
  const entry = headers?.get("cookie")?.split(";").map(part => part.trim()).find(part => part.startsWith(PUBLIC_PILOT_COOKIE + "="));
  const value = entry?.slice(PUBLIC_PILOT_COOKIE.length + 1);
  return value && uuid.test(value) ? value : undefined;
}

export function isPublicPilotEntry(path: string): boolean {
  switch (path.replace(/\/$/, "")) {
    case "/tools/why-your-firm":
      return process.env.WHY_YOUR_FIRM_ASSIST_PROVIDER === "openai" && /^[1-9]\d?$/.test(process.env.WHY_YOUR_FIRM_ASSIST_OPENAI_PERCENT ?? "");
    case "/tools/desired-client-matter":
    case "/tools/best-cases-profile":
      return process.env.DESIRED_CLIENT_PROVIDER === "openai" && /^[1-9]\d?$/.test(process.env.DESIRED_CLIENT_OPENAI_PERCENT ?? "");
    case "/api/screen-demo/extract":
      return process.env.SCREEN_DEMO_AI_PROVIDER === "openai" && /^[1-9]\d?$/.test(process.env.SCREEN_DEMO_AI_OPENAI_PERCENT ?? "");
    default:
      return false;
  }
}
