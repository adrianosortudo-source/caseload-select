/**
 * Pure summarizer for Firm Assist weekly stats (BUILD_PLAN_firm_assist_v1.md
 * section 8). Operates on already-fetched rows so it gets direct vitest
 * coverage without mocking Supabase.
 */

export interface AssistQueryRow {
  question: string;
  exit_type: string | null;
}

export interface AssistWeeklyStats {
  questions: number;
  answered: number;
  screen_handoffs: number;
  top_questions: Array<{ question: string; count: number }>;
}

const TOP_QUESTIONS_LIMIT = 5;

/** Case-insensitive, whitespace-collapsed key so near-duplicate phrasing groups together. */
function normalizeQuestion(question: string): string {
  return question.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function summarizeAssistQueries(rows: AssistQueryRow[]): AssistWeeklyStats {
  const counts = new Map<string, { display: string; count: number }>();
  let answered = 0;
  let screenHandoffs = 0;

  for (const row of rows) {
    if (row.exit_type === 'answered') answered++;
    if (row.exit_type === 'screen_handoff') screenHandoffs++;

    const key = normalizeQuestion(row.question);
    if (!key) continue;
    const existing = counts.get(key);
    if (existing) {
      existing.count++;
    } else {
      counts.set(key, { display: row.question.trim(), count: 1 });
    }
  }

  const top_questions = Array.from(counts.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, TOP_QUESTIONS_LIMIT)
    .map((v) => ({ question: v.display, count: v.count }));

  return {
    questions: rows.length,
    answered,
    screen_handoffs: screenHandoffs,
    top_questions,
  };
}
