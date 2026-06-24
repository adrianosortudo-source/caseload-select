/**
 * One-shot seed: replace the 5 DRG "Backfill" deliverable stub bodies with the
 * full published article content, sourced from the DRG website's articles.ts.
 *
 * The backfills were seeded as placeholders (brief panel + "read the live
 * article" link). This pulls the real ArticleBlock[] bodies, serializes them
 * into the same HTML vocabulary the 4 "Wk" full-article deliverables already
 * use, and updates each current version in place (the stubs had 0 comments /
 * 0 approvals, so there is nothing to preserve as version history).
 *
 * Run: npx tsx scripts/seed-drg-backfill-bodies.mts
 * Env: reads NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from .env.local
 */

import { writeFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createClient } from "@supabase/supabase-js";
// Cross-project type-only import: the DRG website source lives beside this app
// under 06_Clients. articles.ts is pure data (no imports). The runtime value is
// pulled via dynamic import in main() to survive ESM/CJS interop.
import type {
  Article,
  ArticleBlock,
} from "../../../06_Clients/DRGLaw/03_Authority/Website/drg-law-website/src/lib/articles";

const ARTICLES_MODULE =
  "../../../06_Clients/DRGLaw/03_Authority/Website/drg-law-website/src/lib/articles";

const __dirname = dirname(fileURLToPath(import.meta.url));

let articles: Article[] = [];
const EMDASH = "—";

// slug -> { deliverableId, versionId (current) }
const MAP: Record<string, { deliverableId: string; versionId: string }> = {
  "read-before-sign-ontario": {
    deliverableId: "bf0b6c67-3203-414f-b58a-082fc7f093d4",
    versionId: "c5932402-a799-41cf-b8b1-9158b1ae5d2e",
  },
  "commercial-lease-clauses-ontario": {
    deliverableId: "33493ae8-1d58-4931-913c-2dc66e58a086",
    versionId: "ccb80851-fad7-4e7d-ad77-28742bff3ec6",
  },
  "personal-guarantee-commercial-lease-ontario": {
    deliverableId: "295535a5-e32b-4e6b-bb1c-26feca508507",
    versionId: "219a1411-8b08-43c6-b324-fe0156e15164",
  },
  "share-or-asset-purchase-structure-decision": {
    deliverableId: "8e4187dc-d362-4997-b25e-f17e8066a963",
    versionId: "f1a8721a-4014-4e80-bd04-96ab2839fbfa",
  },
  "offer-stage-questions-real-estate-lawyer": {
    deliverableId: "c7f21b02-2a5e-41df-ad40-a6104d6678a2",
    versionId: "78deafec-5884-4d68-bd2e-a767e97b4ce8",
  },
};

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function titleForSlug(slug: string): string {
  const a = articles.find((x) => x.slug === slug);
  return a ? a.title : "Read the full breakdown";
}

function renderBlock(b: ArticleBlock): string {
  switch (b.type) {
    case "brief": {
      const label = esc(b.label ?? "Before you sign");
      const items = b.items
        .map(
          (it) =>
            `<li><strong>${esc(it.key.replace(/\.$/, ""))}.</strong> ${esc(it.text)}</li>`,
        )
        .join("");
      return `<blockquote><h3>${label}</h3><ul>${items}</ul></blockquote>`;
    }
    case "h2":
      return `<h2>${esc(b.text)}</h2>`;
    case "h3":
      return `<h3>${esc(b.text)}</h3>`;
    case "p":
      return `<p>${esc(b.text)}</p>`;
    case "list":
      return `<ul>${b.items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`;
    case "callout":
      return `<blockquote><p><em>${esc(b.label)}</em></p><p>${esc(b.text)}</p></blockquote>`;
    case "divider":
      return `<p>${EMDASH}</p>`;
    case "clusterRef": {
      const label = esc(b.label ?? "Full breakdown");
      const title = esc(titleForSlug(b.slug));
      return `<p><strong>${label}:</strong> <a href="https://drglaw.ca/journal/${esc(
        b.slug,
      )}">${title}</a></p>`;
    }
    default:
      return "";
  }
}

function serialize(a: Article): string {
  let html = a.body.map(renderBlock).join("");
  if (a.decisionBox && a.decisionBox.steps.length) {
    html +=
      `<h2>${esc(a.decisionBox.title)}</h2><ol>` +
      a.decisionBox.steps.map((s) => `<li>${esc(s)}</li>`).join("") +
      `</ol>`;
  }
  if (a.faqs && a.faqs.length) {
    html += `<h2>Common questions</h2>`;
    for (const f of a.faqs) html += `<h3>${esc(f.q)}</h3><p>${esc(f.a)}</p>`;
  }
  return html;
}

// Dollar-quote tag: legal prose will never contain this token, so it safely
// encloses the HTML without any single-quote escaping.
const DQ = "$drgseed$";

async function main() {
  const mod: Record<string, unknown> = await import(ARTICLES_MODULE);
  const loaded = (mod.articles ?? (mod.default as Record<string, unknown>)?.articles) as
    | Article[]
    | undefined;
  if (!loaded || !Array.isArray(loaded)) {
    throw new Error("could not load `articles` export from the DRG articles module");
  }
  articles = loaded;

  const stmts: string[] = ["BEGIN;"];
  const report: string[] = [];

  for (const [slug, ids] of Object.entries(MAP)) {
    const a = articles.find((x) => x.slug === slug);
    if (!a) throw new Error(`article not found in articles.ts: ${slug}`);
    const html = serialize(a);
    if (html.includes(DQ)) throw new Error(`delimiter collision in ${slug}`);

    stmts.push(
      `UPDATE deliverable_versions SET body_html = ${DQ}${html}${DQ} WHERE id = '${ids.versionId}';`,
    );
    const meta = [
      `excerpt = ${DQ}${a.excerpt}${DQ}`,
      `byline = ${DQ}${a.byline}${DQ}`,
      `topic = ${DQ}${a.topic}${DQ}`,
      a.readTime ? `read_time = ${DQ}${a.readTime}${DQ}` : null,
      `publish_date = '${a.date}'`,
      `updated_at = now()`,
    ]
      .filter(Boolean)
      .join(", ");
    stmts.push(
      `UPDATE content_deliverables SET ${meta} WHERE id = '${ids.deliverableId}';`,
    );
    report.push(`  ${slug}: ${html.length} chars  -> v ${ids.versionId}`);
  }
  stmts.push("COMMIT;");

  const out = join(__dirname, "_seed-drg-backfill-bodies.sql");
  writeFileSync(out, stmts.join("\n") + "\n", "utf8");
  console.log(`Wrote ${out}`);
  console.log(report.join("\n"));

  // Apply directly (run with dangerouslyDisableSandbox so egress is allowed).
  const { url, key } = loadEnv();
  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  for (const [slug, ids] of Object.entries(MAP)) {
    const a = articles.find((x) => x.slug === slug)!;
    const html = serialize(a);
    const { error: vErr } = await supabase
      .from("deliverable_versions")
      .update({ body_html: html })
      .eq("id", ids.versionId);
    if (vErr) throw new Error(`version update failed (${slug}): ${vErr.message}`);
    const meta: Record<string, unknown> = {
      excerpt: a.excerpt,
      byline: a.byline,
      topic: a.topic,
      publish_date: a.date,
      updated_at: new Date().toISOString(),
    };
    if (a.readTime) meta.read_time = a.readTime;
    const { error: dErr } = await supabase
      .from("content_deliverables")
      .update(meta)
      .eq("id", ids.deliverableId);
    if (dErr) throw new Error(`deliverable update failed (${slug}): ${dErr.message}`);
    console.log(`  applied ${slug}`);
  }
  console.log("Done. 5 backfill bodies replaced with full article content.");
}

function loadEnv(): { url: string; key: string } {
  const raw = readFileSync(join(__dirname, "..", ".env.local"), "utf8");
  const get = (name: string): string => {
    const m = raw.match(new RegExp(`^${name}\\s*=\\s*(.+)$`, "m"));
    if (!m) throw new Error(`${name} not found in .env.local`);
    return m[1].trim().replace(/^["']|["']$/g, "");
  };
  return { url: get("NEXT_PUBLIC_SUPABASE_URL"), key: get("SUPABASE_SERVICE_ROLE_KEY") };
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
