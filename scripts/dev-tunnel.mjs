#!/usr/bin/env node
// Local dev through our own Cloudflare tunnel:
//   npm run dev:tunnel                 quick tunnel (random *.trycloudflare.com URL, no account)
//   TUNNEL_URL=https://dev.example.com npm run dev:tunnel
//                                      a named tunnel you already run, pointing at localhost:PORT
// Then `shopify app dev --tunnel-url <url>:<port>` starts the app on PORT and, because
// shopify.app.toml has automatically_update_urls_on_dev = true, points the app's URLs at the tunnel.
// Flags: --dry-run prints the tunnel URL and exits (checks cloudflared works).
import { spawn, spawnSync } from "node:child_process";

const PORT = Number(process.env.PORT ?? 3000);
const DRY_RUN = process.argv.includes("--dry-run");
const isWin = process.platform === "win32";

function log(msg) {
  console.log(`[dev-tunnel] ${msg}`);
}

// Local Postgres (Docker container from PROGRESS.md). Ignore errors: it may run elsewhere.
function startDatabase() {
  const r = spawnSync("docker", ["start", "fitfinder-db"], {
    encoding: "utf8",
  });
  if (r.status === 0) log("Postgres container fitfinder-db is running.");
  else log("Couldn't start Docker container fitfinder-db (skipped).");
}

/** Starts a quick tunnel to localhost:PORT and resolves with its public URL. */
function startQuickTunnel() {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "cloudflared",
      ["tunnel", "--no-autoupdate", "--url", `http://localhost:${PORT}`],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("cloudflared didn't report a tunnel URL within 45 s."));
    }, 45_000);
    const onData = (buf) => {
      const m = String(buf).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (m) {
        clearTimeout(timer);
        resolve({ child, url: m[0] });
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(
        new Error(`Couldn't run cloudflared (${err.message}). Is it on PATH?`),
      );
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`cloudflared exited early (code ${code}).`));
    });
  });
}

async function main() {
  let tunnel = null;
  let url = process.env.TUNNEL_URL?.replace(/\/+$/, "");

  if (!url) {
    log(`Starting a Cloudflare quick tunnel to http://localhost:${PORT} …`);
    tunnel = await startQuickTunnel();
    url = tunnel.url;
  }
  log(`Tunnel: ${url}`);

  if (DRY_RUN) {
    tunnel?.child.kill();
    return;
  }

  startDatabase();

  const stop = () => tunnel?.child.kill();
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  process.on("exit", stop);

  // Quick tunnels can take a few seconds before DNS resolves.
  if (tunnel) await new Promise((r) => setTimeout(r, 5000));

  log(`Running: shopify app dev --tunnel-url ${url}:${PORT}`);
  const dev = spawn(
    "npx",
    ["shopify", "app", "dev", "--tunnel-url", `${url}:${PORT}`],
    { stdio: "inherit", shell: isWin },
  );
  dev.on("exit", (code) => {
    stop();
    process.exit(code ?? 0);
  });
}

main().catch((err) => {
  console.error(`[dev-tunnel] ${err.message}`);
  process.exit(1);
});
