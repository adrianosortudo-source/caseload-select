import "server-only";
import { getCrmAgentReadSession } from "./crm-agent-auth";
import { agencyFollowupRecipientEmailHash } from "@/lib/agency-followup-domain";
import { supabaseAdmin } from "@/lib/supabase-admin";

type Row = Record<string, unknown>;
type CaptureSource = "subject_web_form" | "subject_email" | "signed_document" | "recorded_verbal_consent" | "other_verified_evidence";
type EventType = "opt_in_granted" | "opt_in_withdrawn";
export class AgencyFollowupOptInError extends Error {
  constructor(message: string, readonly kind: "invalid" | "conflict" | "internal") {
    super(message);
    this.name = "AgencyFollowupOptInError";
  }
}
export interface RecordAgencyFollowupOptInInput {
  prospectId: string; actorOperatorId: string; eventType: EventType; capturedAt: string;
  captureSource: CaptureSource; consentTextVersion: string; consentTextSha256: string;
  evidenceReference: string; evidenceSha256: string; idempotencyKey: string; evidenceReviewed: true;
}
export interface RecordAgencyFollowupOptInResult { eventId: string; replayed: boolean; recipientEmailSha256: string; }
export interface AgencyFollowupOptInHistoryEvent {
  eventId: string;
  eventType: EventType;
  capturedAt: string;
  recordedAt: string;
  captureSource: CaptureSource;
  consentTextVersion: string;
  consentTextSha256: string;
  evidenceReference: string;
  evidenceSha256: string;
  recipientEmailSha256: string;
  actorOperatorId: string;
}
export interface ListAgencyFollowupOptInHistoryInput { prospectId: string; actorOperatorId: string; }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[a-f0-9]{64}$/;
const SOURCES = new Set(["subject_web_form", "subject_email", "signed_document", "recorded_verbal_consent", "other_verified_evidence"]);
function fail(message: string, error?: { message?: string; code?: string } | null, kind: "invalid" | "conflict" | "internal" = "conflict"): never {
  // Database/provider messages may contain internal details; only keep our safe label.
  throw new AgencyFollowupOptInError(message, kind);
}
function one(result: { data: Row | null; error: { message: string } | null }, label: string): Row {
  if (result.error) return fail(label, result.error, "internal");
  if (!result.data) return fail(label);
  return result.data;
}
function many(result: { data: Row[] | null; error: { message: string } | null }, label: string): Row[] {
  if (result.error) return fail(label, result.error, "internal");
  if (!result.data) return fail(label);
  return result.data;
}
function text(value: unknown, max: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}

/** Reads the complete, allowlisted append-only history for one prospect. */
export async function listAgencyFollowupOptInHistory(
  input: ListAgencyFollowupOptInHistoryInput,
): Promise<AgencyFollowupOptInHistoryEvent[]> {
  if (!UUID.test(input.prospectId) || !UUID.test(input.actorOperatorId)) fail("Choose a valid prospect and operator identity.", null, "invalid");
  const actor = one(await supabaseAdmin.from("firm_lawyers").select("id,role,disabled").eq("id", input.actorOperatorId).maybeSingle(), "Unable to verify active operator");
  if (actor.role !== "operator" || actor.disabled !== false) fail("Only an active operator may view follow-up opt-in evidence.");

  return readAgencyFollowupOptInHistory(input.prospectId);
}

/** Dedicated capability path; never substitutes a human operator identifier. */
export async function listAgencyFollowupOptInHistoryForAgent(request: Request, prospectId: string): Promise<AgencyFollowupOptInHistoryEvent[]> {
  if (!UUID.test(prospectId) || !await getCrmAgentReadSession(request)) fail("Authorized CRM agent read required.");
  return readAgencyFollowupOptInHistory(prospectId);
}

async function readAgencyFollowupOptInHistory(prospectId: string): Promise<AgencyFollowupOptInHistoryEvent[]> {
  const pageSize = 1000;
  const maximumRows = 20000;
  const events: Row[] = [];
  for (let offset = 0; offset < maximumRows; offset += pageSize) {
    const page = many(await supabaseAdmin.from("agency_followup_opt_in_events")
      .select("id,event_type,captured_at,recorded_at,capture_source,consent_text_version,consent_text_sha256,evidence_reference,evidence_sha256,recipient_email_sha256,actor_operator_id")
      .eq("agency_prospect_id", prospectId)
      .order("recorded_at", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + pageSize - 1), "Unable to load Agency follow-up opt-in history");
    events.push(...page);
    if (page.length < pageSize) {
      return events.map((event) => {
        if (event.event_type !== "opt_in_granted" && event.event_type !== "opt_in_withdrawn") fail("Opt-in history contains an invalid event.", null, "internal");
        if (!text(event.id, 100) || !text(event.captured_at, 100) || !text(event.recorded_at, 100) ||
            !text(event.capture_source, 100) || !text(event.consent_text_version, 200) ||
            !SHA256.test(String(event.consent_text_sha256 ?? "")) || !text(event.evidence_reference, 2000) ||
            !SHA256.test(String(event.evidence_sha256 ?? "")) || !SHA256.test(String(event.recipient_email_sha256 ?? "")) ||
            !text(event.actor_operator_id, 100)) fail("Opt-in history contains an invalid event.", null, "internal");
        return {
          eventId: event.id,
          eventType: event.event_type,
          capturedAt: event.captured_at,
          recordedAt: event.recorded_at,
          captureSource: event.capture_source as CaptureSource,
          consentTextVersion: event.consent_text_version,
          consentTextSha256: event.consent_text_sha256 as string,
          evidenceReference: event.evidence_reference,
          evidenceSha256: event.evidence_sha256 as string,
          recipientEmailSha256: event.recipient_email_sha256 as string,
          actorOperatorId: event.actor_operator_id,
        };
      });
    }
  }
  fail("Agency follow-up opt-in history exceeded the supported read limit.", null, "internal");
}

/** Appends only through the database RPC, which revalidates identity at insertion time. */
export async function recordAgencyFollowupOptInEvent(input: RecordAgencyFollowupOptInInput): Promise<RecordAgencyFollowupOptInResult> {
  if (!UUID.test(input.prospectId) || !UUID.test(input.actorOperatorId)) fail("Choose a valid prospect and operator identity.", null, "invalid");
  if (input.eventType !== "opt_in_granted" && input.eventType !== "opt_in_withdrawn") fail("Unsupported opt-in event.", null, "invalid");
  if (!text(input.capturedAt, 100) || !Number.isFinite(Date.parse(input.capturedAt))) fail("Provide a valid evidence capture time.", null, "invalid");
  if (!SOURCES.has(input.captureSource) || !text(input.consentTextVersion, 200) || !SHA256.test(input.consentTextSha256)) fail("Provide reviewed consent text details.", null, "invalid");
  if (!text(input.evidenceReference, 2000) || !SHA256.test(input.evidenceSha256) || !text(input.idempotencyKey, 500) || input.idempotencyKey.trim() !== input.idempotencyKey) fail("Provide reviewed evidence details and a trimmed idempotency key.", null, "invalid");
  if (input.evidenceReviewed !== true) fail("Confirm that the evidence was reviewed.", null, "invalid");

  const actor = one(await supabaseAdmin.from("firm_lawyers").select("id,role,disabled").eq("id", input.actorOperatorId).maybeSingle(), "Unable to verify active operator");
  if (actor.role !== "operator" || actor.disabled !== false) fail("Only an active operator may record follow-up opt-in evidence.");
  const prospect = one(await supabaseAdmin.from("agency_prospects").select("id,contact_email").eq("id", input.prospectId).maybeSingle(), "Agency prospect not found");
  if (!text(prospect.contact_email, 500)) fail("The current Agency recipient email is missing.");
  const recipientHash = agencyFollowupRecipientEmailHash(prospect.contact_email);

  const sources = many(await supabaseAdmin.from("prospect_source_links").select("id,source_record_key,source_system,active,organization_id,person_id").eq("source_record_key", input.prospectId), "Unable to verify current Agency source");
  const system = sources.some((row) => row.source_system === "agency_crm_contact") ? "agency_crm_contact" : "agency_crm";
  const activeSources = sources.filter((row) => row.source_system === system && row.active === true && text(row.organization_id, 100) && text(row.person_id, 100));
  if (activeSources.length !== 1) fail("Current prospect must have one unambiguous active Agency source.");
  const source = activeSources[0];
  const sourceId = String(source.id), organizationId = String(source.organization_id), personId = String(source.person_id);
  const associations = many(await supabaseAdmin.from("prospect_conversation_sources").select("source_link_id,conversation_id").eq("source_link_id", sourceId), "Unable to verify source conversation");
  if (associations.length !== 1 || !text(associations[0].conversation_id, 100)) fail("Current source must map to exactly one conversation.");
  const conversationId = String(associations[0].conversation_id);
  const conversation = one(await supabaseAdmin.from("prospect_conversations").select("id,organization_id,person_id").eq("id", conversationId).maybeSingle(), "Current source conversation not found");
  if (conversation.organization_id !== organizationId || conversation.person_id !== personId) fail("Source and conversation identity do not match.");
  const person = one(await supabaseAdmin.from("prospect_people").select("id,primary_email").eq("id", personId).maybeSingle(), "Current source person not found");
  if (!text(person.primary_email, 500) || person.primary_email.trim().toLowerCase() !== prospect.contact_email.trim().toLowerCase()) fail("Current Agency contact email does not match the source person.");
  const roles = many(await supabaseAdmin.from("prospect_person_firm_roles").select("organization_id,person_id,active").eq("organization_id", organizationId).eq("person_id", personId).eq("active", true), "Unable to verify active source role");
  if (roles.length !== 1) fail("Source person must have exactly one active firm role.");

  const rpc = await supabaseAdmin.rpc("record_agency_followup_opt_in_event", {
    p_agency_prospect_id: input.prospectId, p_source_link_id: sourceId, p_conversation_id: conversationId,
    p_recipient_email_sha256: recipientHash, p_event_type: input.eventType,
    p_captured_at: new Date(input.capturedAt).toISOString(), p_capture_source: input.captureSource,
    p_consent_text_version: input.consentTextVersion.trim(), p_consent_text_sha256: input.consentTextSha256,
    p_evidence_reference: input.evidenceReference.trim(), p_evidence_sha256: input.evidenceSha256,
    p_actor_operator_id: input.actorOperatorId, p_idempotency_key: input.idempotencyKey,
  });
  if (rpc.error) {
    const error = rpc.error as { message?: string; code?: string };
    const knownConflict = Boolean(error.code && error.code.startsWith("23")) ||
      /Agency follow-up opt-in (?:does not match|requires|capture time cannot|idempotency key was reused)/i.test(error.message ?? "");
    fail(knownConflict ? "Current opt-in evidence conflicts with the prospect context or an existing event." : "Unable to record Agency follow-up opt-in evidence.", error, knownConflict ? "conflict" : "internal");
  }
  const result = Array.isArray(rpc.data) ? rpc.data[0] as Row | undefined : undefined;
  if (!result || typeof result.event_id !== "string" || typeof result.replayed !== "boolean") fail("Opt-in RPC returned an invalid result.");
  return { eventId: result.event_id, replayed: result.replayed, recipientEmailSha256: recipientHash };
}
