/**
 * POST /api/portal/[firmId]/matters/[matterId]/milestone-draft
 *
 * J8 Milestone Assistant: generates an AI draft client update for a
 * lawyer-selected milestone. The lawyer provides the milestone label
 * (e.g. "conditions_waived") and an optional personal note; Gemini
 * composes a short plain-language message in the firm's voice. The draft
 * is returned to the lawyer for approval. Nothing sends automatically.
 *
 * Side effect: updates client_matters.matter_milestone and
 * matter_milestone_note so the record reflects the current milestone.
 *
 * Request body:
 *   { milestone: string, note?: string }
 *
 * Response:
 *   { draft: string, milestone: string }
 *
 * Auth: lawyer or operator session required (client sessions blocked).
 * Requires: GOOGLE_AI_API_KEY env var. If absent, returns 503.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getFirmSession } from '@/lib/portal-auth';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import { getMatterById } from '@/lib/matter-stage';
import { googleai, MODELS } from '@/lib/openrouter';

const DRAFT_TIMEOUT_MS = 12_000;
const MAX_DRAFT_CHARS = 600;

function buildSystemPrompt(): string {
  return (
    'You are a legal communications assistant for a Canadian law firm. ' +
    'Your job is to draft a short, plain-language client update message ' +
    'from the lawyer to their client. The message must:\n' +
    '- Be 2 to 4 sentences maximum.\n' +
    '- Be warm but professional, direct and clear.\n' +
    '- Confirm the milestone reached, explain what it means in plain language, ' +
    'and state the next step.\n' +
    '- Incorporate any personal note from the lawyer naturally.\n' +
    '- End with the lawyer\'s first name (provided).\n' +
    '- Follow LSO Rule 4.2-1: no outcome promises, no "specialist" or "expert" ' +
    'language, no superlatives, no guarantees, no result predictions.\n' +
    '- No em dashes or en dashes. Use commas, semicolons, or parentheses.\n' +
    '- No AI filler phrases: no "it is my pleasure", no "I am pleased to inform", ' +
    'no "I hope this message finds you well".\n' +
    '- Output the message body only. No subject line, no greeting prefix, ' +
    'no sign-off line separate from the lawyer name. ' +
    'Start directly with the content. Close with the lawyer first name on its own line.'
  );
}

function buildUserMessage(
  clientFirstName: string,
  matterType: string,
  milestoneLabel: string,
  milestoneNote: string | null,
  lawyerFirstName: string,
): string {
  const parts = [
    `CLIENT FIRST NAME: ${clientFirstName}`,
    `MATTER TYPE: ${matterType}`,
    `MILESTONE REACHED: ${milestoneLabel}`,
  ];
  if (milestoneNote && milestoneNote.trim().length > 0) {
    parts.push(`LAWYER NOTE (weave in naturally): ${milestoneNote.trim()}`);
  }
  parts.push(`LAWYER FIRST NAME (close with this): ${lawyerFirstName}`);
  parts.push(
    'Write the client update message now. ' +
    'Plain text only, no markdown, no bullet points.',
  );
  return parts.join('\n');
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ firmId: string; matterId: string }> },
) {
  const { firmId, matterId } = await params;

  const session = await getFirmSession(firmId);
  if (!session) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  if (session.role === 'client') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const matter = await getMatterById(matterId);
  if (!matter || matter.firm_id !== firmId) {
    return NextResponse.json({ error: 'matter not found' }, { status: 404 });
  }
  if (matter.matter_stage !== 'active') {
    return NextResponse.json(
      { error: `milestone drafts only available for active matters; stage is ${matter.matter_stage}` },
      { status: 422 },
    );
  }

  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) {
    console.error('[milestone-draft] GOOGLE_AI_API_KEY not set');
    return NextResponse.json({ error: 'ai unavailable' }, { status: 503 });
  }

  let body: { milestone?: unknown; note?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const milestone = typeof body.milestone === 'string' ? body.milestone.trim() : '';
  if (!milestone) {
    return NextResponse.json({ error: 'milestone is required' }, { status: 400 });
  }
  if (milestone.length > 120) {
    return NextResponse.json({ error: 'milestone too long (max 120 chars)' }, { status: 400 });
  }

  const note = typeof body.note === 'string' && body.note.trim().length > 0
    ? body.note.trim()
    : null;

  const clientFirstName = matter.primary_name
    ? matter.primary_name.split(' ')[0]
    : 'there';

  const { data: lawyerRow } = await supabase
    .from('firm_lawyers')
    .select('display_name')
    .eq('firm_id', firmId)
    .eq('id', session.lawyer_id ?? '')
    .maybeSingle();

  const lawyerFirstName = lawyerRow?.display_name
    ? (lawyerRow.display_name as string).split(' ')[0]
    : 'The lawyer';

  // Persist the current milestone + note before calling Gemini so the record
  // is up-to-date even if the network call fails. Not fatal to the draft
  // (the lawyer still gets a usable draft to copy), but logged rather than
  // swallowed. matter_milestone / matter_milestone_note landed in prod
  // 2026-07-02 (migrations/20260702180000_j8_client_matters_milestone_fields_schema.sql),
  // so this now persists correctly; the error path stays as a defensive guard.
  const { error: persistErr } = await supabase
    .from('client_matters')
    .update({ matter_milestone: milestone, matter_milestone_note: note })
    .eq('id', matterId);
  if (persistErr) {
    console.error('[milestone-draft] failed to persist matter_milestone', {
      matterId,
      milestone,
      error: persistErr.message,
    });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DRAFT_TIMEOUT_MS);

  let draft: string;
  try {
    const completion = await googleai.chat.completions.create(
      {
        model: MODELS.STANDARD,
        temperature: 0.4,
        max_tokens: 200,
        messages: [
          { role: 'system', content: buildSystemPrompt() },
          {
            role: 'user',
            content: buildUserMessage(
              clientFirstName,
              matter.matter_type,
              milestone,
              note,
              lawyerFirstName,
            ),
          },
        ],
      },
      { signal: controller.signal },
    );

    const raw = completion.choices?.[0]?.message?.content ?? '';
    draft = raw.trim().slice(0, MAX_DRAFT_CHARS);

    if (!draft) {
      console.error('[milestone-draft] empty response from Gemini', { matterId, milestone });
      return NextResponse.json({ error: 'draft generation failed' }, { status: 502 });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[milestone-draft] Gemini call failed', { matterId, milestone, error: message });
    return NextResponse.json({ error: 'draft generation failed' }, { status: 502 });
  } finally {
    clearTimeout(timer);
  }

  return NextResponse.json({ draft, milestone });
}
