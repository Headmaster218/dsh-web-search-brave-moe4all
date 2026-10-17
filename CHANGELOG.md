# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0-moe4all.3] - 2026-10-17

- 增加仓库独立的 npm 下载缓存与 draft release 验收入口，开发 CI 和发布 CI 复用同一套本地实现。
- 保留原有离线测试与包校验；搜索请求、USER_AGENT 和运行逻辑不变。

## [1.0.0-moe4all.2] - 2026-10-16

- 将 `-moe4all.N` 定制修订发布到正式更新通道，修复能力中心默认无法发现更新的问题。
- 补充正式版与 beta、rc、preview 的发布通道回归检查；搜索运行逻辑不变。

## [1.0.0] - 2026-08-20

Initial public release.

### Added
- Concurrency-safe rate limiter: concurrent `web_search` calls are serialized
  through a shared promise chain with a configurable 1500ms gap (default),
  keeping the plugin under Brave's rate limit when the agent fans out
  parallel searches.
- Exponential backoff with jitter on 429/403 responses, honoring `Retry-After`
  (capped at 30s, up to 3 attempts).
- `BRAVE_SEARCH_BASE_URL` env override for proxies and testing.
- Full publishing package: README, AGENTS.md, LICENSE, CHANGELOG, keywords,
  and a complete `package.json` with `peerDependencies` covering every
  imported `@deepseek-ai/*` package.

### Changed
- Adopted a scoped npm name, `@deads-inc/dsh-web-search-brave`.
- Repo layout flattened to standard DSH bundle-plugin convention
  (`index.js` at root).
- USER_AGENT now reflects the public package version.

## [0.1.1] - 2026-08-19

- Rate limiting and backoff under concurrent searches.
- Initial local prototype.
