// Separate job worker process for production (run the web with JOBS_INLINE=false).
//   npm run worker
import { startWorkers } from "../app/services/jobs.server";
import { installLogCapture } from "../app/services/logs/logs.server";

try {
  process.loadEnvFile(".env");
} catch {
  // environment comes from the host
}

// Job warnings and errors also go to Backoffice › Logs.
installLogCapture();
await startWorkers();
