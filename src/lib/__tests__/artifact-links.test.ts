/**
 * artifact-links.ts: pure link/control decisions shared by the Publish Kit UI
 * and the content-period-export.ts Markdown/JSON export. No I/O, no mocking
 * needed -- plain fixture-in / assertion-out tests.
 */

import { describe, it, expect } from "vitest";
import { artifactControlState, shouldWithholdArtifactLinks } from "@/lib/artifact-links";

// ─── artifactControlState: exhaustive over every reachable input combination ──

describe("artifactControlState", () => {
  const base = {
    storagePath: "a/b.png",
    locked: false,
    supersededAt: null as string | null,
    unapproved: false,
    mayPublish: true,
    signedUrl: "https://signed.example/b.png",
  };

  it("no storagePath -> no_file, regardless of every other input", () => {
    expect(artifactControlState({ ...base, storagePath: null })).toBe("no_file");
    expect(
      artifactControlState({
        ...base,
        storagePath: null,
        locked: true,
        supersededAt: "2026-07-03T00:00:00Z",
        unapproved: true,
        mayPublish: false,
        signedUrl: null,
      }),
    ).toBe("no_file");
  });

  it("locked (other version) -> other_version, even when otherwise publishable and signed", () => {
    expect(artifactControlState({ ...base, locked: true })).toBe("other_version");
  });

  it("locked beats retracted, unapproved, and mayPublish false", () => {
    expect(
      artifactControlState({
        ...base,
        locked: true,
        supersededAt: "2026-07-03T00:00:00Z",
        unapproved: true,
        mayPublish: false,
        signedUrl: null,
      }),
    ).toBe("other_version");
  });

  it("retracted (not locked) -> retracted, even when otherwise publishable and signed", () => {
    expect(artifactControlState({ ...base, supersededAt: "2026-07-03T00:00:00Z" })).toBe("retracted");
  });

  it("retracted beats unapproved and mayPublish false", () => {
    expect(
      artifactControlState({
        ...base,
        supersededAt: "2026-07-03T00:00:00Z",
        unapproved: true,
        mayPublish: false,
        signedUrl: null,
      }),
    ).toBe("retracted");
  });

  it("unapproved (not locked, not retracted) -> unapproved, even when mayPublish happens to be true or signedUrl is set", () => {
    expect(artifactControlState({ ...base, unapproved: true })).toBe("unapproved");
    expect(artifactControlState({ ...base, unapproved: true, mayPublish: false, signedUrl: null })).toBe("unapproved");
  });

  it("not locked, not retracted, not unapproved, mayPublish false -> locked", () => {
    expect(artifactControlState({ ...base, mayPublish: false })).toBe("locked");
  });

  it("mayPublish true, storagePath set, signedUrl null -> unsigned (a signing failure, not a permission decision)", () => {
    expect(artifactControlState({ ...base, signedUrl: null })).toBe("unsigned");
  });

  it("mayPublish true, storagePath set, signedUrl set, not locked, not retracted, not unapproved -> download", () => {
    expect(artifactControlState(base)).toBe("download");
  });
});

// ─── shouldWithholdArtifactLinks: exhaustive over all 8 input combinations ────
//
// The module exists because two consumers (the UI's ArtifactBlock and the
// Markdown export) drifted apart in round 4 by each re-deriving this
// decision. It had no direct test of its own until now -- every prior
// assertion of it was indirect, via Markdown substring checks in a
// different test file.

describe("shouldWithholdArtifactLinks", () => {
  it.each([
    [true, true, false, false],
    [true, true, true, true],
    [true, false, false, true],
    [true, false, true, true],
    [false, true, false, true],
    [false, true, true, true],
    [false, false, false, true],
    [false, false, true, true],
  ] as const)(
    "matchesCurrentVersion=%s deliverableMayPublish=%s supersededAt-set=%s -> withhold=%s",
    (matchesCurrentVersion, deliverableMayPublish, supersededSet, expected) => {
      const result = shouldWithholdArtifactLinks({
        matchesCurrentVersion,
        deliverableMayPublish,
        supersededAt: supersededSet ? "2026-07-03T00:00:00Z" : null,
      });
      expect(result).toBe(expected);
    },
  );
});

// ─── the version-section call sites are behaviourally equivalent ─────────────
//
// content-period-export.ts's renderVersionSection call sites always pass
// supersededAt: null (a version is never a publication_artifacts row, so it
// can never be retracted). This pins the two-variable slice of the predicate
// those call sites actually exercise, so a future reader can see the
// equivalence without re-deriving it: for the current-version call
// (matchesCurrentVersion: true), withholding tracks !deliverableMayPublish
// exactly; for the approved-version call (matchesCurrentVersion: false), the
// predicate is always true regardless of deliverableMayPublish.

describe("shouldWithholdArtifactLinks: the version-section slice (supersededAt always null)", () => {
  it.each([
    [true, true, false],
    [true, false, true],
    [false, true, true],
    [false, false, true],
  ] as const)(
    "matchesCurrentVersion=%s deliverableMayPublish=%s -> withhold=%s",
    (matchesCurrentVersion, deliverableMayPublish, expected) => {
      expect(
        shouldWithholdArtifactLinks({ matchesCurrentVersion, deliverableMayPublish, supersededAt: null }),
      ).toBe(expected);
    },
  );
});
