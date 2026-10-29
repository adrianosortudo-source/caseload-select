import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createDiagnostic } from './crm-qa-diagnostics.mjs';

test('reports only allowlisted phase and bounded numeric HTTP status', () => {
  const d = createDiagnostic();
  d.phase('session_exchange'); d.status(403);
  assert.equal(d.failure(), 'CRM_QA_FAIL_ROUND=initial PHASE=session_exchange STATUS=403');
  d.round('renewal');
  d.phase('render_crm');
  assert.equal(d.failure(), 'CRM_QA_FAIL_ROUND=renewal PHASE=render_crm');
});
test('an observed API failure takes precedence over a page assertion failure', () => {
  const d = createDiagnostic();
  d.phase('render_crm'); d.status(200);
  d.renderFailure(403);
  assert.equal(d.failure(), 'CRM_QA_FAIL_ROUND=initial PHASE=render_api STATUS=403');
  d.phase('render_crm'); d.status(200); d.renderFailure(undefined);
  assert.equal(d.failure(), 'CRM_QA_FAIL_ROUND=initial PHASE=render_crm STATUS=200');
  d.renderFailure('403 secret');
  assert.equal(d.failure(), 'CRM_QA_FAIL_ROUND=initial PHASE=render_crm STATUS=200');
});
test('workflow filter emits only complete allowlisted diagnostic lines', () => {
  const workflow = readFileSync(new URL('../.github/workflows/crm-console-read-qa.yml', import.meta.url), 'utf8');
  const condition = workflow.split(/\r?\n/).find(line => line.trim().startsWith('if [[ "$line" =~ ^CRM_QA_FAIL_ROUND='));
  assert.ok(condition, 'workflow filter exists');
  const script = `while IFS= read -r line; do\n${condition.trim()}\n echo "$line"\n fi\ndone`;
  const input = ['CRM_QA_FAIL_ROUND=initial PHASE=session_exchange STATUS=403', 'CRM_QA_FAIL_ROUND=renewal PHASE=render_crm', 'CRM_QA_FAIL_ROUND=initial PHASE=guard token=synthetic', 'CRM_QA_FAIL_ROUND=initial PHASE=guard STATUS=999', 'secret cookie body', 'CRM_QA_FAIL_ROUND=initial PHASE=guard STATUS=200 extra'].join('\n');
  const shell = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
  const result = spawnSync(shell, ['-c', script], { input, encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0);
  assert.deepEqual(result.stdout.trim().split(/\r?\n/), ['CRM_QA_FAIL_ROUND=initial PHASE=session_exchange STATUS=403', 'CRM_QA_FAIL_ROUND=renewal PHASE=render_crm']);
});
test('untrusted strings, URLs, tokens, raw errors and invalid status cannot appear', () => {
  const d = createDiagnostic();
  for (const value of ['secret\nCRM_QA_PASS', 'https://example.test/?token=secret', { message: 'cookie=secret' }, undefined]) {
    d.phase(value); d.status(value);
    d.round(value);
    assert.equal(d.failure(), 'CRM_QA_FAIL_ROUND=initial PHASE=guard');
  }
  for (const value of [99, 600, -1, 200.1, '403', NaN, Infinity]) {
    d.status(value); assert.equal(d.failure(), 'CRM_QA_FAIL_ROUND=initial PHASE=guard');
  }
});
