import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { buildStructuredBrief } from '../../src/lib/desired-client/brief';
import type { DesiredClientAnswers } from '../../src/lib/desired-client/types';

async function main() {
const root = process.cwd();
const spec = await readFile(path.join(root, 'docs/desired-client-v2/spec/04_ACCEPTANCE_AND_REVIEW.md'), 'utf8');
const match = spec.match(/```json\s*([\s\S]*?)```/);
if (!match) throw new Error('The fixed B0 fixture is absent');
const baseline = JSON.parse(match[1]) as DesiredClientAnswers;
const copy = () => structuredClone(baseline);
const fixtures: { id: string; answers: DesiredClientAnswers }[] = [{ id: 'P01', answers: copy() }];
const future = copy();
future.focus.work = 'business_acquisitions'; future.focus.route = 'new';
future.value.reasons = ['client_benefit', 'direction']; future.value.fee_effort = 'unknown';
future.delivery.capacity = 'change'; future.direction.aim = 'new_area';
future.direction.evidence = ['preference']; future.client.concerns = ['time'];
fixtures.push({ id: 'P02', answers: future });
const conflict = copy(); conflict.value.fee_effort = 'difficult';
fixtures.push({ id: 'P03', answers: conflict });
const unknown = copy();
unknown.focus = { area: 'other', work: 'other', work_other: '', service_area: '', certainty: 'chosen', route: 'exploring', comparison: null };
unknown.situation.role = 'unknown'; unknown.client.goals = ['unknown']; unknown.client.concerns = [];
unknown.value.reasons = ['undecided']; unknown.value.fee_effort = 'unknown';
unknown.delivery.conditions = []; unknown.delivery.capacity = 'unknown';
unknown.direction.aim = 'unknown'; unknown.direction.evidence = ['preference'];
fixtures.push({ id: 'P04', answers: unknown });
const communication = copy(); communication.delivery.conditions = ['communication', 'scope']; communication.delivery.limit = 'communication';
fixtures.push({ id: 'P05', answers: communication });
const comparison = copy();
comparison.focus.work = 'business_acquisitions'; comparison.focus.certainty = 'provisional'; comparison.focus.route = 'new';
comparison.focus.comparison = {
  a: { work: 'business_agreements', fee_effort: 'worthwhile', team_fit: 'proven', capacity: 'room', evidence: 'repeated' },
  b: { work: 'business_acquisitions', fee_effort: 'unknown', team_fit: 'stretch', capacity: 'change', evidence: 'none' }, selected: 'b',
};
comparison.value.fee_effort = 'unknown'; comparison.delivery.capacity = 'change';
comparison.direction.aim = 'new_area'; comparison.direction.evidence = ['preference'];
fixtures.push({ id: 'P08', answers: comparison });
const ranges = copy(); ranges.value.collected_fee = '15to50'; ranges.value.team_hours = '41to100'; ranges.value.payment = 'varies';
fixtures.push({ id: 'P09', answers: ranges });
const results = fixtures.map(({ id, answers }) => ({ id, answers, brief: buildStructuredBrief(answers) }));
await mkdir(path.join(root, 'docs/desired-client-v2/review'), { recursive: true });
await writeFile(path.join(root, 'docs/desired-client-v2/review/structured-fixtures.json'), JSON.stringify(results, null, 2) + '\n');
for (const result of results) console.log(JSON.stringify({
  id: result.id, definition: result.brief.definition.text, kind: result.brief.definition.kind,
  checks: result.brief.open_questions.map(s => s.text),
}));


}
void main();
