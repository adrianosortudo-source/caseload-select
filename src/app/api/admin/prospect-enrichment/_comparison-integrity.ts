type StoredPackageIdentity = Record<string, unknown>;
type ReadPackageIdentity = { packageId: unknown; clientPackageId: unknown; payloadSha256: unknown; state: unknown };

/** A comparison is valid only when its row and complete detail read-back describe one package revision. */
export function matchesPackageReadBack(stored: StoredPackageIdentity, readBack: ReadPackageIdentity, expectedClientPackageId?: string): boolean {
  return stored.id === readBack.packageId && stored.client_package_id === readBack.clientPackageId &&
    stored.payload_sha256 === readBack.payloadSha256 && stored.state === readBack.state &&
    (expectedClientPackageId === undefined || readBack.clientPackageId === expectedClientPackageId);
}

/** The capture timestamp changes by design; every other signed comparison field must be stable across read passes. */
export function comparisonContentFingerprint(value: Record<string, unknown>, hash: (input: unknown) => string): string {
  const { capturedAt: _capturedAt, ...content } = value;
  return hash(content);
}
