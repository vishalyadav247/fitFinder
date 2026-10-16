import type { Config } from "@react-router/dev/config";

export default {
  future: {
    // Route middleware: the root route times every request for Backoffice › Logs
    // (services/logs/slow.server.ts).
    v8_middleware: true,
  },
} satisfies Config;
