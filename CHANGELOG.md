# Change Log

## 1.0.1

### Fixed

- Folded ticker prices no longer reappear on the status bar after an extension-host restart, reload, or reinstall. Id-based status bar items were restored as visible by VS Code; they are now hidden immediately when the ticker is collapsed.

## 1.0.0

First Marketplace release of **Crypto Price Ticker Plus** (`cmxx648.crypto-price-ticker-plus`), a fork of [Mavis2103/Crypto-Tricker](https://github.com/Mavis2103/Crypto-Tricker).

### Added

- K-line (candlestick) chart in a dedicated **Crypto** panel, fed by Binance and OKX public kline endpoints
- Foldable status bar ticker (pulse icon; collapsed by default)
- Binance USDⓈ-M futures and OKX perpetual swap markets
- Secret Storage API keys via **Set API Keys** / **Clear API Keys**
- Chart settings: ticker, interval, candle count, refresh cadence, and scale

### Changed

- Publisher is `cmxx648`; extension id is `crypto-price-ticker-plus`
- Settings and commands keep the `crypto-price-ticker.*` prefix so existing User settings still apply
