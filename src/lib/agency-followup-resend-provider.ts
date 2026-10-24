import "server-only";

import { Resend, type CreateEmailOptions, type CreateEmailRequestOptions, type CreateEmailResponse } from "resend";
import type { AgencyFollowupProviderRequest } from "./agency-followup-provider";
import type { AgencyProviderOutcome } from "./agency-followup-domain";
import {
  parseAgencyFollowupLogicalKey,
  resolveAgencyFollowupSendConfig,
  type AgencyFollowupSendConfig,
} from "./agency-followup-send-config";

export type AgencyFollowupResendOutcome = AgencyProviderOutcome | {
  kind: "blocked";
  blockers: string[];
};

/** Extended outcome lets the existing worker persist its terminal blocked state. */
export interface AgencyFollowupResendProvider {
  send(request: AgencyFollowupProviderRequest): Promise<AgencyFollowupResendOutcome>;
}

export type AgencyFollowupResendSend = (
  payload: CreateEmailOptions,
  options?: CreateEmailRequestOptions,
) => Promise<CreateEmailResponse>;

const RETRYABLE_DEFINITIVE_CODES = new Set([
  // Resend documents these as a rejected rate-limited request or an in-flight
  // same-key request that is safe to retry later with the identical payload.
  "rate_limit_exceeded",
  "concurrent_idempotent_requests",
]);

const PERMANENT_DEFINITIVE_CODES = new Set([
  "missing_required_field",
  "invalid_idempotency_key",
  "invalid_access",
  "invalid_parameter",
  "invalid_region",
  "missing_api_key",
  "invalid_api_Key",
  "invalid_from_address",
  "validation_error",
  "not_found",
  "method_not_allowed",
]);

function mapResendError(name: string): AgencyProviderOutcome {
  if (RETRYABLE_DEFINITIVE_CODES.has(name)) {
    return { kind: "definitive_retryable_failure", code: `resend_${name}` };
  }
  if (PERMANENT_DEFINITIVE_CODES.has(name)) {
    return { kind: "definitive_permanent_failure", code: `resend_${name}` };
  }
  // A different-payload conflict may indicate a prior send under this key.
  // Server errors likewise do not prove non-acceptance, so all are quarantined.
  return { kind: "unknown", detail: "resend_response_does_not_prove_non_acceptance" };
}

function isProviderMessageId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 500 && value === value.trim();
}

export function createAgencyFollowupResendProvider(input: {
  env?: Record<string, string | undefined>;
  config?: AgencyFollowupSendConfig;
  sendEmail?: AgencyFollowupResendSend;
  now?: () => Date;
} = {}): AgencyFollowupResendProvider {
  const env = input.env ?? process.env;
  const config = input.config ?? resolveAgencyFollowupSendConfig(env);
  const now = input.now ?? (() => new Date());
  const sendEmail = input.sendEmail ?? ((): AgencyFollowupResendSend => {
    const apiKey = env.RESEND_API_KEY?.trim();
    if (!apiKey) {
      return async () => ({ data: null, error: { name: "missing_api_key", message: "API key is not configured." } });
    }
    const resend = new Resend(apiKey);
    return (payload, options) => resend.emails.send(payload, options);
  })();

  return {
    async send(request: AgencyFollowupProviderRequest): Promise<AgencyFollowupResendOutcome> {
      const globalBlockers = config.mode === "off" ? ["send_mode_off"] : config.blockers;
      if (globalBlockers.length > 0 || !config.ready) {
        return { kind: "blocked", blockers: globalBlockers.length > 0 ? [...globalBlockers] : ["send_config_not_ready"] };
      }

      const logicalIdentity = parseAgencyFollowupLogicalKey(request.idempotencyKey);
      if (!logicalIdentity) {
        return { kind: "blocked", blockers: ["logical_message_identity_invalid"] };
      }
      const targetBlockers = config.authorize({
        ...logicalIdentity,
        recipientEmail: request.recipientEmail,
      });
      if (targetBlockers.length > 0) return { kind: "blocked", blockers: [...targetBlockers] };

      const from = config.configuredFrom;
      const replyTo = config.configuredReplyTo;
      if (!from || !replyTo) return { kind: "blocked", blockers: ["followup_sender_or_reply_to_missing"] };

      const payload: CreateEmailOptions = {
        from,
        replyTo,
        to: request.recipientEmail,
        subject: request.subject,
        text: request.body,
      };
      const options: CreateEmailRequestOptions = { idempotencyKey: request.idempotencyKey };

      let response: CreateEmailResponse;
      try {
        response = await sendEmail(payload, options);
      } catch {
        // A thrown SDK/network failure may occur after Resend accepted the call.
        return { kind: "unknown", detail: "resend_transport_outcome_unknown" };
      }

      if (!response || typeof response !== "object" || !("data" in response) || !("error" in response)) {
        return { kind: "unknown", detail: "resend_malformed_response" };
      }
      if (response.error) {
        const errorName: unknown = response.error.name;
        return typeof errorName === "string"
          ? mapResendError(errorName)
          : { kind: "unknown", detail: "resend_malformed_error_response" };
      }
      const providerMessageId = response.data?.id;
      if (!isProviderMessageId(providerMessageId)) {
        return { kind: "unknown", detail: "resend_success_missing_provider_message_id" };
      }

      let acceptedAt: Date;
      try {
        acceptedAt = now();
      } catch {
        return { kind: "unknown", detail: "resend_acceptance_timestamp_invalid" };
      }
      if (!Number.isFinite(acceptedAt.getTime())) {
        // The provider accepted the email, but the acceptance timestamp cannot
        // be recorded reliably. Quarantine rather than claim durable success.
        return { kind: "unknown", detail: "resend_acceptance_timestamp_invalid" };
      }
      return {
        kind: "accepted",
        providerMessageId,
        acceptedAt: acceptedAt.toISOString(),
      };
    },
  };
}
