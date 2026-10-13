import { agencyFollowupContentHash, type AgencyFollowupMessageContent } from "./agency-followup-domain";

export interface AgencyFollowupSchedulePolicy {
  timezone: string;
  businessDays: number[];
  localWindowStart: string;
  localWindowEnd: string;
  minimumSpacingHours: number;
}

export interface AgencyFollowupStepDraft {
  templateVersionId: string;
  delayBusinessDays: number;
}

export function validateAgencyFollowupSchedulePolicy(policy: AgencyFollowupSchedulePolicy): void {
  if (!policy.timezone.trim()) throw new Error("Choose a timezone.");
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: policy.timezone }).format(new Date(0));
  } catch {
    throw new Error("Choose a valid IANA timezone.");
  }
  if (!Array.isArray(policy.businessDays) || policy.businessDays.length === 0 ||
    policy.businessDays.some((day) => !Number.isInteger(day) || day < 1 || day > 7) ||
    new Set(policy.businessDays).size !== policy.businessDays.length) {
    throw new Error("Choose one or more unique business days from Monday to Sunday.");
  }
  const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
  if (!timePattern.test(policy.localWindowStart) || !timePattern.test(policy.localWindowEnd) ||
    policy.localWindowEnd <= policy.localWindowStart) {
    throw new Error("The local send window must be a valid increasing HH:mm range.");
  }
  if (!Number.isInteger(policy.minimumSpacingHours) || policy.minimumSpacingHours < 0 || policy.minimumSpacingHours > 8760) {
    throw new Error("Minimum spacing must be between zero and 8760 hours.");
  }
}

export function validateAgencyFollowupStepDrafts(steps: AgencyFollowupStepDraft[]): void {
  if (steps.length < 1 || steps.length > 100) throw new Error("A journey needs between one and 100 steps.");
  for (const step of steps) {
    if (!step.templateVersionId.trim()) throw new Error("Every step needs a template version.");
    if (!Number.isInteger(step.delayBusinessDays) || step.delayBusinessDays < 0 || step.delayBusinessDays > 3650) {
      throw new Error("Step delays must be whole business days from zero to 3650.");
    }
  }
}

export function createAgencyFollowupContentSnapshot(subject: string, body: string): {
  content: AgencyFollowupMessageContent;
  contentSha256: string;
} {
  const content = { channel: "email" as const, subject: subject.trim(), body: body.trim() };
  if (!content.subject || content.subject.length > 1000) throw new Error("Template subject is required and must be at most 1000 characters.");
  if (!content.body || content.body.length > 20_000) throw new Error("Template body is required and must be at most 20000 characters.");
  return { content, contentSha256: agencyFollowupContentHash(content) };
}

export function nextAgencyFollowupVersion(versions: number[]): number {
  return Math.max(0, ...versions) + 1;
}
