# @deads-inc/dsh-web-search-brave

Brave Search API-backed web search provider for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`). It registers a `WebSearchProvider` into the `ctx.web` seam, so the built-in `web_search` tool works out of the box when you have a Brave Search API key.

- MIT license, ~270 lines of code, zero runtime dependencies
- Concurrency-safe rate limiting (1500ms gap between requests)
- Exponential backoff with jitter on 429s
- Configurable via DSH Settings or env vars

## Install

Requires `BRAVE_API_KEY` from [brave.com/search/api](https://brave.com/search/api/).

**From npm (recommended):**

```bash
dsh plugin --profile web add @deads-inc/dsh-web-search-brave
export BRAVE_API_KEY=<your-key>
```

**From this repo:**

```bash
git clone https://github.com/ChrisDeadman/dsh-web-search-brave.git
cd dsh-web-search-brave
export BRAVE_API_KEY=<your-key>
bash install.sh
```

Restart `dsh web`. Verify the provider is active:

```bash
dsh --profile web --dump-config | grep -A3 brave
```

## How it works

- Registers the `brave-search` provider on the `ctx.web` seam.
- Resolves the API key in this order:
  1. Literal `apiKey` in the config (not recommended).
  2. The `BRAVE_API_KEY` credential stored in the DSH credentials service.
  3. The `BRAVE_API_KEY` env var at launch time.
- Serializes concurrent calls through an in-process rate limiter (1500ms gap, configurable).
- On 429/403, honors `Retry-After`, backs off with exponential + jittered backoff (capped at 30s), up to 3 attempts.

## Configuration

All options are optional; sensible defaults are used.

| Option | Env / Config Key | Default | Notes |
|---|---|---|---|
| API key | `BRAVE_API_KEY` | — | Required. |
| API base URL | `BRAVE_SEARCH_BASE_URL` | `https://api.search.brave.com/res/v1/web/search` | Override for proxies or testing. |
| Throttle (ms) | — | 1500 | Min gap between outbound requests. |
| Max attempts | — | 3 | Retries on 429/403 before failing. |

### Enabling as the active search provider

The plugin registers `brave-search` but does not forcibly enable it. To use it as your search backend, add this to your profile's `cordis.patch.yml`:

```yaml
- id: web
  config:
    searchProvider: brave-search
```

`bash install.sh` does this automatically for you.

## Security notes

- Your `BRAVE_API_KEY` is only ever sent to the configured `baseURL` (default: Brave's official endpoint).
- Custom `baseURL` is an escape hatch for proxies or testing; use it deliberately. The plugin does not validate the URL's domain.
- There are no postinstall scripts, no network calls other than the search API, no telemetry.

## Development

This package is plain ESM with no build step and no runtime dependencies —
everything it imports (`@deepseek-ai/*`) is provided by the host DSH install
as peer dependencies.

To test a local change, run `bash install.sh`, then in a fresh terminal:

```bash
# 1. Confirm the bundle is wired into the composed profile config:
dsh --profile web --dump-config | grep -A3 brave

# 2. (Optional) Import the module directly. This needs the profile's
#    node_modules to already carry the @deepseek-ai/* peers (a web profile
#    that has any dshmarket package does). It fails harmlessly otherwise —
#    dsh itself always resolves the peers from its own installation at boot:
node --input-type=module -e "
  const m = await import('@deads-inc/dsh-web-search-brave');
  if (typeof m.apply !== 'function' || m.name !== 'web-search-brave') throw new Error('bad module');
  console.log('OK: exports:', Object.keys(m).join(', '));
"

# 3. With BRAVE_API_KEY set, run a real end-to-end search:
dsh --profile web "Use web_search to find one page about Node.js 24. Reply with just the URL."
```

See [AGENTS.md](./AGENTS.md) for guidance for AI coding agents working on this repo.

## License

[MIT](./LICENSE).
