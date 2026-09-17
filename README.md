# Crypto Price Ticker for VS Code

Monitor real-time cryptocurrency prices directly in your Visual Studio Code status bar. Stay updated with the latest prices for Bitcoin, Ethereum, and any other supported coins from Binance and OKX exchanges while you code.

## Key Features

- **Live Crypto Prices**: View up-to-date prices for your favorite cryptocurrencies such as BTC, ETH, and more.
- **Multiple Providers Supported**: Fetch data from top exchanges: **Binance** and **OKX**.
- **Customizable Tickers**: Choose coins, quote currencies, providers, colors, and display templates.
- **Track Multiple Coins**: Add as many tickers as you want.
- **Auto Refresh**: Set your own refresh interval or update only when VS Code is focused.
- **Lightweight & Fast**: Minimal impact on your workflow and system resources.

## Installation

1. Open Visual Studio Code.
2. Go to the Extensions view (`Ctrl+Shift+X`).
3. Search for `crypto-price-ticker` and install it.
4. Or install directly from [Visual Studio Marketplace][marketplace].

[marketplace]: https://marketplace.visualstudio.com/items?itemName=Mavis2103.crypto-price-ticker

## How to Use

### Folding the Ticker

The status bar shows a small **pulse icon** on the left. Prices are folded behind it by default to keep your status bar clean:

- **Click the icon** to show the crypto prices (the icon switches to a chart).
- **Click it again** to hide them.

Your choice is remembered for the next session. You can also run the **Toggle Crypto Price Ticker** command from the command palette (`Ctrl+Shift+P`).

### Configuration

Edit your VS Code `settings.json` to customize the extension:

```jsonc
// Refresh interval in seconds
"crypto-price-ticker.interval": 60,

// Only refresh when VSCode window is focused (true/false)
"crypto-price-ticker.onlyRefreshWhenFocused": false,

// Color when price increases
"crypto-price-ticker.higherColor": "lightgreen",

// Color when price decreases
"crypto-price-ticker.lowerColor": "coral",

// Array of ticker definitions (User settings only — see below)
"crypto-price-ticker.tickers": [
  {
    "symbol": "BTC",
    "currency": "USDT",
    "provider": "Binance",
    "market": "spot",
    "template": "{symbol} {price} {percent}"
  },
  {
    "symbol": "ETH",
    "currency": "USDT",
    "provider": "OKX",
    "market": "swap",
    "template": "{symbol} {price} {percent}"
  }
]
```

> **Keep your settings out of git.** The `crypto-price-ticker.tickers` setting is scoped to **User settings** on purpose — VS Code will refuse to write it into a workspace `.vscode/settings.json`, so it can never be committed to a repository. Open it with `Ctrl+Shift+P` → `Preferences: Open User Settings (JSON)`.

### API Keys (Secret Storage)

API keys are stored in VS Code's **Secret Storage** (encrypted with your OS keychain), never in settings files:

1. Run `Ctrl+Shift+P` → **Set API Keys**.
2. Pick the provider, then paste your API key and secret key. Both inputs are masked.
3. Keys take effect immediately. Run **Clear API Keys** to remove them.

Keys are optional on both providers — they only raise rate limits. If you previously stored keys under `crypto-price-ticker.providers`, they still work as a fallback, but a warning will nudge you toward Secret Storage.

### Market Types

Each ticker can fetch from the spot market or a derivatives market:

| Provider | `market` | Example pair |
| -------- | -------- | ------------ |
| Binance | `spot` | `BTCUSDT` |
| Binance | `futures` (USDⓈ-M perpetual) | `BTCUSDT` |
| OKX | `spot` | `BTC-USDT` |
| OKX | `swap` (perpetual) | `BTC-USDT-SWAP` |

A `market` a provider doesn't serve (e.g. `swap` on Binance) silently falls back to `spot`.

### Template Tags

| Tag     | Description                       |
| ------- | --------------------------------- |
| symbol  | Cryptocurrency symbol (e.g., BTC) |
| market  | Market badge: `Ⓢ` spot, `Ⓜ` futures, `Ⓟ` swap |
| price   | Current price                     |
| open    | Opening price for the period      |
| high    | Highest price in the period       |
| low     | Lowest price in the period        |
| change  | Price difference from opening     |
| percent | Percentage change from opening    |

**Example:**

```jsonc
"template": "{symbol} {price} {percent}"
```

The default template is `{symbol}{market} {price}`, which renders as `BTCⓈ 67000.00` for a spot ticker and `BTCⓂ 67000.00` for a futures one. Remove `{market}` from the template to hide the badge.

### Example Configuration

```jsonc
"crypto-price-ticker.tickers": [
  {
    "symbol": "BTC",
    "currency": "USDT",
    "provider": "Binance",
    "market": "futures",
    "template": "{symbol}: {price} ({percent})"
  },
  {
    "symbol": "ETH",
    "currency": "USDT",
    "provider": "OKX",
    "market": "swap",
    "template": "{symbol}: {price} ({percent})"
  }
]
```

API keys are **not** set here — use the **Set API Keys** command described above.

## Supported Crypto Data Providers

- **Binance** — [binance.com](https://binance.com)
- **OKX** — [okx.com](https://okx.com)

## API Rate Limits

> **Important:** Both Binance and OKX enforce API rate limits. Setting a very low refresh interval or tracking too many tickers may result in temporary bans or incomplete data.
>
> - **Binance**: [API rate limits](https://binance-docs.github.io/apidocs/spot/en/#limits) apply per IP and endpoint.
> - **OKX**: [API rate limits](https://www.okx.com/docs-v5/en/#rest-api-rate-limit) also apply per IP and endpoint.
>
> **Recommendation:** Use a refresh interval of 60 seconds or higher and limit the number of tracked tickers for best results. Providing API keys (optional) can help increase your rate limits and access more data.

## Screenshot

![Crypto Price Ticker VS Code Example](https://github.com/Mavis2103/Crypto-Tricker/raw/master/images/default.png)

## Why Use Crypto Price Ticker for VS Code?

- Instantly see crypto prices without leaving your coding environment.
- Highly customizable and easy to set up.
- Supports the most popular exchanges and coins.

## License

[MIT](LICENSE.md)

---

**Crypto Price Ticker for VS Code** — The best way to keep track of cryptocurrency prices while coding!
