import { describe, it, expect } from "vitest";
import {
  validateClientListSubmission,
  clientListStatusLabel,
  deriveClientListCheck,
  MAX_CLIENT_LIST_FILES,
  MAX_CLIENT_LIST_FILE_BYTES,
} from "../firm-onboarding-client-list";

const TOKEN = "DRG-LAW-2026-07-22";
const PREFIX = `${encodeURIComponent(TOKEN)}/`;

function validFile(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    storage_path: `${PREFIX}profile/1-list.csv`,
    original_name: "list.csv",
    size_bytes: 1024,
    mime_type: "text/csv",
    ...overrides,
  };
}

describe("validateClientListSubmission", () => {
  it("rejects a missing path", () => {
    const result = validateClientListSubmission({}, TOKEN);
    expect(result).toEqual({
      ok: false,
      error: "client_list_path is required (share_with_us or self_upload)",
    });
  });

  it("rejects an unknown path value", () => {
    const result = validateClientListSubmission({ client_list_path: "email_it" }, TOKEN);
    expect(result).toEqual({
      ok: false,
      error: "client_list_path is required (share_with_us or self_upload)",
    });
  });

  it("rejects missing attestation on the share_with_us path", () => {
    const result = validateClientListSubmission(
      { client_list_path: "share_with_us", client_list_files: [validFile()] },
      TOKEN,
    );
    expect(result).toEqual({ ok: false, error: "the consent attestation is required" });
  });

  it("rejects false attestation on the self_upload path", () => {
    const result = validateClientListSubmission(
      { client_list_path: "self_upload", client_list_attested: false, client_list_self_upload_confirmed: true },
      TOKEN,
    );
    expect(result).toEqual({ ok: false, error: "the consent attestation is required" });
  });

  it("share: rejects an empty files array", () => {
    const result = validateClientListSubmission(
      { client_list_path: "share_with_us", client_list_attested: true, client_list_files: [] },
      TOKEN,
    );
    expect(result).toEqual({
      ok: false,
      error: "at least one uploaded file is required on the share_with_us path",
    });
  });

  it("share: rejects a missing files field", () => {
    const result = validateClientListSubmission(
      { client_list_path: "share_with_us", client_list_attested: true },
      TOKEN,
    );
    expect(result).toEqual({
      ok: false,
      error: "at least one uploaded file is required on the share_with_us path",
    });
  });

  it("share: rejects 11 files (over the cap of 10)", () => {
    const files = Array.from({ length: MAX_CLIENT_LIST_FILES + 1 }, (_, i) =>
      validFile({ storage_path: `${PREFIX}profile/${i}-list.csv` }),
    );
    const result = validateClientListSubmission(
      { client_list_path: "share_with_us", client_list_attested: true, client_list_files: files },
      TOKEN,
    );
    expect(result).toEqual({ ok: false, error: "too many files; max 10" });
  });

  it("share: rejects a storage_path with a different token prefix", () => {
    const result = validateClientListSubmission(
      {
        client_list_path: "share_with_us",
        client_list_attested: true,
        client_list_files: [validFile({ storage_path: "OTHER-TOKEN/profile/1-list.csv" })],
      },
      TOKEN,
    );
    expect(result).toEqual({ ok: false, error: "invalid file entry" });
  });

  it("share: rejects size_bytes of 0", () => {
    const result = validateClientListSubmission(
      {
        client_list_path: "share_with_us",
        client_list_attested: true,
        client_list_files: [validFile({ size_bytes: 0 })],
      },
      TOKEN,
    );
    expect(result).toEqual({ ok: false, error: "invalid file entry" });
  });

  it("share: rejects a negative size_bytes", () => {
    const result = validateClientListSubmission(
      {
        client_list_path: "share_with_us",
        client_list_attested: true,
        client_list_files: [validFile({ size_bytes: -5 })],
      },
      TOKEN,
    );
    expect(result).toEqual({ ok: false, error: "invalid file entry" });
  });

  it("share: rejects size_bytes over the 50 MB cap", () => {
    const result = validateClientListSubmission(
      {
        client_list_path: "share_with_us",
        client_list_attested: true,
        client_list_files: [validFile({ size_bytes: MAX_CLIENT_LIST_FILE_BYTES + 1 })],
      },
      TOKEN,
    );
    expect(result).toEqual({ ok: false, error: "invalid file entry" });
  });

  it("share: rejects a non-integer size_bytes", () => {
    const result = validateClientListSubmission(
      {
        client_list_path: "share_with_us",
        client_list_attested: true,
        client_list_files: [validFile({ size_bytes: 1024.5 })],
      },
      TOKEN,
    );
    expect(result).toEqual({ ok: false, error: "invalid file entry" });
  });

  it("share: rejects an empty original_name", () => {
    const result = validateClientListSubmission(
      {
        client_list_path: "share_with_us",
        client_list_attested: true,
        client_list_files: [validFile({ original_name: "" })],
      },
      TOKEN,
    );
    expect(result).toEqual({ ok: false, error: "invalid file entry" });
  });

  it("share: rejects an original_name over 200 characters", () => {
    const result = validateClientListSubmission(
      {
        client_list_path: "share_with_us",
        client_list_attested: true,
        client_list_files: [validFile({ original_name: "a".repeat(201) })],
      },
      TOKEN,
    );
    expect(result).toEqual({ ok: false, error: "invalid file entry" });
  });

  it("share: accepts a valid single-file submission and normalises selfUploadConfirmed to false", () => {
    const result = validateClientListSubmission(
      { client_list_path: "share_with_us", client_list_attested: true, client_list_files: [validFile()] },
      TOKEN,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.path).toBe("share_with_us");
      expect(result.value.files).toHaveLength(1);
      expect(result.value.selfUploadConfirmed).toBe(false);
    }
  });

  it("share: accepts a valid 10-file submission (at the cap)", () => {
    const files = Array.from({ length: MAX_CLIENT_LIST_FILES }, (_, i) =>
      validFile({ storage_path: `${PREFIX}profile/${i}-list.csv` }),
    );
    const result = validateClientListSubmission(
      { client_list_path: "share_with_us", client_list_attested: true, client_list_files: files },
      TOKEN,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.files).toHaveLength(MAX_CLIENT_LIST_FILES);
    }
  });

  it("share: accepts a null mime_type", () => {
    const result = validateClientListSubmission(
      {
        client_list_path: "share_with_us",
        client_list_attested: true,
        client_list_files: [validFile({ mime_type: null })],
      },
      TOKEN,
    );
    expect(result.ok).toBe(true);
  });

  it("self: rejects an unconfirmed self-upload", () => {
    const result = validateClientListSubmission(
      { client_list_path: "self_upload", client_list_attested: true, client_list_self_upload_confirmed: false },
      TOKEN,
    );
    expect(result).toEqual({ ok: false, error: "self-upload confirmation is required" });
  });

  it("self: rejects a missing confirmation field", () => {
    const result = validateClientListSubmission(
      { client_list_path: "self_upload", client_list_attested: true },
      TOKEN,
    );
    expect(result).toEqual({ ok: false, error: "self-upload confirmation is required" });
  });

  it("self: rejects attached files", () => {
    const result = validateClientListSubmission(
      {
        client_list_path: "self_upload",
        client_list_attested: true,
        client_list_self_upload_confirmed: true,
        client_list_files: [validFile()],
      },
      TOKEN,
    );
    expect(result).toEqual({ ok: false, error: "files cannot be attached on the self_upload path" });
  });

  it("self: accepts a confirmed submission with no files, normalising files to an empty array", () => {
    const result = validateClientListSubmission(
      { client_list_path: "self_upload", client_list_attested: true, client_list_self_upload_confirmed: true },
      TOKEN,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.path).toBe("self_upload");
      expect(result.value.files).toEqual([]);
      expect(result.value.selfUploadConfirmed).toBe(true);
    }
  });

  it("self: accepts a confirmed submission with an explicit empty files array", () => {
    const result = validateClientListSubmission(
      {
        client_list_path: "self_upload",
        client_list_attested: true,
        client_list_self_upload_confirmed: true,
        client_list_files: [],
      },
      TOKEN,
    );
    expect(result.ok).toBe(true);
  });
});

describe("clientListStatusLabel", () => {
  it("returns 'deleted' when the working copy has been deleted, even if also verified", () => {
    expect(
      clientListStatusLabel({
        client_list_path: "share_with_us",
        client_list_files: [validFile()],
        client_list_import_verified_at: "2026-07-22T00:00:00Z",
        client_list_working_copy_deleted_at: "2026-07-23T00:00:00Z",
      }),
    ).toBe("deleted");
  });

  it("returns 'verified' when verified and not deleted", () => {
    expect(
      clientListStatusLabel({
        client_list_path: "share_with_us",
        client_list_files: [validFile()],
        client_list_import_verified_at: "2026-07-22T00:00:00Z",
        client_list_working_copy_deleted_at: null,
      }),
    ).toBe("verified");
  });

  it("returns 'self-upload' for the self_upload path when not verified or deleted", () => {
    expect(
      clientListStatusLabel({
        client_list_path: "self_upload",
        client_list_files: null,
        client_list_import_verified_at: null,
        client_list_working_copy_deleted_at: null,
      }),
    ).toBe("self-upload");
  });

  it("returns 'files (n)' for the share_with_us path, counting the files array", () => {
    expect(
      clientListStatusLabel({
        client_list_path: "share_with_us",
        client_list_files: [validFile(), validFile()],
        client_list_import_verified_at: null,
        client_list_working_copy_deleted_at: null,
      }),
    ).toBe("files (2)");
  });

  it("tolerates a non-array client_list_files as zero files", () => {
    expect(
      clientListStatusLabel({
        client_list_path: "share_with_us",
        client_list_files: "not-an-array",
        client_list_import_verified_at: null,
        client_list_working_copy_deleted_at: null,
      }),
    ).toBe("files (0)");
  });

  it("returns 'none' when no path is set", () => {
    expect(
      clientListStatusLabel({
        client_list_path: null,
        client_list_files: [],
        client_list_import_verified_at: null,
        client_list_working_copy_deleted_at: null,
      }),
    ).toBe("none");
  });
});

describe("deriveClientListCheck", () => {
  it("fails when no submission matches the firm name", () => {
    const result = deriveClientListCheck(
      [
        {
          legal_name: "Some Other Firm",
          submitted_at: "2026-07-01T00:00:00Z",
          client_list_path: "share_with_us",
          client_list_files: [validFile()],
          client_list_attested_at: "2026-07-01T00:00:00Z",
          client_list_import_verified_at: null,
          client_list_working_copy_deleted_at: null,
        },
      ],
      "DRG Law",
    );
    expect(result).toEqual({ status: "fail", detail: "No firm-profile submission with a client list" });
  });

  it("fails when the only submission has no client_list_path", () => {
    const result = deriveClientListCheck(
      [
        {
          legal_name: "DRG Law",
          submitted_at: "2026-07-01T00:00:00Z",
          client_list_path: null,
          client_list_files: [],
          client_list_attested_at: null,
          client_list_import_verified_at: null,
          client_list_working_copy_deleted_at: null,
        },
      ],
      "DRG Law",
    );
    expect(result.status).toBe("fail");
  });

  it("matches the firm name case-insensitively and trims whitespace", () => {
    const result = deriveClientListCheck(
      [
        {
          legal_name: "  drg law  ",
          submitted_at: "2026-07-01T00:00:00Z",
          client_list_path: "self_upload",
          client_list_files: [],
          client_list_attested_at: "2026-07-01T00:00:00Z",
          client_list_import_verified_at: null,
          client_list_working_copy_deleted_at: null,
        },
      ],
      " DRG LAW ",
    );
    expect(result).toEqual({ status: "pass", detail: "Self-upload confirmed by the firm" });
  });

  it("fails when the latest matching submission has no attestation", () => {
    const result = deriveClientListCheck(
      [
        {
          legal_name: "DRG Law",
          submitted_at: "2026-07-01T00:00:00Z",
          client_list_path: "share_with_us",
          client_list_files: [validFile()],
          client_list_attested_at: null,
          client_list_import_verified_at: null,
          client_list_working_copy_deleted_at: null,
        },
      ],
      "DRG Law",
    );
    expect(result).toEqual({
      status: "fail",
      detail: "Client list present but consent attestation missing",
    });
  });

  it("passes on the self_upload path once attested", () => {
    const result = deriveClientListCheck(
      [
        {
          legal_name: "DRG Law",
          submitted_at: "2026-07-01T00:00:00Z",
          client_list_path: "self_upload",
          client_list_files: [],
          client_list_attested_at: "2026-07-01T00:00:00Z",
          client_list_import_verified_at: null,
          client_list_working_copy_deleted_at: null,
        },
      ],
      "DRG Law",
    );
    expect(result).toEqual({ status: "pass", detail: "Self-upload confirmed by the firm" });
  });

  it("warns on the share_with_us path when files exist but import is not verified", () => {
    const result = deriveClientListCheck(
      [
        {
          legal_name: "DRG Law",
          submitted_at: "2026-07-01T00:00:00Z",
          client_list_path: "share_with_us",
          client_list_files: [validFile(), validFile()],
          client_list_attested_at: "2026-07-01T00:00:00Z",
          client_list_import_verified_at: null,
          client_list_working_copy_deleted_at: null,
        },
      ],
      "DRG Law",
    );
    expect(result).toEqual({ status: "warn", detail: "Files received (2): import not yet verified" });
  });

  it("passes on the share_with_us path when verified but not yet deleted", () => {
    const result = deriveClientListCheck(
      [
        {
          legal_name: "DRG Law",
          submitted_at: "2026-07-01T00:00:00Z",
          client_list_path: "share_with_us",
          client_list_files: [validFile()],
          client_list_attested_at: "2026-07-01T00:00:00Z",
          client_list_import_verified_at: "2026-07-05T00:00:00Z",
          client_list_working_copy_deleted_at: null,
        },
      ],
      "DRG Law",
    );
    expect(result).toEqual({
      status: "pass",
      detail: "Imported and verified: working copy pending deletion",
    });
  });

  it("passes on the share_with_us path when verified and deleted", () => {
    const result = deriveClientListCheck(
      [
        {
          legal_name: "DRG Law",
          submitted_at: "2026-07-01T00:00:00Z",
          client_list_path: "share_with_us",
          client_list_files: [validFile()],
          client_list_attested_at: "2026-07-01T00:00:00Z",
          client_list_import_verified_at: "2026-07-05T00:00:00Z",
          client_list_working_copy_deleted_at: "2026-07-06T00:00:00Z",
        },
      ],
      "DRG Law",
    );
    expect(result).toEqual({
      status: "pass",
      detail: "Imported, verified, working copy deleted",
    });
  });

  it("picks the latest matching submission when two are present", () => {
    const result = deriveClientListCheck(
      [
        {
          legal_name: "DRG Law",
          submitted_at: "2026-07-01T00:00:00Z",
          client_list_path: "share_with_us",
          client_list_files: [validFile()],
          client_list_attested_at: "2026-07-01T00:00:00Z",
          client_list_import_verified_at: null,
          client_list_working_copy_deleted_at: null,
        },
        {
          legal_name: "DRG Law",
          submitted_at: "2026-07-10T00:00:00Z",
          client_list_path: "self_upload",
          client_list_files: [],
          client_list_attested_at: "2026-07-10T00:00:00Z",
          client_list_import_verified_at: null,
          client_list_working_copy_deleted_at: null,
        },
      ],
      "DRG Law",
    );
    expect(result).toEqual({ status: "pass", detail: "Self-upload confirmed by the firm" });
  });

  it("ignores a submission with a null client_list_path when a newer one exists without a path", () => {
    const result = deriveClientListCheck(
      [
        {
          legal_name: "DRG Law",
          submitted_at: "2026-07-01T00:00:00Z",
          client_list_path: "self_upload",
          client_list_files: [],
          client_list_attested_at: "2026-07-01T00:00:00Z",
          client_list_import_verified_at: null,
          client_list_working_copy_deleted_at: null,
        },
        {
          legal_name: "DRG Law",
          submitted_at: "2026-07-15T00:00:00Z",
          client_list_path: null,
          client_list_files: [],
          client_list_attested_at: null,
          client_list_import_verified_at: null,
          client_list_working_copy_deleted_at: null,
        },
      ],
      "DRG Law",
    );
    expect(result).toEqual({ status: "pass", detail: "Self-upload confirmed by the firm" });
  });
});
