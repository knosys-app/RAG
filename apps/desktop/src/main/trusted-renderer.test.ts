import { describe, expect, it } from "vitest";

import { isTrustedRendererUrl } from "./trusted-renderer.js";

describe("trusted renderer URLs", () => {
  it("accepts application bundle pages", () => {
    expect(isTrustedRendererUrl("app://bundle/index.html", undefined)).toBe(true);
  });

  it("rejects other application hosts and web origins", () => {
    expect(isTrustedRendererUrl("app://attacker/index.html", undefined)).toBe(false);
    expect(isTrustedRendererUrl("https://example.com", undefined)).toBe(false);
  });

  it("accepts only the configured development origin", () => {
    const developmentUrl = "http://localhost:5173";
    expect(isTrustedRendererUrl("http://localhost:5173/page", developmentUrl)).toBe(true);
    expect(isTrustedRendererUrl("http://localhost:4173/page", developmentUrl)).toBe(false);
  });
});
