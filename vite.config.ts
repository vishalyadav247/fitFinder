/// <reference types="vitest/config" />
import { reactRouter } from "@react-router/dev/vite";
import { defineConfig, type UserConfig } from "vite";
import { fileURLToPath } from "node:url";
import tsconfigPaths from "vite-tsconfig-paths";

// Related: https://github.com/remix-run/remix/issues/2835#issuecomment-1144102176
// Replace the HOST env var with SHOPIFY_APP_URL so that it doesn't break the Vite server.
// The CLI will eventually stop passing in HOST,
// so we can remove this workaround after the next major release.
if (
  process.env.HOST &&
  (!process.env.SHOPIFY_APP_URL ||
    process.env.SHOPIFY_APP_URL === process.env.HOST)
) {
  process.env.SHOPIFY_APP_URL = process.env.HOST;
  delete process.env.HOST;
}

const host = new URL(process.env.SHOPIFY_APP_URL || "http://localhost")
  .hostname;

let hmrConfig;
if (host === "localhost") {
  hmrConfig = {
    protocol: "ws",
    host: "localhost",
    port: 64999,
    clientPort: 64999,
  };
} else {
  hmrConfig = {
    protocol: "wss",
    host: host,
    port: parseInt(process.env.FRONTEND_PORT!) || 8002,
    clientPort: 443,
  };
}

export default defineConfig({
  server: {
    allowedHosts: [host],
    cors: {
      preflightContinue: true,
    },
    port: Number(process.env.PORT || 3000),
    hmr: hmrConfig,
    fs: {
      // See https://vitejs.dev/config/server-options.html#server-fs-allow for more information
      // extensions: the Storefront previews import the theme extension assets (?raw).
      allow: ["app", "node_modules", "extensions"],
    },
  },
  plugins: [reactRouter(), tsconfigPaths()],
  build: {
    assetsInlineLimit: 0,
  },
  optimizeDeps: {
    include: ["@shopify/app-bridge-react"],
  },
  test: {
    // The Postgres integration tests share one local database and run in parallel files.
    testTimeout: 20_000,
    // pg-boss imports @opentelemetry/api, whose "module" build (picked by Vite) has extensionless
    // imports Node can't load: run pg-boss through Vite and point it at the CommonJS build.
    server: { deps: { inline: ["pg-boss"] } },
    alias: {
      "@opentelemetry/api": fileURLToPath(
        new URL(
          "./node_modules/@opentelemetry/api/build/src/index.js",
          import.meta.url,
        ),
      ),
    },
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          // vitest's default excludes, written out: this file must not import vitest at runtime
          // (the production image builds with dev dependencies left out).
          exclude: ["**/node_modules/**", "**/.git/**", "app/e2e/**"],
        },
      },
      {
        // npm run test:e2e: whole merchant journeys with real jobs (app/e2e/harness.ts).
        extends: true,
        test: {
          name: "e2e",
          include: ["app/e2e/**/*.e2e.test.ts"],
          testTimeout: 120_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
}) satisfies UserConfig;
