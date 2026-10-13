import "server-only";
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { scheduleAgencyFollowupStep } from "@/lib/agency-followup-schedule";
import {
  createAgencyFollowupContentSnapshot,
  nextAgencyFollowupVersion,
  validateAgencyFollowupSchedulePolicy,
  validateAgencyFollowupStepDrafts,
  type AgencyFollowupSchedulePolicy,
  type AgencyFollowupStepDraft,
} from "@/lib/agency-followup-authoring";
import { FakeAgencyFollowupProvider } from "@/lib/agency-followup-provider";
import {
  dispatchAgencyFollowupBatch,
  type AgencyFollowupClaim,
  type AgencyFollowupWorkerDisposition,
} from "@/lib/agency-followup-worker";
import {
  agencyFollowupContentHash,
  agencyFollowupLogicalMessageKey,
  agencyFollowupRecipientHash,
  evaluateAgencyFollowupSend,
  type AgencyContactability,
  type AgencyConversationStatus,
  type AgencyFollowupMessageContent,
  type AgencyFollowupRecipientSnapshot,
  type AgencyFollowupSendContext,
} from "@/lib/agency-followup-domain";

const supabase = supabaseAdmin;

// Supabase projections are validated and narrowed at the service boundaries below.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbRow = Record<string, any>;

export interface AgencyFollowupQueueItem {
  id: string;
  enrollmentId: string;
  prospectId: string;
  firmName: string;
  prospectStage: string;
  journeyName: string;
  stepNumber: number;
  state: string;
  eligibility: string;
  contactability: AgencyContactability;
  conversationStatus: AgencyConversationStatus;
  recipientEmail: string;
  subject: string;
  body: string;
  scheduledAt: string | null;
  blockers: string[];
  sequenceReleased: boolean;
}

export interface AgencyFollowupConsoleData {
  journeys: Array<{
    id: string; name: string; journeyKey: string; version: number; state: string;
    timezone: string; businessDays: number[]; localWindowStart: string; localWindowEnd: string;
    minimumSpacingHours: number; stepCount: number;
  }>;
  templates: Array<{ id: string; templateKey: string; version: number; state: string; subject: string; body: string }>;
  items: AgencyFollowupQueueItem[];
}

function assertResult<T>(result: { data: T | null; error: { message: string } | null }, label: string): T {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  if (result.data === null) throw new Error(`${label}: no result`);
  return result.data;
}

function toContent(value: unknown): AgencyFollowupMessageContent {
  const row = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    channel: "email",
    subject: typeof row.subject === "string" ? row.subject : "",
    body: typeof row.body === "string" ? row.body : "",
  };
}

function toRecipient(prospect: DbRow, enrollment: DbRow): AgencyFollowupRecipientSnapshot {
  return {
    prospectId: String(prospect.id ?? enrollment.prospect_id ?? ""),
    firmName: String(prospect.firm_name ?? ""),
    contactName: typeof prospect.contact_name === "string" ? prospect.contact_name : null,
    contactEmail: typeof prospect.contact_email === "string" ? prospect.contact_email : "",
  };
}

async function loadOperationsState(prospectId: string): Promise<{
  contactability: AgencyContactability;
  conversationStatus: AgencyConversationStatus;
  hasExactSource: boolean;
}> {
  const sourcesResult = await supabase
    .from("prospect_source_links")
    .select("id")
    .in("source_system", ["agency_crm", "agency_crm_contact"])
    .eq("source_record_key", prospectId);
  const sourceRows = assertResult(sourcesResult, "Unable to verify Agency CRM source history") as DbRow[];
  if (sourceRows.length === 0) {
    return { contactability: "unknown", conversationStatus: "not_contacted", hasExactSource: false };
  }

  const sourceIds = sourceRows.map((row) => String(row.id));
  const associationsResult = await supabase
    .from("prospect_conversation_sources")
    .select("conversation_id")
    .in("source_link_id", sourceIds);
  const associations = assertResult(associationsResult, "Unable to read Agency CRM conversation links") as DbRow[];
  const conversationIds = [...new Set(associations.map((row) => String(row.conversation_id)))];
  if (conversationIds.length === 0) {
    return { contactability: "unknown", conversationStatus: "not_contacted", hasExactSource: false };
  }

  const [conversationsResult, contactabilityResult, activitiesResult] = await Promise.all([
    supabase.from("prospect_conversations").select("id,status").in("id", conversationIds),
    supabase.from("prospect_contactability").select("conversation_id,state").in("conversation_id", conversationIds),
    supabase.from("prospect_activities").select("conversation_id,kind").in("conversation_id", conversationIds)
      .in("kind", ["human_reply", "meeting", "bounce"]),
  ]);
  const conversations = assertResult(conversationsResult, "Unable to read prospect conversation state") as DbRow[];
  const contactRows = assertResult(contactabilityResult, "Unable to read prospect contactability") as DbRow[];
  const activityRows = assertResult(activitiesResult, "Unable to read prospect activity stops") as DbRow[];

  const states = contactRows.map((row) => String(row.state));
  const contactability: AgencyContactability = states.some((state) => state === "suppressed")
    ? "hold"
    : states.length === conversationIds.length && states.every((state) => state === "eligible")
      ? "allowed"
      : "unknown";

  const statusRank: Record<string, number> = {
    not_contacted: 0,
    awaiting_reply: 1,
    unreachable: 2,
    replied: 3,
    declined: 4,
    meeting_scheduled: 5,
    completed: 6,
  };
  let conversationStatus = conversations
    .map((row) => String(row.status))
    .sort((left, right) => (statusRank[right] ?? 0) - (statusRank[left] ?? 0))[0] as AgencyConversationStatus | undefined;

  if (activityRows.some((row) => row.kind === "human_reply")) conversationStatus = "replied";
  else if (activityRows.some((row) => row.kind === "meeting")) conversationStatus = "meeting_scheduled";
  else if (activityRows.some((row) => row.kind === "bounce")) conversationStatus = "unreachable";

  return {
    contactability,
    conversationStatus: conversationStatus ?? "not_contacted",
    hasExactSource: true,
  };
}

async function loadCurrentRecords(enrollmentId: string, messageId?: string) {
  const enrollmentResult = await supabase.from("agency_followup_enrollments").select("*").eq("id", enrollmentId).maybeSingle();
  if (enrollmentResult.error) throw new Error(enrollmentResult.error.message);
  if (!enrollmentResult.data) throw new Error("Follow-up enrollment was not found.");
  const enrollment = enrollmentResult.data as DbRow;

  const [prospectResult, journeyResult, messageResult, messagesResult] = await Promise.all([
    supabase.from("agency_prospects").select("*").eq("id", enrollment.prospect_id).maybeSingle(),
    supabase.from("agency_followup_journeys").select("*").eq("id", enrollment.journey_id).maybeSingle(),
    messageId
      ? supabase.from("agency_followup_messages").select("*").eq("id", messageId).eq("enrollment_id", enrollmentId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    supabase.from("agency_followup_messages").select("*").eq("enrollment_id", enrollmentId).order("step_number"),
  ]);
  if (prospectResult.error) throw new Error(prospectResult.error.message);
  if (!prospectResult.data) throw new Error("Agency prospect was not found.");
  if (journeyResult.error) throw new Error(journeyResult.error.message);
  if (!journeyResult.data) throw new Error("Follow-up journey was not found.");
  if (messageResult.error) throw new Error(messageResult.error.message);
  if (messageId && !messageResult.data) throw new Error("Follow-up message was not found.");
  const messages = assertResult(messagesResult, "Unable to read enrollment messages") as DbRow[];
  return {
    enrollment,
    prospect: prospectResult.data as DbRow,
    journey: journeyResult.data as DbRow,
    message: (messageResult.data as DbRow | null) ?? null,
    messages,
  };
}

function makeSendContext(
  enrollment: DbRow,
  prospect: DbRow,
  journey: DbRow,
  message: DbRow,
  operations: Awaited<ReturnType<typeof loadOperationsState>>,
  previousAcceptedAt: string | null,
): AgencyFollowupSendContext {
  const content = toContent(message.content_snapshot);
  const recipient = toRecipient(prospect, enrollment);
  return {
    prospectId: String(enrollment.prospect_id),
    prospectStage: String(prospect.stage ?? ""),
    recipient,
    contactability: operations.contactability,
    conversationStatus: operations.conversationStatus,
    eligibility: enrollment.eligibility_state,
    eligibilityEvidenceRef: enrollment.eligibility_evidence_ref,
    sequenceReleased: Boolean(enrollment.released_at) && enrollment.state === "active",
    messageApproved: ["approved", "scheduled", "claimed", "accepted"].includes(String(message.state)),
    approval: message.reviewed_by_operator_id && message.reviewed_at
      ? {
          approvedContentHash: String(message.approved_content_sha256 ?? ""),
          approvedRecipientHash: String(message.approved_recipient_sha256 ?? ""),
          reviewerId: String(message.reviewed_by_operator_id),
          reviewedAt: String(message.reviewed_at),
        }
      : null,
    content,
    dueAt: typeof message.scheduled_at === "string" ? message.scheduled_at : "",
    now: new Date().toISOString(),
    previousAcceptedAt,
    minimumSpacingMs: Number(journey.minimum_spacing_hours) * 60 * 60 * 1000,
    schedulePolicy: {
      timezone: String(journey.timezone),
      businessDays: (journey.business_days as number[]).map(Number),
      localWindowStart: String(journey.local_window_start).slice(0, 5),
    },
    cancelled: ["paused", "stopped", "completed", "cancelled"].includes(String(enrollment.state)) ||
      ["cancelled", "blocked", "failed", "unknown"].includes(String(message.state)),
  };
}

async function appendAuditEvent(input: {
  enrollmentId?: string | null;
  journeyId?: string | null;
  templateVersionId?: string | null;
  messageId?: string | null;
  eventType: string;
  idempotencyKey: string;
  payload: Record<string, unknown>;
  actorId?: string | null;
}): Promise<void> {
  const { error } = await supabase.from("agency_followup_events").insert({
    enrollment_id: input.enrollmentId ?? null,
    journey_id: input.journeyId ?? null,
    template_version_id: input.templateVersionId ?? null,
    message_id: input.messageId ?? null,
    event_type: input.eventType,
    idempotency_key: input.idempotencyKey,
    event_payload: input.payload,
    actor_operator_id: input.actorId ?? null,
  });
  if (error && !/duplicate key|unique/i.test(error.message)) throw new Error(`Unable to write follow-up audit event: ${error.message}`);
}

async function assertClearForReview(enrollment: DbRow, prospect: DbRow): Promise<Awaited<ReturnType<typeof loadOperationsState>>> {
  if (enrollment.eligibility_state !== "eligible" || !String(enrollment.eligibility_evidence_ref ?? "").trim()) {
    throw new Error("Record eligibility and its evidence before releasing or approving messages.");
  }
  if (["won", "lost"].includes(String(prospect.stage))) throw new Error("This prospect's current pipeline stage stops follow-up.");
  const operations = await loadOperationsState(String(prospect.id));
  if (!operations.hasExactSource || operations.contactability === "unknown") {
    throw new Error("The prospect has no complete, exact contactability history. Resolve it in Prospect Activity first.");
  }
  if (operations.contactability !== "allowed") throw new Error("Prospect operations currently suppress this contact.");
  if (["replied", "unreachable", "declined", "meeting_scheduled", "completed"].includes(operations.conversationStatus)) {
    throw new Error("A reply, booking, bounce, or completed conversation stops follow-up.");
  }
  return operations;
}

export async function listAgencyFollowupConsole(): Promise<AgencyFollowupConsoleData> {
  const [journeysResult, enrollmentsResult, templatesResult, stepsResult] = await Promise.all([
    supabase.from("agency_followup_journeys").select("*").order("updated_at", { ascending: false }),
    supabase.from("agency_followup_enrollments").select("*").order("updated_at", { ascending: false }).limit(300),
    supabase.from("agency_followup_template_versions").select("id,template_key,version,state,subject,body").order("template_key").order("version", { ascending: false }),
    supabase.from("agency_followup_steps").select("journey_id"),
  ]);
  const journeys = assertResult(journeysResult, "Unable to load follow-up journeys") as DbRow[];
  const enrollments = assertResult(enrollmentsResult, "Unable to load follow-up enrollments") as DbRow[];
  const templates = assertResult(templatesResult, "Unable to load follow-up templates") as DbRow[];
  const steps = assertResult(stepsResult, "Unable to load follow-up journey steps") as DbRow[];
  const stepCountByJourney = new Map<string, number>();
  for (const step of steps) stepCountByJourney.set(String(step.journey_id), (stepCountByJourney.get(String(step.journey_id)) ?? 0) + 1);
  const journeyItems = journeys.map((row) => ({
    id: String(row.id), name: String(row.name), journeyKey: String(row.journey_key), version: Number(row.version), state: String(row.state),
    timezone: String(row.timezone), businessDays: (row.business_days as number[]).map(Number),
    localWindowStart: String(row.local_window_start).slice(0, 5), localWindowEnd: String(row.local_window_end).slice(0, 5),
    minimumSpacingHours: Number(row.minimum_spacing_hours), stepCount: stepCountByJourney.get(String(row.id)) ?? 0,
  }));
  const templateItems = templates.map((row) => ({
    id: String(row.id), templateKey: String(row.template_key), version: Number(row.version), state: String(row.state),
    subject: String(row.subject), body: String(row.body),
  }));
  if (enrollments.length === 0) {
    return { journeys: journeyItems, templates: templateItems, items: [] };
  }

  const enrollmentIds = enrollments.map((row) => String(row.id));
  const prospectIds = [...new Set(enrollments.map((row) => String(row.prospect_id)))];
  const journeyById = new Map(journeys.map((row) => [String(row.id), row]));
  const [messagesResult, prospectsResult] = await Promise.all([
    supabase.from("agency_followup_messages").select("*").in("enrollment_id", enrollmentIds).order("step_number").limit(1000),
    supabase.from("agency_prospects").select("id,firm_name,contact_name,contact_email,stage").in("id", prospectIds),
  ]);
  const messages = assertResult(messagesResult, "Unable to load follow-up messages") as DbRow[];
  const prospects = assertResult(prospectsResult, "Unable to load Agency prospect records") as DbRow[];
  const prospectById = new Map(prospects.map((row) => [String(row.id), row]));
  const enrollmentById = new Map(enrollments.map((row) => [String(row.id), row]));

  const operationsByProspect = new Map<string, Promise<Awaited<ReturnType<typeof loadOperationsState>>>>();
  const messagesByEnrollment = new Map<string, DbRow[]>();
  for (const message of messages) {
    const enrollmentId = String(message.enrollment_id);
    const group = messagesByEnrollment.get(enrollmentId) ?? [];
    group.push(message);
    messagesByEnrollment.set(enrollmentId, group);
  }
  const items = await Promise.all(messages.map(async (message): Promise<AgencyFollowupQueueItem> => {
    const enrollment = enrollmentById.get(String(message.enrollment_id));
    const prospect = enrollment ? prospectById.get(String(enrollment.prospect_id)) : undefined;
    if (!enrollment || !prospect) throw new Error("A follow-up message is missing its exact Agency CRM prospect link.");
    const prospectId = String(prospect.id);
    if (!operationsByProspect.has(prospectId)) operationsByProspect.set(prospectId, loadOperationsState(prospectId));
    const operations = await operationsByProspect.get(prospectId)!;
    const enrollmentMessages = messagesByEnrollment.get(String(enrollment.id)) ?? [];
    const previousAcceptedAt = enrollmentMessages
      .filter((row) => Number(row.step_number) < Number(message.step_number) && row.provider_accepted_at)
      .map((row) => String(row.provider_accepted_at))
      .sort((left, right) => Date.parse(right) - Date.parse(left))[0] ?? null;
    const journey = journeyById.get(String(enrollment.journey_id));
    if (!journey) throw new Error("An enrollment is missing its journey version.");
    const context = makeSendContext(enrollment, prospect, journey, message, operations, previousAcceptedAt);
    const blockers = evaluateAgencyFollowupSend(context);
    if (!operations.hasExactSource && !blockers.includes("contactability_unknown")) blockers.push("contactability_unknown");
    return {
      id: String(message.id),
      enrollmentId: String(enrollment.id),
      prospectId: String(prospect.id),
      firmName: String(prospect.firm_name ?? ""),
      prospectStage: String(prospect.stage ?? ""),
      journeyName: String(journey?.name ?? "Follow-up journey"),
      stepNumber: Number(message.step_number),
      state: String(message.state),
      eligibility: String(enrollment.eligibility_state),
      contactability: operations.contactability,
      conversationStatus: operations.conversationStatus,
      recipientEmail: String(prospect.contact_email ?? ""),
      subject: context.content.subject,
      body: context.content.body,
      scheduledAt: typeof message.scheduled_at === "string" ? message.scheduled_at : null,
      blockers: [...new Set(blockers)],
      sequenceReleased: Boolean(enrollment.released_at),
    };
  }));
  return {
    journeys: journeyItems,
    templates: templateItems,
    items,
  };
}

export async function createAgencyFollowupTemplateVersion(input: {
  templateKey: string;
  subject: string;
  body: string;
  actorId: string;
}): Promise<{ templateVersionId: string; version: number }> {
  const templateKey = input.templateKey.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{0,119}$/.test(templateKey)) throw new Error("Template key must use letters, numbers, dots, underscores, or hyphens.");
  const snapshot = createAgencyFollowupContentSnapshot(input.subject, input.body);
  const priorResult = await supabase.from("agency_followup_template_versions").select("version")
    .eq("template_key", templateKey).order("version", { ascending: false }).limit(100);
  const priorVersions = assertResult(priorResult, "Unable to read template versions") as DbRow[];
  const version = nextAgencyFollowupVersion(priorVersions.map((row) => Number(row.version)));
  const inserted = await supabase.from("agency_followup_template_versions").insert({
    template_key: templateKey,
    version,
    channel: snapshot.content.channel,
    subject: snapshot.content.subject,
    body: snapshot.content.body,
    content_sha256: snapshot.contentSha256,
    state: "draft",
    created_by_operator_id: input.actorId,
  }).select("id").single();
  if (inserted.error) throw new Error(`Unable to create template version: ${inserted.error.message}`);
  const templateVersionId = String((inserted.data as DbRow).id);
  await appendAuditEvent({
    templateVersionId,
    eventType: "template_created",
    idempotencyKey: `template-created:${templateVersionId}`,
    payload: { templateKey, version, contentSha256: snapshot.contentSha256 },
    actorId: input.actorId,
  });
  return { templateVersionId, version };
}

export async function approveAgencyFollowupTemplateVersion(input: {
  templateVersionId: string;
  actorId: string;
}): Promise<void> {
  const reviewedAt = new Date().toISOString();
  const updated = await supabase.from("agency_followup_template_versions").update({
    state: "approved",
    approved_by_operator_id: input.actorId,
    approved_at: reviewedAt,
  }).eq("id", input.templateVersionId).eq("state", "draft").select("id,template_key,version,content_sha256").single();
  if (updated.error) throw new Error(`Unable to approve template version: ${updated.error.message}`);
  const row = updated.data as DbRow;
  await appendAuditEvent({
    templateVersionId: input.templateVersionId,
    eventType: "template_approved",
    idempotencyKey: `template-approved:${input.templateVersionId}:${input.actorId}`,
    payload: { templateKey: row.template_key, version: row.version, contentSha256: row.content_sha256, reviewerId: input.actorId, reviewedAt },
    actorId: input.actorId,
  });
}

export async function createAgencyFollowupJourneyVersion(input: {
  journeyKey: string;
  name: string;
  schedule: AgencyFollowupSchedulePolicy;
  steps: AgencyFollowupStepDraft[];
  actorId: string;
}): Promise<{ journeyId: string; version: number }> {
  const journeyKey = input.journeyKey.trim().toLowerCase();
  const name = input.name.trim();
  if (!/^[a-z0-9][a-z0-9._-]{0,119}$/.test(journeyKey)) throw new Error("Journey key must use letters, numbers, dots, underscores, or hyphens.");
  if (!name || name.length > 240) throw new Error("Journey name is required and must be at most 240 characters.");
  validateAgencyFollowupSchedulePolicy(input.schedule);
  validateAgencyFollowupStepDrafts(input.steps);
  const templateIds = input.steps.map((step) => step.templateVersionId);
  const templateResult = await supabase.from("agency_followup_template_versions").select("id,state")
    .in("id", templateIds).eq("state", "approved");
  const approvedTemplates = assertResult(templateResult, "Unable to verify approved templates") as DbRow[];
  if (new Set(approvedTemplates.map((row) => String(row.id))).size !== new Set(templateIds).size) {
    throw new Error("Every step must reference an approved template version.");
  }
  const versionsResult = await supabase.from("agency_followup_journeys").select("version")
    .eq("journey_key", journeyKey).order("version", { ascending: false }).limit(100);
  const versions = assertResult(versionsResult, "Unable to read journey versions") as DbRow[];
  const version = nextAgencyFollowupVersion(versions.map((row) => Number(row.version)));
  const inserted = await supabase.from("agency_followup_journeys").insert({
    journey_key: journeyKey,
    version,
    name,
    state: "draft",
    timezone: input.schedule.timezone,
    business_days: input.schedule.businessDays,
    local_window_start: input.schedule.localWindowStart,
    local_window_end: input.schedule.localWindowEnd,
    minimum_spacing_hours: input.schedule.minimumSpacingHours,
    created_by_operator_id: input.actorId,
  }).select("id").single();
  if (inserted.error) throw new Error(`Unable to create journey version: ${inserted.error.message}`);
  const journeyId = String((inserted.data as DbRow).id);
  const stepRows = input.steps.map((step, index) => ({
    journey_id: journeyId,
    step_number: index + 1,
    template_version_id: step.templateVersionId,
    delay_business_days: step.delayBusinessDays,
  }));
  const createdSteps = await supabase.from("agency_followup_steps").insert(stepRows);
  if (createdSteps.error) {
    await supabase.from("agency_followup_steps").delete().eq("journey_id", journeyId);
    await supabase.from("agency_followup_journeys").delete().eq("id", journeyId);
    throw new Error(`Unable to create journey steps: ${createdSteps.error.message}`);
  }
  await appendAuditEvent({
    journeyId,
    eventType: "journey_created",
    idempotencyKey: `journey-created:${journeyId}`,
    payload: { journeyKey, version, name, stepCount: stepRows.length, schedule: input.schedule },
    actorId: input.actorId,
  });
  return { journeyId, version };
}

export async function activateAgencyFollowupJourney(input: { journeyId: string; actorId: string }): Promise<void> {
  const activation = await supabase.rpc("activate_agency_followup_journey", {
    p_journey_id: input.journeyId,
    p_actor_operator_id: input.actorId,
  });
  if (activation.error) throw new Error(`Unable to activate journey version: ${activation.error.message}`);
}

export async function createAgencyFollowupEnrollment(input: {
  journeyId: string;
  prospectId: string;
  actorId: string;
}): Promise<{ enrollmentId: string; messageCount: number }> {
  const [journeyResult, prospectResult, stepsResult] = await Promise.all([
    supabase.from("agency_followup_journeys").select("*").eq("id", input.journeyId).eq("state", "active").maybeSingle(),
    supabase.from("agency_prospects").select("*").eq("id", input.prospectId).maybeSingle(),
    supabase.from("agency_followup_steps").select("*").eq("journey_id", input.journeyId).order("step_number"),
  ]);
  if (journeyResult.error) throw new Error(journeyResult.error.message);
  if (!journeyResult.data) throw new Error("Choose an active follow-up journey.");
  if (prospectResult.error) throw new Error(prospectResult.error.message);
  if (!prospectResult.data) throw new Error("Agency prospect was not found.");
  const journey = journeyResult.data as DbRow;
  const prospect = prospectResult.data as DbRow;
  const steps = assertResult(stepsResult, "Unable to load follow-up journey steps") as DbRow[];
  if (steps.length === 0) throw new Error("This journey has no steps yet.");
  if (["won", "lost"].includes(String(prospect.stage))) throw new Error("This prospect's current pipeline stage cannot be enrolled.");
  const recipient = toRecipient(prospect, { prospect_id: prospect.id });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient.contactEmail)) throw new Error("Add a valid contact email before enrolling this prospect.");

  const templateIds = steps.map((step) => String(step.template_version_id));
  const templatesResult = await supabase.from("agency_followup_template_versions").select("*").in("id", templateIds).eq("state", "approved");
  const templates = assertResult(templatesResult, "Unable to load approved message templates") as DbRow[];
  const templateById = new Map(templates.map((row) => [String(row.id), row]));
  if (templateById.size !== steps.length) throw new Error("Every journey step must reference an approved template version.");

  const enrollmentId = randomUUID();
  const recipientHash = agencyFollowupRecipientHash(recipient);
  let previousScheduledAt: string | null = null;
  const enrollmentResult = await supabase.from("agency_followup_enrollments").insert({
    id: enrollmentId,
    journey_id: journey.id,
    prospect_id: prospect.id,
    state: "draft",
    eligibility_state: "pending",
    eligibility_evidence_ref: null,
    recipient_name_snapshot: recipient.contactName,
    recipient_email_snapshot: recipient.contactEmail,
    recipient_sha256: recipientHash,
    created_by_operator_id: input.actorId,
  }).select("id").single();
  if (enrollmentResult.error) throw new Error(enrollmentResult.error.message);

  const rows = steps.map((step) => {
    const template = templateById.get(String(step.template_version_id))!;
    const messageId = randomUUID();
    const content = { channel: "email" as const, subject: String(template.subject), body: String(template.body) };
    const contentHash = agencyFollowupContentHash(content);
    const logicalKey = agencyFollowupLogicalMessageKey(enrollmentId, messageId);
    const spacingAnchor = previousScheduledAt
      ? new Date(Date.parse(previousScheduledAt) + Number(journey.minimum_spacing_hours) * 60 * 60 * 1000).toISOString()
      : new Date().toISOString();
    const scheduledAt = scheduleAgencyFollowupStep({
      anchorAt: spacingAnchor,
      timezone: String(journey.timezone),
      businessDays: (journey.business_days as number[]).map(Number),
      delayBusinessDays: Number(step.delay_business_days),
      localWindowStart: String(journey.local_window_start).slice(0, 5),
    });
    previousScheduledAt = scheduledAt;
    return {
      id: messageId,
      enrollment_id: enrollmentId,
      step_id: step.id,
      step_number: step.step_number,
      template_version_id: template.id,
      state: "awaiting_review",
      content_snapshot: content,
      content_sha256: contentHash,
      recipient_name_snapshot: recipient.contactName,
      recipient_email_snapshot: recipient.contactEmail,
      recipient_sha256: recipientHash,
      scheduled_at: scheduledAt,
      logical_message_key: logicalKey,
      provider_idempotency_key: logicalKey,
    };
  });
  const messagesResult = await supabase.from("agency_followup_messages").insert(rows).select("id");
  if (messagesResult.error) {
    await supabase.from("agency_followup_enrollments").delete().eq("id", enrollmentId);
    throw new Error(messagesResult.error.message);
  }
  try {
    await appendAuditEvent({
      enrollmentId,
      eventType: "enrolled",
      idempotencyKey: `enrolled:${enrollmentId}`,
      payload: { journeyId: journey.id, prospectId: prospect.id, messageCount: rows.length, initialState: "draft" },
      actorId: input.actorId,
    });
  } catch (error) {
    await supabase.from("agency_followup_messages").delete().eq("enrollment_id", enrollmentId);
    await supabase.from("agency_followup_enrollments").delete().eq("id", enrollmentId);
    throw error;
  }
  return { enrollmentId, messageCount: rows.length };
}

export async function setAgencyFollowupEligibility(input: {
  enrollmentId: string;
  state: "eligible" | "ineligible" | "unknown";
  evidenceRef: string;
  actorId: string;
}): Promise<void> {
  const enrollmentResult = await supabase.from("agency_followup_enrollments").select("*").eq("id", input.enrollmentId).maybeSingle();
  if (enrollmentResult.error) throw new Error(enrollmentResult.error.message);
  if (!enrollmentResult.data) throw new Error("Follow-up enrollment was not found.");
  if (!input.evidenceRef.trim()) throw new Error("Record the basis for this eligibility decision.");
  const enrollment = enrollmentResult.data as DbRow;
  const result = await supabase.from("agency_followup_enrollments").update({
    eligibility_state: input.state,
    eligibility_evidence_ref: input.evidenceRef.trim(),
    released_by_operator_id: null,
    released_at: null,
    release_basis: null,
    state: enrollment.state === "active" ? "draft" : enrollment.state,
    updated_at: new Date().toISOString(),
  }).eq("id", input.enrollmentId).select("id").single();
  if (result.error) throw new Error(result.error.message);
  await appendAuditEvent({
    enrollmentId: input.enrollmentId,
    eventType: "eligibility_changed",
    idempotencyKey: `eligibility:${input.enrollmentId}:${input.state}:${agencyFollowupRecipientHash({
      prospectId: String(enrollment.prospect_id),
      firmName: String(enrollment.recipient_name_snapshot ?? ""),
      contactName: null,
      contactEmail: String(enrollment.recipient_email_snapshot ?? ""),
    })}:${input.actorId}`,
    payload: { state: input.state, evidenceRef: input.evidenceRef.trim() },
    actorId: input.actorId,
  });
}

export async function releaseAgencyFollowupEnrollment(input: {
  enrollmentId: string;
  basis: string;
  actorId: string;
}): Promise<void> {
  const records = await loadCurrentRecords(input.enrollmentId);
  if (records.enrollment.state !== "draft" && records.enrollment.state !== "paused") {
    throw new Error("Only a draft or paused enrollment can be released.");
  }
  if (!input.basis.trim()) throw new Error("Add the per-prospect release basis.");
  await assertClearForReview(records.enrollment, records.prospect);
  const currentRecipient = toRecipient(records.prospect, records.enrollment);
  if (agencyFollowupRecipientHash(currentRecipient) !== records.enrollment.recipient_sha256) {
    throw new Error("Recipient details changed after enrollment. Cancel and create a fresh enrollment to review the new identity.");
  }
  const result = await supabase.from("agency_followup_enrollments").update({
    state: "active",
    released_by_operator_id: input.actorId,
    released_at: new Date().toISOString(),
    release_basis: input.basis.trim(),
    started_at: records.enrollment.started_at ?? new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", input.enrollmentId).select("id").single();
  if (result.error) throw new Error(result.error.message);
  await appendAuditEvent({
    enrollmentId: input.enrollmentId,
    eventType: "released",
    idempotencyKey: `released:${input.enrollmentId}:${input.actorId}:${agencyFollowupRecipientHash(currentRecipient)}`,
    payload: { basis: input.basis.trim(), recipientSha256: records.enrollment.recipient_sha256 },
    actorId: input.actorId,
  });
}

export async function approveAgencyFollowupMessage(input: {
  enrollmentId: string;
  messageId: string;
  actorId: string;
}): Promise<void> {
  const records = await loadCurrentRecords(input.enrollmentId, input.messageId);
  const message = records.message!;
  if (message.state !== "awaiting_review") throw new Error("Only a message awaiting review can be approved.");
  if (records.enrollment.state !== "active" || !records.enrollment.released_at) throw new Error("Release this individual prospect before approving a message.");
  const operations = await assertClearForReview(records.enrollment, records.prospect);
  const recipient = toRecipient(records.prospect, records.enrollment);
  const recipientHash = agencyFollowupRecipientHash(recipient);
  if (recipientHash !== records.enrollment.recipient_sha256 || recipientHash !== message.recipient_sha256) {
    throw new Error("Recipient details changed after review. The message approval is invalid.");
  }
  const content = toContent(message.content_snapshot);
  const contentHash = agencyFollowupContentHash(content);
  if (contentHash !== message.content_sha256) throw new Error("Message content changed without its approval hash being refreshed.");
  const templateResult = await supabase.from("agency_followup_template_versions").select("state,content_sha256").eq("id", message.template_version_id).maybeSingle();
  if (templateResult.error) throw new Error(templateResult.error.message);
  if (!templateResult.data || templateResult.data.state !== "approved") throw new Error("The referenced template version is not approved.");
  if (!operations.hasExactSource) throw new Error("An exact prospect operations source is required.");

  const reviewedAt = new Date().toISOString();
  const update = await supabase.from("agency_followup_messages").update({
    state: "scheduled",
    approved_content_sha256: contentHash,
    approved_recipient_sha256: recipientHash,
    reviewed_by_operator_id: input.actorId,
    reviewed_at: reviewedAt,
  }).eq("id", input.messageId).eq("state", "awaiting_review").select("id").single();
  if (update.error) throw new Error(update.error.message);
  await appendAuditEvent({
    enrollmentId: input.enrollmentId,
    messageId: input.messageId,
    eventType: "message_approved",
    idempotencyKey: `message-approved:${input.messageId}:${contentHash}:${recipientHash}`,
    payload: { contentSha256: contentHash, recipientSha256: recipientHash, reviewerId: input.actorId, reviewedAt },
    actorId: input.actorId,
  });
  await appendAuditEvent({
    enrollmentId: input.enrollmentId,
    messageId: input.messageId,
    eventType: "message_scheduled",
    idempotencyKey: `message-scheduled:${input.messageId}:${message.scheduled_at}`,
    payload: { scheduledAt: message.scheduled_at, logicalMessageKey: message.logical_message_key },
    actorId: input.actorId,
  });
}

export async function pauseAgencyFollowupEnrollment(input: {
  enrollmentId: string;
  reason: string;
  actorId: string;
}): Promise<void> {
  if (!input.reason.trim()) throw new Error("Add a reason for pausing this enrollment.");
  const result = await supabase.from("agency_followup_enrollments").update({
    state: "paused",
    updated_at: new Date().toISOString(),
  }).eq("id", input.enrollmentId).eq("state", "active").select("id").maybeSingle();
  if (result.error) throw new Error(result.error.message);
  if (!result.data) throw new Error("Only an active enrollment can be paused.");
  const messages = await supabase.from("agency_followup_messages").update({ state: "cancelled", scheduled_at: null })
    .eq("enrollment_id", input.enrollmentId).in("state", ["approved", "scheduled"]);
  if (messages.error) throw new Error(messages.error.message);
  await appendAuditEvent({
    enrollmentId: input.enrollmentId,
    eventType: "paused",
    idempotencyKey: `paused:${input.enrollmentId}:${input.actorId}:${Date.now()}`,
    payload: { reason: input.reason.trim() },
    actorId: input.actorId,
  });
}

const fakeFollowupProvider = new FakeAgencyFollowupProvider();

/** Local-only deterministic dispatcher. This adapter has no real provider path. */
export async function runFakeAgencyFollowupDispatcher(input: {
  workerId: string;
  now?: string;
  leaseSeconds?: number;
  limit?: number;
}): Promise<Awaited<ReturnType<typeof dispatchAgencyFollowupBatch>>> {
  if (!input.workerId.trim()) throw new Error("A worker id is required.");
  const now = input.now ?? new Date().toISOString();
  const repository = {
    async claimDueMessages(claimInput: { workerId: string; now: string; leaseSeconds: number; limit: number }): Promise<AgencyFollowupClaim[]> {
      const result = await supabase.rpc("claim_agency_followup_messages", {
        p_worker_id: claimInput.workerId,
        p_now: claimInput.now,
        p_lease_seconds: claimInput.leaseSeconds,
        p_limit: claimInput.limit,
      });
      if (result.error) throw new Error(`Unable to claim due fake-provider messages: ${result.error.message}`);
      return (result.data as DbRow[]).map((row) => ({
        id: String(row.id),
        enrollmentId: String(row.enrollment_id),
        attemptCount: Number(row.attempt_count),
        leaseOwner: String(row.lease_owner),
      }));
    },
    async loadCurrentSendContext(claim: AgencyFollowupClaim, attemptAt: string): Promise<AgencyFollowupSendContext> {
      const records = await loadCurrentRecords(claim.enrollmentId, claim.id);
      const operations = await loadOperationsState(String(records.prospect.id));
      const previousAcceptedAt = records.messages
        .filter((row) => Number(row.step_number) < Number(records.message!.step_number) && row.provider_accepted_at)
        .map((row) => String(row.provider_accepted_at))
        .sort((left, right) => Date.parse(right) - Date.parse(left))[0] ?? null;
      const context = makeSendContext(records.enrollment, records.prospect, records.journey, records.message!, operations, previousAcceptedAt);
      context.now = attemptAt;
      const expectedKey = agencyFollowupLogicalMessageKey(claim.enrollmentId, claim.id);
      if (records.message!.provider_idempotency_key !== expectedKey || records.message!.logical_message_key !== expectedKey) {
        context.cancelled = true;
      }
      return context;
    },
    async persistDisposition(claim: AgencyFollowupClaim, disposition: AgencyFollowupWorkerDisposition): Promise<void> {
      const patch: DbRow = { lease_owner: null, lease_until: null, updated_at: disposition.at };
      let eventType: string;
      let payload: Record<string, unknown>;
      if (disposition.state === "blocked") {
        Object.assign(patch, { state: "blocked", scheduled_at: null, last_error_code: disposition.blockers.join(",").slice(0, 300), unknown_since: null });
        eventType = "message_blocked";
        payload = { blockers: disposition.blockers, checkedAt: disposition.at };
      } else if (disposition.state === "accepted") {
        Object.assign(patch, { state: "accepted", provider_message_id: disposition.providerMessageId, provider_accepted_at: disposition.acceptedAt, last_error_code: null, unknown_since: null });
        eventType = "provider_accepted";
        payload = { providerMessageId: disposition.providerMessageId, acceptedAt: disposition.acceptedAt };
      } else if (disposition.state === "scheduled") {
        Object.assign(patch, { state: "scheduled", scheduled_at: disposition.retryAt, last_error_code: disposition.errorCode.slice(0, 300), unknown_since: null });
        eventType = "provider_attempted";
        payload = { retryAt: disposition.retryAt, errorCode: disposition.errorCode, sameIdempotencyKey: true };
      } else if (disposition.state === "failed") {
        Object.assign(patch, { state: "failed", scheduled_at: null, last_error_code: disposition.errorCode.slice(0, 300), unknown_since: null });
        eventType = "provider_failed";
        payload = { errorCode: disposition.errorCode };
      } else {
        Object.assign(patch, { state: "unknown", scheduled_at: null, last_error_code: disposition.detail.slice(0, 300), unknown_since: disposition.at });
        eventType = "provider_unknown";
        payload = { detail: disposition.detail, automaticRetry: false };
      }
      const update = await supabase.from("agency_followup_messages").update(patch)
        .eq("id", claim.id).eq("state", "claimed").eq("lease_owner", claim.leaseOwner).select("id").maybeSingle();
      if (update.error) throw new Error(`Unable to persist fake-provider outcome: ${update.error.message}`);
      if (!update.data) throw new Error("The worker lease expired or changed before outcome persistence.");
      await appendAuditEvent({
        enrollmentId: claim.enrollmentId,
        messageId: claim.id,
        eventType,
        idempotencyKey: `worker:${claim.id}:${claim.attemptCount}:${eventType}`,
        payload: { ...payload, attemptCount: claim.attemptCount, workerId: claim.leaseOwner },
      });
    },
  };

  return dispatchAgencyFollowupBatch({
    repository,
    provider: fakeFollowupProvider,
    workerId: input.workerId,
    now,
    leaseSeconds: input.leaseSeconds,
    limit: input.limit,
  });
}
