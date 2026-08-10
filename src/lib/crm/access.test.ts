import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, it, expect } from "vitest";

import { ACCESS_ALLOW_TOKENS, ACCESS_DENIED_MESSAGE, isAllowedUser } from "./constants";

// Barry's ask (2026-08-10): only Barry Castelli, Ayden, Michael and Brady may
// use the CRM for now — everyone else loses access, including existing
// sessions. These tests pin both the pure matcher and the enforcement points
// in auth.server.ts so a refactor can't quietly reopen the door.

describe("access allowlist — who gets in", () => {
  it("lets the four named people in, by name or email", () => {
    expect(isAllowedUser("Barry Castelli", "barry@nexraft.com")).toBe(true);
    expect(isAllowedUser("Ayden", "ayden.someone@gmail.com")).toBe(true);
    expect(isAllowedUser("Michael Farina", "mfarina@gmail.com")).toBe(true);
    expect(isAllowedUser("Micheal", "")).toBe(true); // common misspelling
    expect(isAllowedUser("Brady", "brady@nexraft.com")).toBe(true);
    // Email-only matches work too (name blank or different).
    expect(isAllowedUser("", "michael.farina@yahoo.com")).toBe(true);
    expect(isAllowedUser("B", "brady99@gmail.com")).toBe(true);
  });

  it("keeps everyone else out — including the OTHER Barry", () => {
    // Barry Birch is a rep named just "Barry" — he is exactly who the
    // lockout excludes. "barry" alone must never be an allow token.
    expect(isAllowedUser("Barry", "barry.birch@gmail.com")).toBe(false);
    expect(isAllowedUser("Barry Birch", "bbirch@yahoo.com")).toBe(false);
    expect(isAllowedUser("Nick Besser", "nick@besser.com")).toBe(false);
    expect(isAllowedUser("Random Person", "random@person.com")).toBe(false);
    expect(isAllowedUser("", "")).toBe(false);
    expect(isAllowedUser(null, undefined)).toBe(false);
    expect(ACCESS_ALLOW_TOKENS).not.toContain("barry");
  });

  it("is case-insensitive and matches inside emails", () => {
    expect(isAllowedUser("BARRY CASTELLI", "")).toBe(true);
    expect(isAllowedUser("", "Barry.Castelli33@Gmail.com")).toBe(true);
  });

  it("denied message tells them who to ask", () => {
    expect(ACCESS_DENIED_MESSAGE).toMatch(/Barry/);
  });
});

describe("access allowlist — enforcement is actually wired in", () => {
  const auth = readFileSync(join(__dirname, "auth.server.ts"), "utf8");

  it("auth.server.ts has the userHasAccess gate with owner + env escape hatches", () => {
    expect(auth).toContain("function userHasAccess(");
    expect(auth).toContain("isAllowedUser(name, email)");
    expect(auth).toContain("ownerEmail()");
    expect(auth).toContain("NEXRAFT_ACCESS_OPEN");
  });

  it("every door checks the gate: sessions, raw-request auth, login, signup", () => {
    // A crude but effective count: currentUser, userFromRequest, loginUser
    // and registerUser must each call userHasAccess — four call sites.
    const calls = auth.match(/userHasAccess\(/g) ?? [];
    // one definition + four call sites
    expect(calls.length).toBeGreaterThanOrEqual(5);
    expect(auth).toContain("if (!userHasAccess(row.name, row.email)) return null;");
    expect(auth).toContain("ACCESS_DENIED_MESSAGE");
  });
});
