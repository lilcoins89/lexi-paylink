import { describe, expect, it } from "vitest";
import { sanitizePublicRedirect } from "./redirect";

describe("public success redirect validation", () => {
  it("accepts a public HTTPS hostname and preserves its path/query", () => {
    expect(sanitizePublicRedirect("https://shop.example.com/paid?order=123")).toBe("https://shop.example.com/paid?order=123");
  });
  it("rejects non-HTTPS, credential-bearing, local, and IP-literal redirect targets", () => {
    for (const value of ["http://shop.example.com", "https://user:pass@shop.example.com", "https://localhost/paid", "https://127.0.0.1/paid", "https://[::1]/paid", "https://merchant.local/paid"]) {
      expect(() => sanitizePublicRedirect(value)).toThrow();
    }
  });
  it("accepts no redirect when the merchant leaves it blank", () => {
    expect(sanitizePublicRedirect("")).toBeNull();
    expect(sanitizePublicRedirect(undefined)).toBeNull();
  });
});
