// Background jobs (pg-boss on the app's Postgres, schema "pgboss"). Imports run here, never in a
// request. The web process starts the workers itself unless JOBS_INLINE=false; in production a
// separate worker process (scripts/worker.ts) can run them instead.
import { PgBoss } from "pg-boss";
import { runImport, runPreview, sweepStale } from "./import/pipeline.server";

export const QUEUES = {
  importPreview: "import-preview",
  importRun: "import-run",
} as const;
type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

// One import step can take a while on 700k rows; our own job row tracks state, so no retries.
const QUEUE_OPTIONS = { retryLimit: 0, expireInSeconds: 60 * 60 };

declare global {
  // eslint-disable-next-line no-var
  var fitfinderBoss: Promise<PgBoss> | undefined;
  // eslint-disable-next-line no-var
  var fitfinderWorkers: Promise<void> | undefined;
}

function connect(): Promise<PgBoss> {
  if (!global.fitfinderBoss) {
    global.fitfinderBoss = (async () => {
      const boss = new PgBoss({
        connectionString: process.env.DATABASE_URL,
        schema: "pgboss",
        application_name: "fitfinder-jobs",
      });
      boss.on("error", (error) => console.error("pg-boss error", error));
      await boss.start();
      for (const name of Object.values(QUEUES)) {
        await boss.createQueue(name, QUEUE_OPTIONS);
      }
      return boss;
    })();
    global.fitfinderBoss.catch(() => {
      global.fitfinderBoss = undefined;
    });
  }
  return global.fitfinderBoss;
}

export async function enqueue(
  name: QueueName,
  data: { jobId: string; attempt: number },
) {
  // If the workers failed to start earlier (e.g. Postgres not ready at boot), try again now.
  if (jobsRunInline()) void startWorkers();
  const boss = await connect();
  await boss.send(name, data, QUEUE_OPTIONS);
}

/** Registers the job handlers once per process. */
export function startWorkers(): Promise<void> {
  if (!global.fitfinderWorkers) {
    global.fitfinderWorkers = (async () => {
      const boss = await connect();
      await boss.work<{ jobId: string; attempt: number }>(
        QUEUES.importPreview,
        { localConcurrency: 2 },
        async ([job]) => runPreview(job.data.jobId, job.data.attempt),
      );
      await boss.work<{ jobId: string; attempt: number }>(
        QUEUES.importRun,
        { localConcurrency: 1 },
        async ([job]) => runImport(job.data.jobId, job.data.attempt),
      );
      // Jobs left behind by a crash or redeploy stop locking their shop.
      const sweep = () =>
        sweepStale().catch((error) =>
          console.error("stale import sweep failed", error),
        );
      await sweep();
      setInterval(sweep, 60_000).unref();
      console.log("FitFinder job workers started");
    })();
    global.fitfinderWorkers.catch((error) => {
      console.error("Couldn't start job workers", error);
      global.fitfinderWorkers = undefined;
    });
  }
  return global.fitfinderWorkers;
}

export function jobsRunInline() {
  return process.env.JOBS_INLINE !== "false";
}
