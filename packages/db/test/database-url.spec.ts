import { afterEach, describe, expect, it } from "bun:test";
import { databaseUrlWithSchema } from "../src/database-url";

const previousSchema = process.env.DATABASE_SCHEMA;

afterEach(() => {
	if (previousSchema === undefined) {
		delete process.env.DATABASE_SCHEMA;
	} else {
		process.env.DATABASE_SCHEMA = previousSchema;
	}
});

describe("databaseUrlWithSchema", () => {
	it("leaves the URL alone when no deployment schema is set", () => {
		delete process.env.DATABASE_SCHEMA;

		expect(databaseUrlWithSchema("postgresql://db.test/crm?schema=public")).toBe(
			"postgresql://db.test/crm?schema=public",
		);
	});

	it("overrides an integration-provided schema when a deployment schema is set", () => {
		process.env.DATABASE_SCHEMA = "nexraft_crm_app";

		expect(databaseUrlWithSchema("postgresql://db.test/crm?schema=public")).toBe(
			"postgresql://db.test/crm?schema=nexraft_crm_app",
		);
	});
});
