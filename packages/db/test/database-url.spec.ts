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

		const result = new URL(
			databaseUrlWithSchema("postgresql://db.test/crm?schema=public"),
		);

		expect(result.searchParams.get("schema")).toBe("nexraft_crm_app");
	});

	it("does not add startup options that pooled Neon connections reject", () => {
		process.env.DATABASE_SCHEMA = "nexraft_crm_app";

		const result = new URL(
			databaseUrlWithSchema(
				"postgresql://db.test/crm?options=-c%20statement_timeout%3D5000",
			),
		);

		expect(result.searchParams.get("options")).toBe("-c statement_timeout=5000");
	});
});
