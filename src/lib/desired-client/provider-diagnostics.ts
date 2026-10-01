/** Returns provider metadata safe to log without error text or submitted answers. */
export function safeProviderFailureMetadata(error: unknown): { providerError: string; providerStatus?: number } {
  if (!error || typeof error !== "object") return { providerError: "UnknownError" };
  const value = error as Record<string, unknown>;
  const providerError = typeof value.name === "string" && /^[A-Za-z][A-Za-z0-9_]{0,59}$/.test(value.name)
    ? value.name
    : "UnknownError";
  const providerStatus = typeof value.status === "number" && Number.isInteger(value.status) && value.status >= 100 && value.status <= 599
    ? value.status
    : undefined;
  return { providerError, ...(providerStatus === undefined ? {} : { providerStatus }) };
}
