import "@crm/env/load";

import path from "node:path";
import { defineConfig, env } from "prisma/config";
import { databaseUrlWithSchema } from "./src/database-url";

export default defineConfig({
	schema: path.join("prisma", "schema.prisma"),
	migrations: {
		path: path.join("prisma", "migrations"),
		seed: "bun run prisma/seed.ts",
	},
	datasource: {
		url: databaseUrlWithSchema(env("DATABASE_URL")),
	},
});
