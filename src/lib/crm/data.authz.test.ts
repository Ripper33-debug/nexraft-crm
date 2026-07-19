import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, it, expect } from "vitest";

// Guard-rail tests for the authorization layer in data.ts. The server functions
// there can't run in vitest (they need a live DB + request context), so instead
// we statically verify that each sensitive handler still contains its access
// check. If someone refactors a guard away, these fail the build before the
// change can ship a data leak.

const source = readFileSync(join(__dirname, "data.ts"), "utf8");

// Extract the handler body of `export const <name> = createServerFn(...)...`
// up to the next `export const` (good enough for a containment check).
function fnBody(name: string): string {
  const start = source.indexOf(`export const ${name} `);
  expect(start, `server function ${name} should exist in data.ts`).toBeGreaterThan(-1);
  const rest = source.slice(start + 10);
  const end = rest.indexOf("export const ");
  return end === -1 ? rest : rest.slice(0, end);
}

describe("admin-only server functions keep their requireAdmin guard", () => {
  for (const name of [
    "getExportBundle",
    "redistributePool",
    "adminReassignBook",
    "adminUpdateRole",
    "adminResetPassword",
    "adminDeleteUser",
    "getSignupCode",
  ]) {
    it(`${name} calls requireAdmin`, () => {
      expect(fnBody(name)).toContain("requireAdmin(");
    });
  }
});

describe("restore functions enforce record-level permissions", () => {
  for (const name of ["restoreCompany", "restoreContact", "restoreDeal"]) {
    it(`${name} calls assertCanEdit`, () => {
      expect(fnBody(name)).toContain("assertCanEdit(");
    });
  }
});

describe("archive functions enforce record-level permissions", () => {
  for (const name of ["archiveCompany", "archiveContact", "archiveDeal"]) {
    it(`${name} calls assertCanEdit`, () => {
      expect(fnBody(name)).toContain("assertCanEdit(");
    });
  }
});

describe("merge functions enforce record-level permissions on BOTH records", () => {
  for (const name of ["mergeCompanies", "mergeContacts"]) {
    it(`${name} calls assertCanEdit twice (keep + merge)`, () => {
      const body = fnBody(name);
      const count = body.split("assertCanEdit(").length - 1;
      expect(count).toBeGreaterThanOrEqual(2);
    });
    it(`${name} archives the merged record instead of deleting it`, () => {
      expect(fnBody(name)).toContain("SET archived_at");
    });
  }
});

describe("imports keep their dedupe guards", () => {
  it("importCompanies skips existing companies by name/phone key", () => {
    const body = fnBody("importCompanies");
    expect(body).toContain("companyNameKey(");
    expect(body).toContain("phoneKey(");
    expect(body).toContain("skipped");
  });
  it("importContacts skips existing contacts by email/phone key", () => {
    const body = fnBody("importContacts");
    expect(body).toContain("emailKey(");
    expect(body).toContain("phoneKey(");
    expect(body).toContain("skipped");
  });
});

describe("role demotion clears the demoted user's sessions", () => {
  it("adminUpdateRole deletes sessions on demotion", () => {
    expect(fnBody("adminUpdateRole")).toContain("DELETE FROM sessions");
  });
});
