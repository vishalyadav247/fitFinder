#!/usr/bin/env node
// Local dev through our own Cloudflare tunnel:
//   npm run dev:tunnel                 quick tunnel (random *.trycloudflare.com URL, no account)
//   TUNNEL_URL=https://dev.example.com npm run dev:tunnel
//                                      a named tunnel you already run, pointing at localhost:PORT
// Then `shopify app dev --tunnel-url <url>:<port>` starts the app on PORT and, because
// shopify.app.toml has automatically_update_urls_on_dev = true, points the app's URLs at the tunnel.
// Every run first stops an earlier dev session still running (old dev:tunnel, its cloudflared,
// shopify app dev, the React Router dev server, anything listening on PORT), then starts fresh.
// Flags: --dry-run prints the tunnel URL and exits (checks cloudflared works).
import { spawn, spawnSync } from "node:child_process";

const PORT = Number(process.env.PORT ?? 3000);
const DRY_RUN = process.argv.includes("--dry-run");
const isWin = process.platform === "win32";

function log(msg) {
  console.log(`[dev-tunnel] ${msg}`);
}

/** Every process as { pid, ppid, cmd } (empty when the list can't be read). */
function listProcesses() {
  if (isWin) {
    const r = spawnSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress",
      ],
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    );
    if (r.status !== 0 || !r.stdout.trim()) return [];
    const rows = [].concat(JSON.parse(r.stdout));
    return rows.map((p) => ({
      pid: p.ProcessId,
      ppid: p.ParentProcessId,
      cmd: p.CommandLine || "",
    }));
  }
  const r = spawnSync("ps", ["-eo", "pid=,ppid=,args="], { encoding: "utf8" });
  if (r.status !== 0) return [];
  return r.stdout
    .split("\n")
    .map((line) => line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/))
    .filter(Boolean)
    .map((m) => ({ pid: Number(m[1]), ppid: Number(m[2]), cmd: m[3] }));
}

/** Pids listening on the app port. */
function portOwners() {
  if (isWin) {
    const r = spawnSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        `(Get-NetTCPConnection -LocalPort ${PORT} -State Listen -ErrorAction SilentlyContinue).OwningProcess`,
      ],
      { encoding: "utf8" },
    );
    return (r.stdout || "").split(/\s+/).filter(Boolean).map(Number);
  }
  const r = spawnSync("lsof", ["-t", `-iTCP:${PORT}`, "-sTCP:LISTEN"], {
    encoding: "utf8",
  });
  return (r.stdout || "").split(/\s+/).filter(Boolean).map(Number);
}

/**
 * A fresh start: stops an earlier `npm run dev:tunnel` (its tunnel, `shopify app dev` and the
 * React Router dev server) and anything else still holding the app port. This run and the
 * processes that started it are never touched.
 */
function stopOldDevProcesses() {
  const all = listProcesses();
  const byPid = new Map(all.map((p) => [p.pid, p]));
  const keep = new Set();
  for (
    let p = byPid.get(process.pid) ?? { pid: process.pid, ppid: process.ppid };
    p;
  ) {
    keep.add(p.pid);
    p = p.ppid && !keep.has(p.ppid) ? byPid.get(p.ppid) : undefined;
  }

  const root = process.cwd().toLowerCase();
  const norm = (s) => s.toLowerCase().replace(/\\\\/g, "\\");
  const old = all.filter(({ pid, cmd }) => {
    if (keep.has(pid) || !cmd) return false;
    const c = norm(cmd);
    return (
      /dev-tunnel\.mjs/.test(c) ||
      /run dev:tunnel/.test(c) ||
      (/cloudflared/.test(c) && c.includes(`localhost:${PORT}`)) ||
      (c.includes(root) &&
        (/shopify[\\/]cli[\\/]bin[\\/]run\.js"?\s+app dev/.test(c) ||
          /@react-router[\\/]dev[\\/]bin\.js"?\s+dev/.test(c)))
    );
  });
  const pids = new Set(old.map((p) => p.pid));
  for (const pid of portOwners()) if (!keep.has(pid)) pids.add(pid);

  if (!pids.size) return;
  log(`Stopping the previous dev session (pids ${[...pids].join(", ")}) …`);
  for (const pid of pids) {
    if (isWin) {
      // /T: its children too (shopify app dev → react-router dev, cloudflared).
      spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
        stdio: "ignore",
      });
    } else {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // already gone
      }
    }
  }
  // Give the OS a moment to release the port.
  spawnSync(process.execPath, ["-e", "setTimeout(() => {}, 1500)"]);
  const still = portOwners().filter((pid) => !keep.has(pid));
  if (still.length) {
    throw new Error(
      `Port ${PORT} is still in use (pid ${still.join(", ")}). Stop it and try again.`,
    );
  }
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

  if (!DRY_RUN) stopOldDevProcesses();

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
