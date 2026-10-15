// Development and production Shopify apps share this codebase (shopify.app.toml = PRODUCTION,
// shopify.app.dev.toml = development).
//   node scripts/app-config.mjs which        which config Shopify CLI commands use by default
//   node scripts/app-config.mjs check prod   refuse while the production file has placeholders
//                                            or its scopes/webhooks/app proxy differ from dev
// `which` reads the CLI's remembered default for this folder (set by `shopify app config use`);
// `npm run info:dev` / `npm run info:prod` ask Shopify itself.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FILES = {
  dev: "shopify.app.dev.toml",
  development: "shopify.app.dev.toml",
  prod: "shopify.app.toml",
  production: "shopify.app.toml",
};

function cliConfigPath() {
  const name = "shopify-cli-app-nodejs";
  if (process.platform === "darwin")
    return path.join(
      os.homedir(),
      "Library",
      "Preferences",
      name,
      "config.json",
    );
  if (process.platform === "win32")
    return path.join(process.env.APPDATA ?? "", name, "Config", "config.json");
  return path.join(
    process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"),
    name,
    "config.json",
  );
}

function readToml(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function topValue(toml, key) {
  return toml.match(new RegExp(`^${key}\\s*=\\s*"([^"]*)"`, "m"))?.[1] ?? "?";
}

// Everything from [access_scopes] up to [auth], without comments: must be the same in both apps.
function sharedPart(toml) {
  const start = toml.indexOf("[access_scopes]");
  const end = toml.indexOf("[auth]");
  return toml
    .slice(start, end)
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .join("\n");
}

function which() {
  let file = "shopify.app.toml";
  try {
    const all = JSON.parse(fs.readFileSync(cliConfigPath(), "utf8"));
    const entry = all[ROOT] ?? all[ROOT.replace(/\\/g, "/")];
    if (entry?.configFile) file = entry.configFile;
  } catch {
    // no CLI settings yet: the CLI uses shopify.app.toml (production!)
  }
  const env = file === FILES.prod ? "PRODUCTION" : "development";
  const toml = fs.existsSync(path.join(ROOT, file)) ? readToml(file) : "";
  console.log(`Default Shopify CLI config: ${file} (${env})`);
  console.log(`  client_id:       ${topValue(toml, "client_id")}`);
  console.log(`  application_url: ${topValue(toml, "application_url")}`);
  console.log(
    `npm run dev and npm run dev:tunnel always use ${FILES.dev} (development).`,
  );
  if (file === FILES.prod) {
    console.log(
      "Plain `shopify app …` commands now act on the PRODUCTION app. Back to dev: npm run config:dev",
    );
  }
}

function check(name) {
  const file = FILES[name];
  if (!file) {
    console.error(`Unknown config "${name}". Use dev or prod.`);
    process.exit(1);
  }
  const toml = readToml(file);
  const problems = [];
  const left = [...new Set(toml.match(/REPLACE_WITH_[A-Z_]+/g) ?? [])];
  if (left.length) problems.push(`fill in ${left.join(", ")} in ${file}`);
  if (
    file !== FILES.dev &&
    sharedPart(toml) !== sharedPart(readToml(FILES.dev))
  ) {
    problems.push(
      `scopes, webhooks or app proxy in ${file} differ from ${FILES.dev}; copy them over first`,
    );
  }
  if (problems.length) {
    console.error(`Not ready (${file}):\n  - ${problems.join("\n  - ")}`);
    process.exit(1);
  }
  console.log(`${file} is ready.`);
}

const [cmd, arg] = process.argv.slice(2);
if (cmd === "which") which();
else if (cmd === "check") check(arg ?? "prod");
else {
  console.error("Usage: node scripts/app-config.mjs which | check <dev|prod>");
  process.exit(1);
}
