# AGENTS.md

Guidance for AI coding agents (and humans) working in this repository.

## What this is

A DeepSeek Harness (DSH) **bundle plugin**: a single ESM module (`index.js`)
plus a `cordis.patch.yml` that plugs a Brave Search–backed `WebSearchProvider`
into the harness's `ctx.web` seam. There is no build step, no test framework,
no runtime dependencies.

## Non-negotiables

1. **No runtime dependencies.** Everything imported (`@deepseek-ai/schemastery`,
   `@deepseek-ai/dsh-credentials`, `@deepseek-ai/dsh-launch-environment`,
   `@deepseek-ai/dsh-settings`, `@deepseek-ai/dsh-web`) must stay in
   `peerDependencies`. The DSH host provides them. Adding a `dependencies`
   entry for a runtime lib is a design decision, not a drive-by change.
2. **No install scripts, no telemetry, no network beyond the search API.**
   Never add `preinstall`/`postinstall`/`prepare` scripts or any call that
   phones home except the actual Brave Search request.
3. **Keep the module self-contained.** The only public surface is what
   `export { apply, inject, name, Config }` exposes. The loader calls
   `apply(ctx, config)`.
4. **`name` must stay `"web-search-brave"`** (the module name the loader
   keys on) and the provider id must stay `"brave-search"` (the value users
   set as `searchProvider` in their profile patch). Renaming either silently
   breaks existing profiles.
5. **The rate limiter is intentional.** Concurrent `web_search` calls share
   one `RateLimiter` with a promise chain; do not "simplify" it away. This
   is what keeps the plugin under Brave's rate limit when the agent fans out
   parallel searches.

## Conventions

- **Style:** plain modern ESM JavaScript, no TypeScript, no transpiler.
  Class fields, private `#` members, template-free strings are fine.
- **Errors:** use `WebError(message, code)` from `@deepseek-ai/dsh-web`.
  Codes in use: `WEB_PROVIDER_ERROR`, `WEB_PROVIDER_CREDENTIAL_MISSING`,
  `WEB_ABORTED`. Keep these stable; the host and UI display them.
- **Abort handling:** every await in a request path should honor the passed
  `AbortSignal` (see `throwIfSearchAborted`, `sleep`, and the fetch signal).
  If you add an async step, wire in the signal.
- **Config:** new options go in the `Config` zod schema and are resolved in
  `resolveOptions()`. Secret-shaped values get `role("secret")`; env-var
  references use `role("credential-ref")`.
- **Versioning:** bump the `USER_AGENT` version in `index.js` when changing
  wire-visible behavior, and update `version` in `package.json` +
  `CHANGELOG.md` on every publish.
- **Docs:** the README, CHANGELOG, and this file must match the code. If
  behavior changes, update them in the same commit.

## Verification checklist before publishing

- [ ] `dsh --profile web --dump-config | grep -A3 brave` shows the bundle
      and its patch row after `bash install.sh`.
- [ ] `node --input-type=module -e "await import('@deads-inc/dsh-web-search-brave')"`
      (run from the profile dir after `bash install.sh`) loads with no
      errors and exposes `{apply, inject, name, Config}`.
- [ ] Smoke search works end-to-end with a real `BRAVE_API_KEY`
      (`dsh --profile web "<prompt that uses web_search>"`).
- [ ] Concurrent searches (3+ in one turn) all succeed — the limiter
      serializes them; no 429 retries unless genuinely over quota.
- [ ] `version`, `USER_AGENT`, and `CHANGELOG.md` are consistent.
- [ ] `npm pack --dry-run` shows only the intended files.

## Repo layout

- `index.js` — the entire plugin (provider, rate limiter, config, apply).
- `cordis.patch.yml` — bundle-level patch (inserts provider registration).
- `install.sh` — installs this checkout into the local web profile.
- `package.json` — manifest; `dsh.bundle.patch` points at the yml.
- `README.md` — user-facing docs. `AGENTS.md` — this file.
- `CHANGELOG.md` — release history.
