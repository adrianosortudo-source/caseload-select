/**
 * Agency CRM (Layer B) shared types and stage constants.
 * Pure module (no 'server-only'), so both the server lib (agency-crm.ts) and
 * client components can import these.
 */

export const PROSPECT_STAGES = [
  'new', 'researching', 'contacted', 'diagnostic_sent', 'pitched', 'won', 'lost',
] as const;
export type ProspectStage = (typeof PROSPECT_STAGES)[number];

export const DEAL_STAGES = ['proposal', 'negotiation', 'won', 'lost'] as const;
export type DealStage = (typeof DEAL_STAGES)[number];

export function isProspectStage(v: unknown): v is ProspectStage {
  return typeof v === 'string' && (PROSPECT_STAGES as readonly string[]).includes(v);
}
export function isDealStage(v: unknown): v is DealStage {
  return typeof v === 'string' && (DEAL_STAGES as readonly string[]).includes(v);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v);
}

export interface AgencyProspect {
  id: string;
  firm_name: string;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  city: string | null;
  practice_area: string | null;
  source: string | null;
  stage: ProspectStage;
  fit_score: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface AgencyDeal {
  id: string;
  prospect_id: string;
  title: string;
  stage: DealStage;
  monthly_value: number | null;
  expected_close: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface AgencyReminder {
  id: string;
  prospect_id: string | null;
  deal_id: string | null;
  due_at: string;
  note: string;
  done: boolean;
  created_at: string;
}

export interface ProspectInput {
  firm_name: string;
  contact_name?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  city?: string | null;
  practice_area?: string | null;
  source?: string | null;
  stage?: ProspectStage;
  fit_score?: number | null;
  notes?: string | null;
}
export type ProspectPatch = Partial<ProspectInput>;

export interface DealInput {
  prospect_id: string;
  title: string;
  stage?: DealStage;
  monthly_value?: number | null;
  expected_close?: string | null;
  notes?: string | null;
}
export type DealPatch = Partial<Omit<DealInput, 'prospect_id'>>;

export interface ReminderInput {
  prospect_id?: string | null;
  deal_id?: string | null;
  due_at: string;
  note: string;
}
export interface ReminderPatch {
  due_at?: string;
  note?: string;
  done?: boolean;
}
