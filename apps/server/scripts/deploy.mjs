#!/usr/bin/env node
// `wrangler deploy` plus optional extra custom domains from the git-ignored `.extra-domains` file (one hostname per
// line, # comments). Wrangler replaces a Worker's custom domains on every deploy with exactly the ones it is given, so
// extra domains must be passed each time; keeping them in a local file keeps them out of the repository.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const file = join(root, ".extra-domains");
const extra = existsSync(file)
  ? readFileSync(file, "utf8")
      .split("\n")
      .map((l) => l.replace(/#.*/, "").trim())
      .filter(Boolean)
  : [];

const args = ["exec", "wrangler", "deploy", ...extra.flatMap((d) => ["--domain", d]), ...process.argv.slice(2)];
console.log(`Deploying with ${extra.length} extra custom domain(s) from .extra-domains`);
const r = spawnSync("pnpm", args, { cwd: root, stdio: "inherit" });
process.exit(r.status ?? 1);
