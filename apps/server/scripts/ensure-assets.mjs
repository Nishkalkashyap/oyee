#!/usr/bin/env node
// Wrangler requires the static-assets directory (../web/dist) to exist. When the web app hasn't been built yet,
// create a tiny placeholder so `wrangler dev` and the tests still start. Never overwrites a real build.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function ensureAssets() {
  const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../../web/dist");
  if (existsSync(dir)) return false;
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    resolve(dir, "index.html"),
    `<!doctype html><meta charset="utf-8"><title>Oyee</title>
<p>Oyee API is running. The web app hasn't been built yet: run <code>pnpm --filter @oyee/web build</code>.</p>\n`,
  );
  console.log(`[ensure-assets] created placeholder ${dir}/index.html`);
  return true;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) ensureAssets();
