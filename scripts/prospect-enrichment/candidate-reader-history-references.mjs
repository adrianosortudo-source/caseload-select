import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const PROJECT_REF = "ssxryjxifwiivghglqer";
const REFERENCE_PINS = Object.freeze([
  {
    path: "scripts/prospect-enrichment/bounded-original-ledger-reference.json",
    receipt: "scripts/prospect-enrichment/bounded-original-release-review.json",
    sha256: "164e22885c669ab59e99545bc5ec3b5acb9702ee988e2d5980846a972d433bc7",
    receiptSha256: "a0f5085a3a81d6160b67b953ae5463641af6e73722aeec9fa6d58cfdd35474d4",
    receiptSchemaVersion: "prospect-bounded-original-release/v1",
    receiptKeys: ["schemaVersion", "projectRef", "cliVersion", "reviewOnly", "approvalGranted", "migration", "ledgerReferenceSha256", "catalogPre", "catalogPost"],
    migration: {
      path: "supabase/migrations/20261013214000_prospect_bounded_original_evidence_v2.sql",
      version: "20261013214000",
      name: "prospect_bounded_original_evidence_v2",
      sha256: "0c2421f1544de099967074184e86c6079570e23f1635ba9c30a149974cc7d301",
      bytes: 24285,
    },
    field: "ledger",
  },
  {
    path: "scripts/prospect-enrichment/field-filter-ledger-reference.json",
    receipt: "scripts/prospect-enrichment/field-filter-release-review.json",
    sha256: "10a7f9ec30a99c555486f8a95e50ff4f6eac60d974923027d60a8c6ce1b3cb85",
    receiptSha256: "f7a0903962f839c5d5e7846f080a7222fb06fa47224bd520c2a60ba7ec8e8892",
    receiptSchemaVersion: "prospect-field-filter-release/v1",
    receiptKeys: ["schemaVersion", "projectRef", "cliVersion", "reviewOnly", "approvalGranted", "catalogEvidence", "migration", "prerequisite", "ledgerReferenceSha256", "catalogPre", "catalogPost"],
    migration: {
      path: "supabase/migrations/20261014153626_prospect_candidate_global_field_filter_fastpath.sql",
      version: "20261014153626",
      name: "prospect_candidate_global_field_filter_fastpath",
      sha256: "27d4fb0f03266f6fb1bb652a1ab6ce446dd819c9d7c58750e84a420aaccc5098",
      bytes: 9347,
    },
    prerequisite: {
      path: "supabase/migrations/20261013214000_prospect_bounded_original_evidence_v2.sql",
      version: "20261013214000",
      name: "prospect_bounded_original_evidence_v2",
      sha256: "0c2421f1544de099967074184e86c6079570e23f1635ba9c30a149974cc7d301",
      bytes: 24285,
    },
    catalogEvidence: "source-derived; protected preflight must verify the live production catalog",
    field: "baseline",
  },
]);
const HISTORY = Object.freeze([
  { version: "20261013173327", name: "agency_followup_journeys", statement_count: 1, statements_sha256: "5f1de5211dd150df56fa83ee6755b26c66167f92c1836f692bd02b0c2f42c6b3" },
  { version: "20261013174258", name: "harden_agency_followup_events_privileges", statement_count: 1, statements_sha256: "50d504c06bc73115bf5a68551b7f76a58f434f3a06781b91af506da879a493dd" },
]);
const fail = code => { throw Error(code); };
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const exact = (value, keys) => value !== null && typeof value === "object" && !Array.isArray(value) &&
  JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const guard = row => `-- Applied ledger reference only; historical source SQL is never replayed.\n-- ${row.version} ${row.name} statements-sha256 ${row.statements_sha256}\nDO $reader_history_reference$ BEGIN RAISE EXCEPTION 'reader_history_reference_execution_prohibited'; END $reader_history_reference$;\n`;
const filename = row => `${row.version}_${row.name}.sql`;
const rowsFrom = value => Array.isArray(value) ? value : Array.isArray(value?.data) ? value.data : Array.isArray(value?.rows) ? value.rows : fail("reader_history_query_shape_invalid");
const isWithin = (parent, child) => {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith(".." + path.sep) && relative !== ".." && !path.isAbsolute(relative));
};

export function readerHistoryQuery() {
  return "SELECT version,name,coalesce(cardinality(statements),0) AS statement_count,encode(sha256(convert_to(coalesce(to_jsonb(statements),'null'::jsonb)::text,'UTF8')),'hex') AS statements_sha256 FROM supabase_migrations.schema_migrations ORDER BY version;\n";
}

function verifyPinnedReferences(sourceRoot) {
  const found = [];
  for (const pin of REFERENCE_PINS) {
    const checkoutBytes = fs.readFileSync(path.join(sourceRoot, pin.path));
    const referenceBytes = Buffer.from(checkoutBytes.toString("utf8").replace(/\r\n/g, "\n"), "utf8");
    const receiptCheckoutBytes = fs.readFileSync(path.join(sourceRoot, pin.receipt));
    const receiptBytes = Buffer.from(receiptCheckoutBytes.toString("utf8").replace(/\r\n/g, "\n"), "utf8");
    const receipt = JSON.parse(receiptBytes.toString("utf8"));
    if (hash(referenceBytes) !== pin.sha256 || hash(receiptBytes) !== pin.receiptSha256 ||
        !exact(receipt, pin.receiptKeys) || receipt.schemaVersion !== pin.receiptSchemaVersion ||
        receipt.projectRef !== PROJECT_REF || receipt.cliVersion !== "2.117.0" || receipt.reviewOnly !== true ||
        receipt.approvalGranted !== false || receipt.ledgerReferenceSha256 !== pin.sha256 ||
        !exact(receipt.migration, ["path", "version", "name", "sha256", "bytes"]) ||
        !same(receipt.migration, pin.migration) ||
        (pin.prerequisite
          ? !exact(receipt.prerequisite, ["path", "version", "name", "sha256", "bytes"]) || !same(receipt.prerequisite, pin.prerequisite)
          : Object.hasOwn(receipt, "prerequisite")) ||
        (pin.catalogEvidence !== undefined && receipt.catalogEvidence !== pin.catalogEvidence)) fail("reader_history_reference_receipt_mismatch");
    const reference = JSON.parse(referenceBytes.toString("utf8"));
    const rows = reference?.[pin.field];
    if (reference.projectRef !== PROJECT_REF || !Array.isArray(rows) || rows.length !== 273) fail("reader_history_reference_invalid");
    const selected = HISTORY.map(expected => {
      const row = rows.find(item => item?.version === expected.version);
      if (!exact(row, ["version", "name", "statement_count", "statements_sha256"]) || !same(row, expected)) fail("reader_history_reference_rows_mismatch");
      return row;
    });
    found.push(selected);
  }
  if (!same(found[0], found[1])) fail("reader_history_reference_disagreement");
  return {
    boundedReferenceSha256: REFERENCE_PINS[0].sha256,
    fieldFilterReferenceSha256: REFERENCE_PINS[1].sha256,
    referenceHashNormalization: "UTF-8 with CRLF normalized to LF",
    receiptHashNormalization: "UTF-8 with CRLF normalized to LF",
    boundedReviewReceiptSha256: REFERENCE_PINS[0].receiptSha256,
    fieldFilterReviewReceiptSha256: REFERENCE_PINS[1].receiptSha256,
  };
}

function verifyLiveLedger(payload, sourceRoot) {
  const rows = rowsFrom(payload);
  let previous = "";
  const byVersion = new Map();
  for (const row of rows) {
    if (!exact(row, ["version", "name", "statement_count", "statements_sha256"]) ||
        typeof row.version !== "string" || row.version <= previous || !/^[a-zA-Z0-9_]+$/.test(row.name) ||
        !Number.isSafeInteger(row.statement_count) || row.statement_count < 0 || !/^[a-f0-9]{64}$/.test(row.statements_sha256)) fail("reader_history_live_ledger_invalid");
    previous = row.version;
    byVersion.set(row.version, row);
  }
  const references = verifyPinnedReferences(sourceRoot);
  for (const expected of HISTORY) {
    const row = byVersion.get(expected.version);
    if (!row || row.name !== expected.name || row.statement_count !== expected.statement_count ||
        row.statements_sha256 !== expected.statements_sha256) fail("reader_history_live_ledger_mismatch");
  }
  return { rows, references };
}

export function stageReaderHistoryReferences(payload, sourceRoot, stagedRoot) {
  const { rows, references } = verifyLiveLedger(payload, sourceRoot);
  const source = fs.realpathSync(sourceRoot);
  const stage = fs.realpathSync(stagedRoot);
  if (!path.isAbsolute(stagedRoot) || isWithin(source, stage) || isWithin(stage, source)) fail("reader_history_stage_path_prohibited");
  const directory = path.join(stagedRoot, "supabase", "migrations");
  const sourceDirectory = path.join(source, "supabase", "migrations");
  const stagedFiles = [];
  for (const row of HISTORY) {
    const file = filename(row);
    const sourcePath = path.join(sourceDirectory, file);
    const target = path.join(directory, file);
    let sourceBytes;
    try {
      const stat = fs.lstatSync(sourcePath);
      if (stat.isSymbolicLink() || !stat.isFile()) fail("reader_history_source_file_invalid");
      sourceBytes = fs.readFileSync(sourcePath);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    let targetExists = false;
    try {
      const stat = fs.lstatSync(target);
      if (stat.isSymbolicLink() || !stat.isFile()) fail("reader_history_staged_file_invalid");
      targetExists = true;
      const stagedSourceBytes = fs.readFileSync(target);
      if (!sourceBytes || !stagedSourceBytes.equals(sourceBytes)) fail("reader_history_staged_source_mismatch");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const bytes = Buffer.from(guard(row), "utf8");
    fs.writeFileSync(target, bytes, { flag: targetExists ? "w" : "wx" });
    stagedFiles.push({ filename: file, sha256: hash(bytes), sourceIncluded: targetExists, sourceSha256: targetExists ? hash(sourceBytes) : null });
  }
  return {
    schemaVersion: "candidate-reader-history-references/v1",
    remoteVersionCount: rows.length,
    references,
    history: HISTORY,
    stagedRoot: fs.realpathSync(stagedRoot),
    stagedFiles,
    compactLedger: rows.map(({ version, name }) => ({ version, name })),
  };
}

export function removeReaderHistoryReferences(sourceRoot, stagedRoot, proof) {
  const references = verifyPinnedReferences(sourceRoot);
  const source = fs.realpathSync(sourceRoot);
  const stage = fs.realpathSync(stagedRoot);
  if (!path.isAbsolute(stagedRoot) || isWithin(source, stage) || isWithin(stage, source)) fail("reader_history_stage_path_prohibited");
  if (!proof || proof.schemaVersion !== "candidate-reader-history-references/v1" ||
      proof.stagedRoot !== stage || !same(proof.references, references) ||
      !same(proof.history, HISTORY) || !Array.isArray(proof.stagedFiles) || proof.stagedFiles.length !== HISTORY.length) fail("reader_history_stage_proof_invalid");
  const directory = path.join(stagedRoot, "supabase", "migrations");
  const sourceDirectory = path.join(source, "supabase", "migrations");
  for (let index = 0; index < HISTORY.length; index++) {
    const expected = proof.stagedFiles[index];
    const row = HISTORY[index];
    const file = filename(row);
    const target = path.join(directory, file);
    const bytes = fs.readFileSync(target);
    if (!exact(expected, ["filename", "sha256", "sourceIncluded", "sourceSha256"]) || expected.filename !== file ||
        typeof expected.sourceIncluded !== "boolean" || expected.sha256 !== hash(Buffer.from(guard(row), "utf8")) ||
        hash(bytes) !== expected.sha256 || !bytes.equals(Buffer.from(guard(row), "utf8")) ||
        (expected.sourceIncluded ? !/^[a-f0-9]{64}$/.test(expected.sourceSha256 ?? "") : expected.sourceSha256 !== null)) fail("reader_history_stage_changed");
    if (expected.sourceIncluded) {
      const sourcePath = path.join(sourceDirectory, file);
      const stat = fs.lstatSync(sourcePath);
      if (stat.isSymbolicLink() || !stat.isFile()) fail("reader_history_source_file_invalid");
      const sourceBytes = fs.readFileSync(sourcePath);
      if (hash(sourceBytes) !== expected.sourceSha256) fail("reader_history_source_changed");
      fs.writeFileSync(target, sourceBytes, { flag: "w" });
      if (!fs.readFileSync(target).equals(sourceBytes)) fail("reader_history_restore_failed");
    } else {
      fs.unlinkSync(target);
    }
  }
  return { removedGuardReferences: HISTORY.map(filename), verified: true };
}
