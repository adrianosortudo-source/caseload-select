import 'server-only';
import {
  processChannelInbound, type ChannelIntakeIO, type ChannelSender, type MetaChannel,
} from './channel-intake-processor';
import { EMPTY_CHANNEL_INTAKE_HISTORY } from './channel-intake-history';
import type { ChannelSessionRow } from './channel-intake-session-store';
import type { LawyerReport, PracticeArea } from './screen-engine/types';
import { llmExtractServer } from './screen-llm-server';
import { llmMapOptionReply } from './llm-option-map';
import { redactPreviewState, redactPreviewText } from './screen-preview-boundary';

export interface MessagingCursor {
  channel: MetaChannel;
  practiceArea: PracticeArea;
  session: ChannelSessionRow | null;
  expires: number;
  turns: number;
}

export interface ParityReport {
  report: LawyerReport;
  html: string;
}

const firmId = '00000000-0000-4000-8000-000000000051';

function fictionalSender(channel: MetaChannel): ChannelSender {
  const sender = { messageMid: crypto.randomUUID(), senderName: null };
  if (channel === 'facebook') return { ...sender, channel, pageId: 'fictional-page', senderPsid: 'fictional-sender' };
  if (channel === 'instagram') return { ...sender, channel, igBusinessAccountId: 'fictional-account', senderIgsid: 'fictional-sender' };
  return { ...sender, channel, senderWaId: '14165550148', phoneNumberId: 'fictional-number' };
}

/** Run the operational Meta decision loop with all its storage and delivery confined to this response. */
export async function runFictionalMessage(cursor: MessagingCursor, text: string) {
  const sender = fictionalSender(cursor.channel);
  const replies: string[] = [];
  const result: { report?: ParityReport; ended: boolean; unavailable: boolean } = { ended: false, unavailable: false };
  let session = cursor.session;
  const effects: ChannelIntakeIO = {
    async loadOpenChannelSession() { return session; },
    async loadRecentFinalizedSession() { return null; },
    async persistQuestionState(args) {
      const id = args.sessionId ?? crypto.randomUUID();
      const now = new Date().toISOString();
      session = {
        id, firm_id: firmId, channel: cursor.channel, sender_id: args.senderId,
        engine_state: args.engineState, intake_exchanges: args.intakeExchanges,
        follow_up_count: args.followUpCount, finalized: false, screened_lead_id: null, max_follow_ups: 3,
        expires_at: new Date(cursor.expires).toISOString(), created_at: session?.created_at ?? now,
      };
      return { ok: true, sessionId: id };
    },
    async persistSettledQuestion(args) {
      if (!session || session.id !== args.sessionId) throw new Error('Missing fictional message session');
      session = { ...session, engine_state: args.engineState, intake_exchanges: args.intakeExchanges, follow_up_count: args.followUpCount };
    },
    async updateChannelSession(args) {
      if (!session || session.id !== args.sessionId) return { ok: false };
      session = { ...session, engine_state: args.engineState,
        intake_exchanges: args.intakeExchanges ?? session.intake_exchanges ?? EMPTY_CHANNEL_INTAKE_HISTORY,
        follow_up_count: args.followUpCount };
      return { ok: true };
    },
    async finalizeChannelSession() { result.ended = true; return { ok: true }; },
    async persistUnconfirmedInquiry() { result.ended = true; return { ok: true }; },
    async recordInboundConversationEvent() { return { ok: true }; },
    async sendChannelMessage(args) {
      replies.push(args.text);
      return { sent: true, messageId: crypto.randomUUID() };
    },
    async resolveChannelFirmTimezone() { return 'America/Toronto'; },
    async finalizeChannelLead(args) {
      result.report = { report: args.report, html: args.briefHtml };
      result.ended = true;
      return { persisted: false };
    },
    async llmExtractServer(...args) {
      try {
        const [description, state, limit, provider, request, turn] = args;
        const response = await llmExtractServer(redactPreviewText(description, state), redactPreviewState(state), limit, provider, request,
          turn && { ...turn, reply: turn.reply && redactPreviewText(turn.reply, state) });
        if (response.mode !== 'live') result.unavailable = true;
        return response;
      } catch (error) { result.unavailable = true; throw error; }
    },
    async llmMapOptionReply(...args) {
      try {
        const [input, ...options] = args;
        const response = await llmMapOptionReply({ ...input, reply: redactPreviewText(input.reply, cursor.session?.engine_state) }, ...options);
        if (response.mode !== 'live') result.unavailable = true;
        return response;
      } catch (error) { result.unavailable = true; throw error; }
    },
  };
  await processChannelInbound({ firmId, sender, text, practiceArea: cursor.practiceArea, occurredAt: new Date().toISOString() }, effects);
  return { replies, ...result, cursor: { ...cursor, turns: cursor.turns + 1, session } };
}
