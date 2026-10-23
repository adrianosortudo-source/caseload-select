/** Same-input, network-free replay of two independently captured pages per firm.
 * Not a reproduction of the full live scan or evidence of search performance.
 * Requires ignored baseline-engine and source-evidence captured during this audit.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import * as currentCore from '../src/app/api/tools/seo-check/engine-core';
import * as currentChecks from '../src/app/api/tools/seo-check/page-checks';
import * as currentRendering from '../src/app/api/tools/seo-check/rendering-analysis';
import { buildIssues } from '../src/app/api/tools/seo-check/analysis';

async function main() {
  const root = resolve('test-results/seo-lawyer-report');
  const source = join(root, 'source-evidence');
  const output = join(root, 'replay');
  mkdirSync(output, { recursive: true });
  const oldCore = await import(pathToFileURL(join(root, 'baseline-engine/engine-core.ts')).href);
  const oldChecks = await import(pathToFileURL(join(root, 'baseline-engine/page-checks.ts')).href);
  const oldRendering = await import(pathToFileURL(join(root, 'baseline-engine/rendering-analysis.ts')).href);
  const captures = JSON.parse(readFileSync(join(source, 'independent-verification.json'), 'utf8'));
  const matrix = [];
  for (const capture of captures) {
    const robots = readFileSync(join(source, `${capture.domain}-robots.txt`), 'utf8');
    const requests = capture.requests.filter((request: { label: string }) => request.label !== 'robots');
    const inputs = requests.map((request: { label: string; url: string; finalUrl: string }) => {
      const html = readFileSync(join(source, `${capture.domain}-${request.label}.html`), 'utf8');
      const headerText = readFileSync(join(source, `${capture.domain}-${request.label}.headers.txt`), 'utf8');
      const headers = new Headers();
      for (const line of headerText.split(/\r?\n/).slice(3)) {
        const index = line.indexOf(':');
        if (index > 0) headers.append(line.slice(0, index).trim(), line.slice(index + 1).trim());
      }
      return { ...request, html, headers, sha256: createHash('sha256').update(html).digest('hex') };
    });
    const makePages = (core: typeof currentCore, checks: typeof currentChecks) => inputs.map((input: typeof inputs[number]) => checks.buildPageResult(
      input.html, input.finalUrl, input.url, input.headers, { ms: 0, sampleCount: 0 }, input.url === input.finalUrl ? 0 : 1,
      capture.domain, core.parseRobotsTxt(robots), null, null, null,
    ));
    const beforePages = makePages(oldCore, oldChecks);
    const afterPages = makePages(currentCore, currentChecks);
    const beforeCategories = oldChecks.aggregateCategories(beforePages);
    const afterCategories = currentChecks.aggregateCategories(afterPages);
    const beforeUncapped = oldCore.computeWeightedScore(beforeCategories);
    const before = oldCore.applyEligibilityCaps(beforeUncapped, oldCore.deriveEligibilityGates(beforeCategories, oldRendering.aggregateRenderingSummary(beforePages)?.risk));
    const after = currentCore.computeWeightedScore(afterCategories);
    const noindex = afterPages.filter(page => !page.indexability.indexable).map(page => page.url);
    assert.deepEqual(noindex, beforePages.filter((page: typeof beforePages[number]) => !page.indexability.indexable).map((page: typeof beforePages[number]) => page.url), 'Changing the method must not change these observed directives');
    const issues = buildIssues(afterPages);
    assert(!issues.some(issue => issue.id.startsWith('eligibility-')), 'New report must not synthesize a site cap');
    if (capture.domain === 'sonilaw.ca' || capture.domain === 'gosailaw.com') {
      assert.equal(afterPages[0].indexable, true);
      assert.equal(noindex.length, 1);
      assert.equal(before, 35);
      assert(!issues.filter(issue => issue.title === 'Indexable').some(issue => issue.affectedUrls.includes(afterPages[0].url)));
    }
    const snapshot = {
      domain: capture.domain, methodologyVersion: 3, scanMode: 'quick', pagesScanned: afterPages.length,
      pages: afterPages, categories: afterCategories, overallScore: after, grade: currentCore.computeGrade(after),
      aiSearchScore: null, aiSearchGrade: null, aiPolicyScore: null, aiPolicyGrade: null, aiBots: [],
      issues, topFixes: currentChecks.computeTopFixes(afterPages, 5), renderingSummary: currentRendering.aggregateRenderingSummary(afterPages),
      checkedAt: capture.capturedAt, partial: true,
    };
    writeFileSync(join(output, `${capture.domain}.json`), JSON.stringify(snapshot, null, 2));
    matrix.push({ domain: capture.domain, scope: 'Same two captured pages, not full live scan', before, beforeUncapped, after, noindex,
      pages: inputs.map((input: typeof inputs[number]) => ({ url: input.finalUrl, sha256: input.sha256 })) });
  }
  writeFileSync(join(output, 'matrix.json'), JSON.stringify(matrix, null, 2));
  console.log(JSON.stringify(matrix.map(({ pages: _pages, ...row }) => row), null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
