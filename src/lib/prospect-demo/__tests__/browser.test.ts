import { describe, expect, it } from "vitest";

import { assetFromImageBlob, screenshotDataUrl } from "../browser";

describe("prospect-demo browser image validation", () => {
  it("rejects a file whose declared PNG type has no PNG signature", async () => {
    const malformed = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0x00])], { type: "image/png" });

    await expect(screenshotDataUrl(malformed)).rejects.toThrow("does not match its declared image type");
    await expect(assetFromImageBlob(malformed)).rejects.toThrow("does not match its declared image type");
  });

  it("rejects an unsupported image type before attempting browser decoding", async () => {
    const unsupported = new Blob([new Uint8Array([0x00])], { type: "image/gif" });

    await expect(screenshotDataUrl(unsupported)).rejects.toThrow("Choose a PNG, JPEG, or WebP screenshot");
  });
});
