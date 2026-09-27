import { CandidateContractError, parseCandidateHistoryItem, type CandidateHistoryItem } from "./prospect-enrichment-candidate-contract";
export type CandidateRevisionChunk = Readonly<{ candidateId: string; revisionId: string; coverageRevision: number; offset: number; nextOffset: number | null; chunk: string; totalCharacters: number; contentSha256: string }>;
const MAX_CHARACTERS = 80_000_000;
export function parseCandidateRevisionChunk(value: unknown): CandidateRevisionChunk {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new CandidateContractError();
  const row = value as Record<string, unknown>, uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (typeof row.candidateId !== "string" || !uuid.test(row.candidateId) || typeof row.revisionId !== "string" || !uuid.test(row.revisionId) || typeof row.chunk !== "string" || typeof row.contentSha256 !== "string" || !/^[a-f0-9]{64}$/.test(row.contentSha256)) throw new CandidateContractError();
  for (const key of ["coverageRevision", "offset", "totalCharacters"]) if (!Number.isSafeInteger(row[key]) || (row[key] as number) < 0) throw new CandidateContractError();
  const offset = row.offset as number, total = row.totalCharacters as number, length = Array.from(row.chunk).length;
  if (total < 1 || total > MAX_CHARACTERS || offset >= total || offset % 65536 !== 0 || length !== Math.min(65536, total - offset) || row.nextOffset !== (offset + length < total ? offset + length : null)) throw new CandidateContractError();
  return { candidateId: row.candidateId, revisionId: row.revisionId, coverageRevision: row.coverageRevision as number, offset, nextOffset: row.nextOffset as number | null, chunk: row.chunk, totalCharacters: total, contentSha256: row.contentSha256 };
}
/** Bounded transport preserves the complete immutable revision, including large held source bodies. */
export async function loadCandidateRevision(candidateId: string, revisionId: string, coverageRevision: number, request: typeof fetch = fetch): Promise<CandidateHistoryItem> {
  const pieces: string[] = []; let offset: number | null = 0, expectedHash: string | null = null, expectedTotal: number | null = null;
  while (offset !== null) {
    const response = await request(`/api/admin/prospect-enrichment/candidates/${encodeURIComponent(candidateId)}/history/${encodeURIComponent(revisionId)}/content?coverageRevision=${coverageRevision}&offset=${offset}`, { cache: "no-store" });
    if (!response.ok) throw new Error("Retained revision could not be read completely. Retry this evidence view.");
    const chunk = parseCandidateRevisionChunk(await response.json());
    if (chunk.candidateId !== candidateId || chunk.revisionId !== revisionId || chunk.coverageRevision !== coverageRevision || chunk.offset !== offset || (expectedHash !== null && chunk.contentSha256 !== expectedHash) || (expectedTotal !== null && chunk.totalCharacters !== expectedTotal)) throw new Error("Retained revision changed or returned unrelated evidence.");
    expectedHash = chunk.contentSha256; expectedTotal = chunk.totalCharacters; pieces.push(chunk.chunk); offset = chunk.nextOffset;
  }
  const content = pieces.join("");
  const actual = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(content)))).map(byte => byte.toString(16).padStart(2, "0")).join("");
  if (actual !== expectedHash) throw new Error("Retained revision checksum did not match. Evidence remains unverified.");
  const result = parseCandidateHistoryItem(JSON.parse(content));
  if (result.id !== revisionId || result.candidateId !== candidateId || result.contentDeferred) throw new Error("Retained revision identity is incomplete.");
  return result;
}

export async function candidateFieldReference(revisionId: string, pointer: string): Promise<URLSearchParams> {
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(pointer)))).map(byte => byte.toString(16).padStart(2, "0")).join("");
  return new URLSearchParams({ cr_fieldRefRevision: revisionId, cr_fieldRefPointerSha256: digest });
}
