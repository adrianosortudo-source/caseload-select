import "server-only";
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { scheduleAgencyFollowupStep } from "@/lib/agency-followup-schedule";
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
  journeys: Array<{ id: string; name: string; journeyKey: string; version: number; state: string }>;
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
    cancelled: ["paused", "stopped", "completed", "cancelled"].includes(String(enrollment.state)) ||
      ["cancelled", "blocked", "failed", "unknown"].includes(String(message.state)),
  };
}

async function appendAuditEvent(input: {
  enrollmentId: string;
  messageId?: string | null;
  eventType: string;
  idempotencyKey: string;
  payload: Record<string, unknown>;
  actorId: string;
}): Promise<void> {
  const { error } = await supabase.from("agency_followup_events").insert({
    enrollment_id: input.enrollmentId,
    message_id: input.messageId ?? null,
    event_type: input.eventType,
    idempotency_key: input.idempotencyKey,
    event_payload: input.payload,
    actor_operator_id: input.actorId,
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
  const [journeysResult, enrollmentsResult] = await Promise.all([
    supabase.from("agency_followup_journeys").select("id,name,journey_key,version,state").order("updated_at", { ascending: false }),
    supabase.from("agency_followup_enrollments").select("*").order("updated_at", { ascending: false }).limit(300),
  ]);
  const journeys = assertResult(journeysResult, "Unable to load follow-up journeys") as DbRow[];
  const enrollments = assertResult(enrollmentsResult, "Unable to load follow-up enrollments") as DbRow[];
  if (enrollments.length === 0) {
    return {
      journeys: journeys.map((row) => ({ id: row.id, name: row.name, journeyKey: row.journey_key, version: row.version, state: row.state })),
      items: [],
    };
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
    journeys: journeys.map((row) => ({ id: row.id, name: row.name, journeyKey: row.journey_key, version: row.version, state: row.state })),
    items,
  };
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
    state: "approved",
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
