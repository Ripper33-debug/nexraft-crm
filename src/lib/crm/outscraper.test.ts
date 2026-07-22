import { describe, it, expect } from "vitest";

import { fetchDomainContacts, isOutscraperConfigured, websiteDomain } from "./outscraper.server";

// The Outscraper integration follows the house rule for external feeds:
// config-gated on an env key, and "enrichment is a bonus, never a blocker".
// These tests pin the pieces that are pure (domain normalization) and the
// no-key behavior (must be null = "didn't run", never [] = "ran, found
// nothing" — that distinction is what stops a blip from burning a company's
// one enrichment slot).

describe("websiteDomain normalizes company websites into billable queries", () => {
  it("strips scheme, www, path, and case", () => {
    expect(websiteDomain("https://www.JoesPlumbing.com/about?x=1")).toBe("joesplumbing.com");
    expect(websiteDomain("http://millsplumbing.net")).toBe("millsplumbing.net");
    expect(websiteDomain("franksroofing.com")).toBe("franksroofing.com");
  });
  it("rejects things that would waste a credit", () => {
    expect(websiteDomain(null)).toBeNull();
    expect(websiteDomain("")).toBeNull();
    expect(websiteDomain("   ")).toBeNull();
    expect(websiteDomain("localhost")).toBeNull();
    expect(websiteDomain("192.168.1.1")).toBeNull();
    // Social pages in the website field aren't the business's own domain.
    expect(websiteDomain("https://www.facebook.com/joesplumbing")).toBeNull();
    expect(websiteDomain("https://instagram.com/joesplumbing")).toBeNull();
  });
});

describe("no API key means the feature is quietly off", () => {
  it("isOutscraperConfigured is false and fetch returns null (not [])", async () => {
    // The test env never has OUTSCRAPER_API_KEY set.
    expect(process.env.OUTSCRAPER_API_KEY).toBeUndefined();
    expect(isOutscraperConfigured()).toBe(false);
    expect(await fetchDomainContacts(["example.com"])).toBeNull();
  });
  it("an empty domain list never makes a network call", async () => {
    expect(await fetchDomainContacts([])).toBeNull();
  });
});
