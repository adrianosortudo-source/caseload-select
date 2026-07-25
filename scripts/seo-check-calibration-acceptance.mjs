/**
 * Calibration acceptance gate for the seo-check scoring model.
 *
 * Scans a fixed panel of 28 real Ontario law firm sites and asserts the score
 * distribution is usable: that the engine can still recognise a good site and
 * can now also fail a bad one. Thresholds come from a measured simulation
 * across four scenarios, with slack for live-site drift. The same thresholds
 * hold before and after the Phase B sameAs check, which is why both gates use
 * this one script.
 *
 * Panel widened from 21 to 28 on 2026-07-25 because the "sites below 60" check
 * was passing with zero margin: one unreachable domain on the day was enough to
 * fail an otherwise correct build. Measured on the wider panel: 8 sites below
 * 60, span 41, five grade letters.
 *
 * Requires the dev server on http://localhost:3000.
 * Usage: node scripts/seo-check-calibration-acceptance.mjs
 */
const PANEL = [
  "6ixestatesllp.com", "amslegal.ca", "barristerslinks.com", "btlegal.ca",
  "btorreslaw.com", "concordelaw.ca", "dosslaw.ca", "downandco.com",
  "ferrarijaeger.com", "glaholt.com", "gmalaw.ca", "homelifelandmark.com",
  "jrmlaw.ca", "jsmandlaw.com", "lawforyou.ca", "lvmslaw.com", "lwlaw.com",
  "mehtalawyer.ca", "negilawoffice.com", "negotiables.ca", "peddlepollard.ca",
  "pefferslaw.ca", "reanolaw.com", "sorbaralaw.com", "victoriaxulaw.com",
  "vikramlaw.ca", "whiteolivelegal.com", "drglaw.ca",
];

const results = [];
for (const domain of PANEL) {
  try {
    const res = await fetch("http://localhost:3000/api/tools/seo-check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ domain, maxPages: 1 }),
    });
    const j = await res.json();
    if (j.error) { console.log(`SKIP ${domain}: ${j.error.slice(0, 60)}`); continue; }
    results.push({ domain, score: j.overallScore, grade: j.grade });
  } catch (e) {
    console.log(`SKIP ${domain}: ${e.message}`);
  }
  await new Promise((r) => setTimeout(r, 1000));
}

results.sort((a, b) => a.score - b.score);
for (const r of results) console.log(String(r.score).padStart(3) + "  " + r.grade.padEnd(3) + "  " + r.domain);

const scores = results.map((r) => r.score);
const letters = new Set(results.map((r) => r.grade));
const drg = results.find((r) => r.domain === "drglaw.ca");
const ped = results.find((r) => r.domain === "peddlepollard.ca");

const checks = [
  ["at least 22 sites scanned", results.length >= 22, results.length],
  ["at least 4 distinct grade letters", letters.size >= 4, [...letters].join(",")],
  ["at least 5 sites below 60", scores.filter((s) => s < 60).length >= 5, scores.filter((s) => s < 60).length],
  ["score span at least 30", Math.max(...scores) - Math.min(...scores) >= 30, Math.max(...scores) - Math.min(...scores)],
  ["drglaw.ca at least 90", !!drg && drg.score >= 90, drg ? drg.score : "missing"],
  ["peddlepollard.ca at most 65", !!ped && ped.score <= 65, ped ? ped.score : "missing"],
];

let failed = 0;
console.log("");
for (const [name, ok, actual] of checks) {
  console.log((ok ? "PASS  " : "FAIL  ") + name + "  (actual: " + actual + ")");
  if (!ok) failed++;
}
process.exit(failed === 0 ? 0 : 1);
