/**
 * Records the calibration panel's scored structure as an offline fixture.
 *
 * The live acceptance script cannot run in PR CI: it needs a server, network
 * access to 28 third-party sites, and it is flaky when a domain is down. This
 * captures only what the scoring math consumes (per-category score and
 * maxScore, plus the eligibility gate inputs) so a test can reproduce every
 * headline score offline and fail loudly if weights, caps or bands change
 * without the panel being re-recorded.
 *
 * Re-record deliberately, roughly quarterly or after any intended scoring
 * change:  node scripts/seo-check-record-calibration-fixture.mjs
 *
 * Requires the dev server on http://localhost:3000.
 */
import fs from "node:fs";
import path from "node:path";

const PANEL = [
  "6ixestatesllp.com", "amslegal.ca", "barristerslinks.com", "btlegal.ca",
  "btorreslaw.com", "concordelaw.ca", "dosslaw.ca", "downandco.com",
  "ferrarijaeger.com", "glaholt.com", "gmalaw.ca", "homelifelandmark.com",
  "jrmlaw.ca", "jsmandlaw.com", "lawforyou.ca", "lvmslaw.com", "lwlaw.com",
  "mehtalawyer.ca", "negilawoffice.com", "negotiables.ca", "peddlepollard.ca",
  "pefferslaw.ca", "reanolaw.com", "sorbaralaw.com", "victoriaxulaw.com",
  "vikramlaw.ca", "whiteolivelegal.com", "drglaw.ca",
];

const entries = [];
for (const domain of PANEL) {
  try {
    const res = await fetch("http://localhost:3000/api/tools/seo-check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ domain, maxPages: 1 }),
    });
    const j = await res.json();
    if (j.error) { console.log(`SKIP ${domain}: ${j.error.slice(0, 60)}`); continue; }
    const tech = j.categories.find((c) => c.name === "Technical & Security");
    const idx = j.categories.find((c) => c.name === "Indexability");
    const item = (cat, label) => cat?.items.find((i) => i.label === label)?.status ?? null;
    entries.push({
      domain,
      overallScore: j.overallScore,
      grade: j.grade,
      categories: j.categories.map((c) => ({ name: c.name, score: c.score, maxScore: c.maxScore })),
      gates: {
        httpsStatus: item(tech, "HTTPS"),
        indexableStatus: item(idx, "Indexable"),
        robotsStatus: item(idx, "robots.txt crawl access"),
        renderingRisk: j.renderingSummary?.risk ?? "low",
      },
    });
    console.log(`recorded ${domain} ${j.overallScore} ${j.grade}`);
  } catch (e) {
    console.log(`SKIP ${domain}: ${e.message}`);
  }
  await new Promise((r) => setTimeout(r, 1000));
}

if (entries.length < 22) {
  console.error(`Only ${entries.length} sites recorded; refusing to write a thin fixture.`);
  process.exit(1);
}

const out = path.join("src", "app", "api", "tools", "seo-check", "__tests__", "__fixtures__", "calibration-panel.json");
fs.writeFileSync(out, JSON.stringify({ recordedCount: entries.length, entries }, null, 2) + "\n");
console.log(`\nwrote ${out} with ${entries.length} entries`);
