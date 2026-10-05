// Separate job worker process for production (run the web with JOBS_INLINE=false).
//   npm run worker
import { startWorkers } from "../app/services/jobs.server";

try {
  process.loadEnvFile(".env");
} catch {
  // environment comes from the host
}

await startWorkers();
