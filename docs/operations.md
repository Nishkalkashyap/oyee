# Operations runbook (maintainers)

How the hosted instance at https://oyee.app is run: where everything lives, how to deploy, how to publish app
releases, and what to do when something goes wrong. For bringing up a brand-new instance from zero, see
[setup.md](setup.md). Ground rules are in [AGENTS.md](../AGENTS.md).

---

## 1. Where things live

| Thing | Where |
|---|---|
| Code | `github.com/Nishkalkashyap/oyee`, branch `main` (the only branch) |
| Server + web | Cloudflare Worker **`oyee`** on the maintainer's account (`wrangler login`). Bindings: D1 **`oyee`**, Durable Object `InboxDO`, rate limiter `AUTH_FAILURES`, static assets (`apps/web/dist`) |
| Domains | `oyee.app` (in `wrangler.jsonc` `routes`) + a **backup domain** listed only in the git-ignored `apps/server/.extra-domains` (one hostname per line). Never write the backup hostname into tracked files |
| Non-secret config | `apps/server/wrangler.jsonc` `vars` (PUBLIC_URL, GOOGLE_CLIENT_ID, VAPID_PUBLIC_KEY, VAPID_SUBJECT, ALLOWED_EMAILS, DEV_LOGIN) |
| Worker secrets | In Cloudflare: `SESSION_SECRET`, `VAPID_PRIVATE_KEY`, `GOOGLE_CLIENT_SECRET`, `FCM_SERVICE_ACCOUNT_JSON`. They persist across deploys |
| Local copies of secrets | `secrets/` at the repo root (git-ignored): `prod-secrets.json` (all four Worker secrets, usable as `--secrets-file`), `firebase-service-account.json`, `google-oauth-client.json`, `google-services.json`, `vapid-public.txt`, `prod.vars`. **Not in git: copy it when moving to a new laptop** |
| Android release key | `~/oyee-release-signing/` on the maintainer's Mac: `oyee-release.jks` (PKCS12, alias `oyee`, CN=Oyee, certificate SHA-256 `91e1664572f790b9dd947c12a63bc34e74eb4fd47a90e3e94fbeb3b50462d032`) and `README.txt` with the password. **Back it up**: without it, no update can be installed over existing installs |
| GitHub Actions secrets | `ANDROID_KEYSTORE_BASE64` (`base64 -i oyee-release.jks`), `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` |
| Google Cloud project | One project for both OAuth and Firebase. OAuth web client redirect URIs: `https://oyee.app/auth/google/callback`, the backup domain's `/auth/google/callback`, `http://localhost:8787/auth/google/callback`. Firebase Android app `app.oyee.android` |
| Releases | GitHub Releases: `Oyee-X.Y.Z.apk`, `Oyee-X.Y.Z-macOS.zip`, `SHA256SUMS.txt`. Apps self-update from `releases/latest` |

Toolchain on the maintainer's Mac: `JAVA_HOME=/opt/homebrew/opt/openjdk@21`,
`ANDROID_HOME=/opt/homebrew/share/android-commandlinetools`, Xcode installed, Playwright's Chromium in
`~/Library/Caches/ms-playwright` (handy for headless screenshots of the web app).

---

## 2. Deploy the server and web app

The server and web app deploy continuously from `main`. They aren't tied to app release tags.

```sh
pnpm install            # once per checkout
pnpm --dir apps/server exec wrangler login    # once per machine
pnpm deploy             # from the repo root
```

`pnpm deploy` does three things:
1. builds `apps/web`,
2. applies pending D1 migrations to production (`wrangler d1 migrations apply oyee --remote`; it asks for confirmation),
3. runs `apps/server/scripts/deploy.mjs`, which is `wrangler deploy` plus `--domain <host>` for each line of
   `.extra-domains`.

**`apps/server/.extra-domains` must exist before you deploy.** Wrangler replaces the custom-domain list on every
deploy, so a deploy without the file detaches the backup domain. On a new machine, recreate the file (the hostname is
in the maintainer's notes, not in this repo).

**Verify after deploying:**
```sh
curl https://oyee.app/healthz                       # {"ok":true}
curl https://oyee.app/api/config                    # fcmEnabled: true, vapidPublicKey set, devLogin: false
curl -o /dev/null -w "%{http_code}\n" https://oyee.app/api/usage   # 401 (auth required)
# repeat healthz for the backup domain
```

**Rollback:** `pnpm --dir apps/server exec wrangler rollback` restores the previous Worker version. D1 migrations
are forward-only, so fix schema mistakes with a new migration.

**Logs:** `pnpm --dir apps/server exec wrangler tail`.

### 2.1 Changing the D1 schema
1. Edit `apps/server/src/db/schema.ts`.
2. `pnpm --filter @oyee/server db:generate`. drizzle-kit writes `migrations/000N_<random>.sql`.
3. Rename the file to something descriptive and change the matching `tag` in `migrations/meta/_journal.json`.
4. Run the tests (they apply all migrations), commit, `pnpm deploy`.

Per-user data (notifications, deadlines, quota counters) lives in each user's InboxDO SQLite instead. Its tables are
created with `CREATE TABLE IF NOT EXISTS` in `InboxDO.migrate()` (`apps/server/src/inbox/do.ts`). Add new tables
there. Changing an existing table needs a one-time, versioned step (`meta.schema`, see `migrateToV2()`, which
converted stored rows to protocol v2 and dropped the thread, replace-key and templates storage); it runs when each
inbox first wakes after the deploy, so it must be idempotent and must not need the network.

### 2.2 Secrets
- Rotate one: `pnpm --dir apps/server exec wrangler secret put NAME`, then update `secrets/prod-secrets.json`.
- Re-upload all of them (e.g. after recreating the Worker):
  `pnpm --dir apps/server exec wrangler secret bulk ../../secrets/prod-secrets.json`.
- Consequences: a new `SESSION_SECRET` signs everyone out and resets the per-IP sign-up counters. A new VAPID key pair means
  every browser has to re-enable notifications. Google and Firebase credentials can be regenerated in their consoles.

### 2.3 Domains
- To add or move the primary domain: `routes` in `wrangler.jsonc`, `PUBLIC_URL`, `VAPID_SUBJECT`, the OAuth redirect
  URI in Google Cloud, `REPO`/URLs in the clients if they hardcode the server (`Pairing.defaultServerURL` on Apple,
  `oyeeServerUrl` on Android).
- To add an extra domain without putting it in the repo: add a line to `.extra-domains`, add its OAuth redirect URI
  in Google Cloud, then `pnpm deploy`. OAuth uses the request's own origin, so sign-in works on every domain.

---

## 3. Publish an app release (Android + macOS)

The tag is the only place the version is set. Nothing in the code needs bumping. `vX.Y.Z` gives versionName `X.Y.Z`
and Android versionCode `X·10000 + Y·100 + Z`. It must be higher than every earlier release, and a version number is
never reused.

1. **Green build locally:**
   ```sh
   pnpm typecheck && pnpm test
   (cd apps/android && ./gradlew testDebugUnitTest)
   (cd apps/apple && swift test)
   ```
2. **CHANGELOG:** add `## X.Y.Z` at the top with the user-visible changes for the apps.
3. **Commit and tag:**
   ```sh
   git commit -am "Release X.Y.Z" && git push
   git tag vX.Y.Z && git push origin vX.Y.Z
   ```
4. **Watch the workflow** (`.github/workflows/release.yml`, about 6–10 minutes):
   ```sh
   gh run list --workflow release.yml -L 1
   gh run watch <run-id> --exit-status
   ```
   Jobs: `version`, then `android` (unit tests, signed APK) and `macos` (Swift tests, universal app) in parallel, then
   `release` (checksums, notes, `gh release create`).
   - **macOS job "cancelled" after ~15 min with no steps run:** GitHub had no `macos-15` runner free. Re-run just that
     job: `gh run rerun <run-id> --failed`.
5. **Verify the published files:**
   ```sh
   D=$(mktemp -d) && cd $D && gh release download vX.Y.Z -R Nishkalkashyap/oyee
   shasum -a 256 -c SHA256SUMS.txt
   $ANDROID_HOME/build-tools/36.0.0/aapt2 dump badging Oyee-X.Y.Z.apk | head -1      # versionCode / versionName
   $ANDROID_HOME/build-tools/36.0.0/apksigner verify --print-certs Oyee-X.Y.Z.apk  # SHA-256 must be 91e16645…d032
   ```
6. **Self-update rollout** (no action needed):
   - **macOS** release builds check about 15 s after launch and every 6 hours, then download, verify the checksum,
     swap the app in `/Applications` and relaunch. To trigger it right away, quit and reopen the app.
   - **Android** release builds check on app open and every 12 hours, then post an "Oyee X.Y.Z is available"
     notification and an inbox banner. **Update** downloads through the system DownloadManager; the user taps
     "Download complete" (or **Install**) and confirms. Phones on 0.2.3 or older still update through the browser.

**Withdraw a broken release:** `gh release delete vX.Y.Z --cleanup-tag --yes`, mark it `(withdrawn)` in the
CHANGELOG, and publish a higher version. Deleting it alone doesn't help phones or Macs that already installed it.

**Build like CI, locally:**
```sh
# signed release APK (same key as CI)
export OYEE_KEYSTORE_FILE=~/oyee-release-signing/oyee-release.jks OYEE_KEY_ALIAS=oyee
export OYEE_KEYSTORE_PASSWORD=… OYEE_KEY_PASSWORD=…        # from ~/oyee-release-signing/README.txt
(cd apps/android && ./gradlew assembleRelease -PoyeeVersionName=X.Y.Z -PoyeeVersionCode=XYYZZ)
# release-style macOS app. OYEE_VERSION also turns on self-update (Info.plist OyeeAutoUpdate)
(cd apps/apple && UNIVERSAL=1 OYEE_VERSION=X.Y.Z scripts/build-macos-app.sh)
```
Builds without `OYEE_VERSION` (macOS) and debug builds (Android) never update themselves.

---

## 4. Testing

| What | Command | Notes |
|---|---|---|
| Schema + server + web | `pnpm test` | The server suite (70 tests) runs real Durable Objects, D1 and the rate limiter in workerd, with push endpoints mocked |
| Android | `cd apps/android && ./gradlew testDebugUnitTest` | JVM unit tests |
| Apple | `cd apps/apple && swift test` | Swift Testing, OyeeKit |
| Web UI without a backend | `pnpm --filter @oyee/web dev`, open `/?mock=1` | In-memory fake API and live events |
| End to end locally | `pnpm dev`, sign in at `/auth/dev-login?email=you@example.com&redirect=/` | Android emulator reaches the host at `http://10.0.2.2:8787` |
| On a phone | `adb install -r <apk>` | Release-signed APKs install over release builds only (debug builds use a different key) |

---

## 5. Limits (abuse protection)

Per-account daily quotas, per-minute bursts, caps on devices/tokens, coalesced update pushes, and per-IP
limits on sign-ups and failed auth. The numbers and behaviour are in [protocol.md §3.1](protocol.md#31-limits).
The values are in `LIMITS` / `QUOTAS` in `packages/schema/src/index.ts`, and the per-IP failure limit is also in
`ratelimits` in `wrangler.jsonc`. Counters live in each user's InboxDO (`usage` table) and in D1 `ip_counters`
(HMAC of the IP, never the raw address).

---

## 6. Known gotchas

- **Play Protect "Harmful app blocked":** caused by `REQUEST_INSTALL_PACKAGES`. Never add it back (see AGENTS.md).
- **Brave** stalls APK downloads at 100%, and blocks Web Push until *Use Google services for push messaging* is on.
- **macOS Gatekeeper:** the app is ad-hoc signed, not notarized. On first launch, if it's blocked: *System Settings
  → Privacy & Security → Open Anyway*. Right-click → Open no longer works on current macOS.
- **GitHub `macos-15` runners** sometimes never start, and the job is cancelled after about 15 minutes in the queue.
  Re-run it with `gh run rerun <id> --failed`.
- **Custom domains disappear** if anyone runs bare `wrangler deploy`. Fix: `pnpm deploy`.
- **New domains look dead locally** when the resolver cached NXDOMAIN from before the DNS existed. Check with DoH
  (`curl --doh-url https://cloudflare-dns.com/dns-query …`) before debugging the Worker.
- **pnpm 12** blocks dependency build scripts unless they're allowed (`allowBuilds` for esbuild and workerd in
  `pnpm-workspace.yaml`).
- **Android + kotlinx.serialization** with `encodeDefaults = false` silently drops fields that have defaults. This
  broke pairing once (`platform` was missing).
- **Android library versions** are pinned to ones compatible with compileSdk 36 (see `apps/android/README.md`).
