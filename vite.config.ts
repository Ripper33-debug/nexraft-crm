import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import svgr from "vite-plugin-svgr";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { fileURLToPath } from "node:url";

// The vendored @higgsfield/quanta components import their glyphs from the private
// Nexus-only `@higgsfield-ai/icons`; redirect those imports to a Material Symbols
// shim so the public build resolves them. (Kept for any residual imports.)
const QUANTA_ICONS_SHIM = fileURLToPath(
  new URL("./src/lib/quanta-material-icons.ts", import.meta.url),
);

export default defineConfig(() => {
  return {
    resolve: {
      alias: [{ find: /^@higgsfield-ai\/icons(\/.*)?$/, replacement: QUANTA_ICONS_SHIM }],
    },
    // Server bundle runs on Vercel's Node runtime. Bundle npm deps into the SSR
    // output (self-contained handler), but keep `postgres` external so Node
    // resolves it from node_modules at runtime (it uses node: builtins /
    // dynamic requires that don't bundle cleanly).
    ssr: {
      noExternal: true as const,
      external: ["postgres"],
    },
    plugins: [
      svgr({
        svgrOptions: {
          icon: true,
          svgProps: { fill: "currentColor" },
          svgoConfig: {
            plugins: [
              { name: "preset-default", params: { overrides: { removeViewBox: false } } },
            ],
          },
        },
      }),
      // TanStack Start plugin must run before React's plugin. The SSR build emits
      // a Web-standard fetch handler (dist/server/server.js -> `export default
      // { fetch }`) plus dist/client static assets. api/index.ts wraps that
      // handler as a Vercel Node serverless function.
      tanstackStart({
        server: { entry: "server" },
      }),
      react(),
      tailwindcss(),
      tsconfigPaths(),
    ],
  };
});
