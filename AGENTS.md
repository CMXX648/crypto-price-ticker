# CLAUDE.md

This file provides guidance to agent/harness when working with code in this repository.

## What this is

A VS Code extension (`crypto-price-ticker`) that shows live crypto prices in the status bar. Written in TypeScript, bundled with `vsce`. Package manager is **bun** (see `bun.lock`).

## Commands

```bash
bun install              # install dependencies
bun run compile          # tsc -p ./  → emits to out/
bun run watch            # tsc -watch -p ./
bun run build            # vsce package → produces a .vsix
bun run publish          # vsce publish
```

There is no test framework, no lint script, and no CI configured. ESLint config exists (`.eslintrc`, `@typescript-eslint/recommended`) but is not wired to a script — run `npx eslint src` manually if you want to lint.

To run the extension: press `F5` in VS Code (launch config `Run Extension`), which starts the `npm: watch` task first and opens an Extension Development Host with `--extensionDevelopmentPath`.

## Architecture

**Lifecycle (`src/extension.ts`)** — `activate()` calls a module-level `constructor()` which reads the `crypto-price-ticker.*` config, tears down any previous `Tickers` instance and interval, and rebuilds everything. `vscode.workspace.onDidChangeConfiguration` re-invokes `constructor()`, so **any config change fully re-creates the ticker set and providers**. `deactivate()` disposes.

**Two-level data flow (`src/ticker.ts`)** — this is the part that spans multiple files and isn't obvious from reading one:

1. `getTickers(market)` — each provider does ONE bulk request per market type (Binance `api.binance.com/api/v3/ticker/24hr` for spot, `fapi.binance.com/fapi/v1/ticker/24hr` for futures; OKX `instType=SPOT` / `instType=SWAP`), cached in `allTokens[`${provider}:${market}`]`.
2. `getTicker(symbol, currency, market, allTickers)` — does NOT hit the network; it looks the pair up in the already-fetched bulk array and normalizes it to `{price, open, high, low, change, percent}`.

`Tickers` refreshes bulk data on its own 90s `setInterval` (independent of the user-configured refresh interval) and on construction; `refresh()` re-fetches bulk data, then renders each status bar item. Symbol pairs are matched per provider's convention and market: Binance concatenates (`BTCUSDT`, same shape for spot and USDⓈ-M futures), OKX hyphenates (`BTC-USDT` for spot, `BTC-USDT-SWAP` for perpetual swaps) — case-sensitive lookups, so `currency` is uppercased at match time. `getAllTokens()` computes the unique `(provider, market)` pairs the configured tickers actually need, so an unused market is never fetched.

**Markets** — the `market` field (`spot` / `futures` / `swap`) is validated per provider in `extension.ts` against `SUPPORTED_MARKETS` (Binance: spot+futures; OKX: spot+swap) and falls back to `spot` with a console warning when a provider doesn't serve it. OKX dated futures (`instType=FUTURES`, e.g. `BTC-USDT-240329`) are deliberately not supported — the expiry date in the symbol makes them useless as a persistent ticker.

**Credentials** — API keys live in `vscode.SecretStorage` (`context.secrets`), read by `readSecrets()` in `extension.ts` and passed into `Tickers` as `ProviderKeys`. `Tickers.resolveKeys()` prefers secrets and falls back to `crypto-price-ticker.providers` in settings with a warning, so existing key configs keep working. The `crypto-price-ticker.setApiKeys` / `clearApiKeys` commands store/delete under `crypto-price-ticker.<provider>.apiKey|secretKey`, validate via `KeyValidator` (which is why the validator exists), mask input with `password: true`, and rebuild immediately.

**Provider abstraction (`src/providers/`)** — `TickerProvider` interface (`getTicker`/`getTickers`), `BaseTickerProvider` abstract class adding: optional API-key validation on construction, `makeApiRequest` with up-to-3 retries and exponential backoff on network errors, and provider-specific API error detection via `isApiError`/`handleApiError` overrides. Binance additionally shuffles across `api.binance.com`/`api1-3` mirrors with random User-Agents and falls back to alternative sources (CoinGecko, CoinMarketCap, CryptoCompare) if every official endpoint fails — these fallbacks return data converted into the `BinanceTickerData` shape by the `convert*ToBinanceFormat` methods. OKX retries once without auth if an authenticated request fails.

**Resilience** — `lastSuccessfulTokens` per provider is used as a stale-data fallback when a bulk fetch fails after succeeding once; providers are only instantiated once per provider *type* actually used by the configured tickers, not once per ticker.

**Error surface (`src/errors.ts` → `ticker.ts`)** — all provider errors derive from `TickerError` (`AuthError`, `ApiClientError`, `NetworkError`, `ValidationError`). `Tickers.refresh()` switches on `error.name` (a string, not an `instanceof` check) to decide status bar text: `AuthError` → "API Key error", `NetworkError` → "Network error", anything else → "Error".

**Display** — each ticker's `template` string gets sequential `.replace()` calls for `{symbol}`, `{market}`, `{price}`, `{open}`, `{high}`, `{low}`, `{change}`, `{percent}`; `percent` is prefixed with `+` when non-negative. `{market}` resolves to a circled-letter badge distinguishing the market (`Ⓢ` spot, `Ⓜ` futures, `Ⓟ` swap) — it's a plain template tag, so users who don't want it just omit it from their template. Status bar item color comes from `higherColor`/`lowerColor` config based on the sign of `percent`.

`refresh()` renders **twice**: it calls `render()` from the cached `allTokens` first (in-memory, so unfolding the ticker on click feels instant), then `getAllTokens()` fetches fresh data in the background, then `render()` again. The rendering loop lives in `render()`; `refresh()` only orchestrates. This matters because `getTicker()` is declared `async` despite doing no I/O — it's a pure lookup into the bulk array.

**Folded state is the single source of truth for visibility.** Because `refresh()` is async (a collapse can land mid-flight, between `getAllTokens()` and the second `render()`), no code path may call `item.show()` directly on a ticker item — it must go through `showItem()`, which no-ops while `collapsed`. This is what keeps the toggle icon and the data from desyncing under rapid clicking. `toggle()` hiding the items synchronously on collapse is the other half of the invariant. (`updateToggleItem()` calls `.show()` on `toggleItem` directly — that icon must stay visible in both states.)

**Folding the ticker** — a dedicated status bar item (`toggleItem`, created with priority `tickers.length` so it sits leftmost) shows a `$(chart)`/`$(eye)` codicon and is bound to the `crypto-price-ticker.toggle` command (registered once in `activate`, declared in `contributes.commands`). `Tickers.toggle()` flips `collapsed`, persists it to `context.workspaceState` under `crypto-price-ticker.collapsed`, hides the ticker items or calls `refresh()`. `refresh()` early-returns while collapsed, so no data is rendered until unfolded. The default is folded. Note this means `Tickers` now takes an optional `vscode.Memento` second argument, threaded in from `extension.ts`'s `constructor(context)`.

## Gotchas

- The `exchange` field appears in `Ticker`, the `package.json` config schema, and the mapped config in `extension.ts`, but is **never used** — `provider` is what selects the data source. Don't assume it's wired up.
- Status bar items are keyed by `symbol` alone (`this.items[ticker.symbol]`), so two tickers with the same symbol but different currencies/providers will clobber each other.
- `Tickers.dispose()` hides/disposes the status bar items but does not clear the internal 90s `getAllTokens` interval — that interval is only stopped by `extension.ts` clearing its own interval on rebuild.
- `refresh()` swallows its work in an immediately-invoked async IIFE, so callers awaiting `refresh()` do not await the actual fetch. It also early-returns when the ticker is folded, so `refresh()` is what unfolds the data on toggle.
- The `crypto-price-ticker.toggle` command must be registered in `activate` only — `constructor()` runs on every config change, so registering it there would duplicate the command.
- `constructor()` (module-level, not a real constructor) is `async` because reading `SecretStorage` is async. It guards with a `rebuilding` flag and drops concurrent invocations — if you edit `settings.json` while a rebuild is mid-flight, that rebuild is skipped and the *previous* config keeps running until the next change. Errors inside are caught and surfaced via `showErrorMessage`.
- `crypto-price-ticker.tickers` and `crypto-price-ticker.providers` are declared `scope: "application"` in `package.json`, so VS Code refuses to write them into workspace `.vscode/settings.json`. This is intentional (keeps personal config and API keys out of git) but **breaking for existing users** who have them in workspace settings — those values are silently ignored after upgrade. The `providers` setting is now a deprecated fallback; the primary path is Secret Storage.
- Config is read as untyped `any` from `vscode.workspace.getConfiguration().get('crypto-price-ticker')` in several places. Every key in `contributes.configuration.properties` must be prefixed with `crypto-price-ticker.` — an unprefixed key silently never applies (this was the `lowerColor` bug: the setting wrote to a namespace nobody read, and the code fell back to hardcoded `coral`).

## Conventions

- Every `src/*.ts` file starts with the MIT copyright header. Keep the original `// Copyright (c) Mavis2103. Licensed under the MIT license.` line and add `// Copyright (c) cmxx648. Licensed under the MIT license.` for this fork, followed by `// See LICENSE file in the project root for full license information.`
- TypeScript is in `strict` mode, target `es6`, `module: commonjs`, `rootDir: src`, `outDir: out`. Only `src/` is compiled; `.vscodeignore` strips `.ts`/`.map` files from the packaged `.vsix`.
- HTTP is done with `got` v11 (imported as a default import, CommonJS).
