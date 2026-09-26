/**
 * Brave Search API provider for the DeepSeek Harness web capability seam.
 */
import z from "@deepseek-ai/schemastery";
import { credentialRef } from "@deepseek-ai/dsh-credentials";
import { installSettingsSection, settingsNamespace } from "@deepseek-ai/dsh-settings";
import { launchEnvironmentOf } from "@deepseek-ai/dsh-launch-environment";
import { WebError } from "@deepseek-ai/dsh-web";

const BRAVE_PROVIDER_ID = "brave-search";
const BRAVE_DEFAULT_BASE_URL = "https://api.search.brave.com/res/v1/web/search";
const USER_AGENT = "dsh-web-search-brave-moe4all/1.0.0";

const name = "web-search-brave-moe4all";
const inject = ["web"];
const DEFAULT_API_KEY_ENV = "BRAVE_API_KEY";
const DEFAULT_THROTTLE_MS = 1500;
const DEFAULT_MAX_ATTEMPTS = 3;
const MAX_BACKOFF_MS = 30_000;
const BACKOFF_BASE_MS = 1000;

const Config = z.object({
  apiKey: z.string().role("secret"),
  apiKeyEnv: z.string().role("credential-ref").default(DEFAULT_API_KEY_ENV),
  baseURL: z.string(),
  throttleMs: z.number().min(0).step(1),
  maxAttempts: z.number().min(1).step(1),
});

const BRAVE_SEARCH_SETTINGS_NAMESPACE = settingsNamespace("web-search-brave-moe4all");

function toInt(value, fallback) {
  if (value === void 0) return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function resolveOptions(ctx, config) {
  const apiKeyEnv = credentialRef(config.apiKeyEnv ?? DEFAULT_API_KEY_ENV);
  const literalApiKey = config.apiKey !== void 0 && config.apiKey.length > 0 ? config.apiKey : void 0;
  const env = launchEnvironmentOf(ctx);
  return {
    ...literalApiKey === void 0 ? {} : { apiKey: literalApiKey },
    resolveApiKey: async () => {
      const credentials = ctx.get("credentials");
      if (credentials !== void 0) return (await credentials.resolve(apiKeyEnv))?.value;
      const ambient = env.get(apiKeyEnv);
      return ambient !== void 0 && ambient.value.length > 0 ? ambient.value : void 0;
    },
    apiKeyEnv,
    baseURL: config.baseURL ?? env.get("BRAVE_SEARCH_BASE_URL")?.value ?? BRAVE_DEFAULT_BASE_URL,
    throttleMs: toInt(config.throttleMs, DEFAULT_THROTTLE_MS),
    maxAttempts: Math.max(1, toInt(config.maxAttempts, DEFAULT_MAX_ATTEMPTS)),
  };
}

class RateLimiter {
  #minGapMs;
  #lastEnd = 0;
  #chain = Promise.resolve();

  constructor(minGapMs) {
    this.#minGapMs = minGapMs;
  }

  acquire(signal) {
    const run = this.#chain.then(async () => {
      throwIfSearchAborted(signal);
      const now = Date.now();
      const gap = this.#lastEnd + this.#minGapMs - now;
      if (gap > 0) await sleep(gap, signal);
      return Date.now();
    });
    this.#chain = run.then(
      (at) => { this.#lastEnd = at; return at; },
      () => { this.#lastEnd = Date.now(); }
    );
    return run;
  }
}

class BraveSearchProvider {
  id = BRAVE_PROVIDER_ID;
  #resolveOptions;
  #limiter;
  #limiterThrottleMs;

  constructor(resolveOptions) {
    this.#resolveOptions = resolveOptions;
  }

  #getLimiter(throttleMs) {
    if (this.#limiter === void 0 || this.#limiterThrottleMs !== throttleMs) {
      this.#limiter = new RateLimiter(throttleMs);
      this.#limiterThrottleMs = throttleMs;
    }
    return this.#limiter;
  }

  available() {
    const options = this.#resolveOptions();
    return (
      ((options.apiKey?.length ?? 0) > 0 || options.resolveApiKey !== void 0) &&
      URL.canParse(options.baseURL)
    );
  }

  async search(request, signal) {
    const options = this.#resolveOptions();
    const apiKey = await this.#apiKey(options, signal);
    throwIfSearchAborted(signal);

    const url = new URL(options.baseURL);
    url.searchParams.set("q", request.query);
    url.searchParams.set("count", String(request.maxResults ?? 10));

    const limiter = this.#getLimiter(options.throttleMs);
    const maxAttempts = options.maxAttempts;
    let attempt = 0;

    while (true) {
      attempt += 1;
      await limiter.acquire(signal);
      let response;
      try {
        response = await fetch(url.toString(), {
          method: "GET",
          redirect: "error",
          headers: {
            "Accept": "application/json",
            "Accept-Encoding": "gzip",
            "X-Subscription-Token": apiKey,
            "User-Agent": USER_AGENT,
          },
          ...signal !== void 0 ? { signal } : {},
        });
      } catch (error) {
        if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error);
        throw new WebError(`Brave Search request failed: ${String(error)}`, "WEB_PROVIDER_ERROR", { cause: error });
      }

      if (!response.ok) {
        if (response.status === 429 || response.status === 403) {
          const isQuota = isQuotaErrorHeader(response);
          const hasRetryAfter = response.headers.get("Retry-After") !== null;
          if ((isQuota || (response.status === 429 && hasRetryAfter)) && attempt < maxAttempts) {
            await sleep(backoffMs(response, attempt, signal), signal);
            continue;
          }
        }
        let message = `Brave Search API error (HTTP ${response.status})`;
        try {
          const parsed = await response.json();
          const detail = typeof parsed.detail === "string" ? parsed.detail : parsed.detail?.message ?? parsed.message;
          if (detail !== void 0 && detail.length > 0) message = detail;
        } catch { /* ignore */ }
        if (response.status === 429) {
          const ra = parseRetryAfter(response.headers.get("Retry-After"));
          if (ra !== void 0 && ra > 0) {
            message = `${message}; rate-limited by Brave, retry in ~${Math.max(1, Math.round(ra / 1000))}s`;
          }
        }
        throw new WebError(message, "WEB_PROVIDER_ERROR");
      }

      try {
        const data = await response.json();
        const results = data.web?.results ?? [];
        const seen = new Set();
        const sources = [];
        for (const r of results) {
          if (!r.url || r.url.length === 0 || seen.has(r.url)) continue;
          seen.add(r.url);
          sources.push({
            url: r.url,
            ...(r.title && r.title.length > 0 ? { title: r.title } : {}),
            ...(r.description && r.description.length > 0 ? { snippet: r.description } : {}),
          });
        }
        return { sources, truncated: false };
      } catch (error) {
        if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error);
        throw new WebError(`Brave Search returned an unprocessable response body: ${String(error)}`, "WEB_PROVIDER_ERROR", { cause: error });
      }
    }
  }

  async #apiKey(options, signal) {
    throwIfSearchAborted(signal);
    if (options.apiKey !== void 0 && options.apiKey.length > 0) return options.apiKey;
    let resolved;
    try {
      resolved = await options.resolveApiKey?.();
    } catch (error) {
      if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error);
      throw new WebError(`Brave Search credential resolution failed: ${String(error)}`, "WEB_PROVIDER_ERROR", { cause: error });
    }
    if (resolved !== void 0 && resolved.length > 0) return resolved;
    throw new WebError(
      `Brave Search has no API key for "${options.apiKeyEnv}"; store it via the credentials service or export it in the environment`,
      "WEB_PROVIDER_CREDENTIAL_MISSING"
    );
  }
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    throwIfSearchAborted(signal);
    const timeout = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = () => {
      cleanup();
      reject(searchAborted(signal));
    };
    const cleanup = () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function backoffMs(response, attempt, signal) {
  const fromHeader = parseRetryAfter(response.headers.get("Retry-After"));
  const base = fromHeader ?? BACKOFF_BASE_MS * 2 ** (attempt - 1);
  return Math.min(MAX_BACKOFF_MS, Math.max(base, 1000) * (0.8 + 0.4 * Math.random()));
}

function parseRetryAfter(value) {
  if (!value) return void 0;
  const trimmed = value.trim();
  const asNumber = Number(trimmed);
  if (Number.isFinite(asNumber)) {
    if (asNumber < 1e11) return Math.max(0, asNumber * 1000);
    return Math.max(0, asNumber - Date.now());
  }
  const asDate = Date.parse(trimmed);
  if (!Number.isNaN(asDate)) return Math.max(0, asDate - Date.now());
  return void 0;
}

function isQuotaErrorHeader(response) {
  return response.headers.get("X-Ratelimit-Error") === "429";
}

function throwIfSearchAborted(signal) {
  if (signal?.aborted === true) throw searchAborted(signal);
}

function searchAborted(signal, fallback) {
  return new WebError("Brave Search aborted", "WEB_ABORTED", {
    cause: signal?.aborted === true ? signal.reason : fallback,
  });
}

function isAbortError(error) {
  return error instanceof DOMException && error.name === "AbortError";
}

function apply(ctx, config) {
  let current = () => config;
  installSettingsSection(ctx, BRAVE_SEARCH_SETTINGS_NAMESPACE, Config, config, {
    setSource: (source) => { current = source; },
    onChange: () => {},
  });
  ctx.web.registerSearchProvider(new BraveSearchProvider(() => resolveOptions(ctx, current())));
}

export { apply, inject, name, Config };
