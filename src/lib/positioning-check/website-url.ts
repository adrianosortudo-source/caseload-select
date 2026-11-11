/** Accept common pasted addresses, but always request their secure HTTPS version. */
export function normalizeWebsiteUrl(raw: string): URL {
  const input = raw.trim();
  if (!input || input.length > 2048) throw new Error("invalid_url");
  const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(input) ? input : input.startsWith("//") ? `https:${input}` : `https://${input}`);
  if (url.protocol === "http:") url.protocol = "https:";
  if (url.protocol !== "https:" || !url.hostname.includes(".") || url.username || url.password) throw new Error("invalid_url");
  url.hash = "";
  return url;
}
