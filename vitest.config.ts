import { defineConfig } from "vitest/config";

// Standalone test config — intentionally does NOT load the app's Vite/TanStack
// Start plugins. The suite targets the pure, framework-free logic in
// src/lib/crm (money math, scoring, dates, access checks), so it needs no DOM,
// no router, and no server runtime. Keeping it isolated makes `bun run test`
// fast and immune to build-plugin churn.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    globals: false,
  },
});
