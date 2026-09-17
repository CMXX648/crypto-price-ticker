// Copyright (c) Mavis2103. Licensed under the MIT license.
// See LICENSE file in the project root for full license information.

import * as vscode from 'vscode';
import { TickerProvider, MarketType } from './providers';
import { BinanceTickerProvider } from './providers/binance';
import { OKXTickerProvider } from './providers/okx';

// represents a ticker object
export interface Ticker {
  symbol: string;
  currency: string;
  exchange: string;
  template: string;
  provider: string;
  market: MarketType;
}

// a set of credentials for a single provider
export interface ProviderKeySet {
  apiKey?: string;
  secretKey?: string;
}

// credentials for every supported provider
export interface ProviderKeys {
  binance?: ProviderKeySet;
  okx?: ProviderKeySet;
}

// the key used to persist the folded state of the ticker
const COLLAPSED_STATE_KEY = 'crypto-price-ticker.collapsed';

export class Tickers {
  // the tickers status bar item
  private items: { [key: string]: vscode.StatusBarItem } = {};

  // the icon used to fold and unfold the ticker data
  private toggleItem: vscode.StatusBarItem;

  // whether the ticker data is currently folded behind the toggle icon
  private collapsed: boolean;

  private tickers: Ticker[];
  private tickerProviders: TickerProvider[] = [];
  private allTokens: { [key: string]: any[] } = {};
  private lastSuccessfulTokens: { [key: string]: any[] } = {}; // Cache for fallback
  private higherColor: string;
  private lowerColor: string;

  // construct a new ticker based on a ticker definition
  constructor(tickers: Ticker[], private state?: vscode.Memento, private keys?: ProviderKeys) {
    this.tickers = tickers;

    const configuration: any = vscode.workspace.getConfiguration().get('crypto-price-ticker');
    this.higherColor = configuration.higherColor || 'lightgreen';
    this.lowerColor = configuration.lowerColor || 'coral';

    // restore the folded state of the previous session
    this.collapsed = state?.get<boolean>(COLLAPSED_STATE_KEY, true) ?? true;

    // Get unique providers that are actually used
    const usedProviders = [...new Set(this.tickers.map(ticker => ticker.provider))];

    // Create only one instance per provider type
    usedProviders.forEach(providerName => {
      let tickerProvider: TickerProvider;
      switch (providerName) {
        case 'Binance':
          const binanceKeys = this.resolveKeys('Binance', this.keys?.binance, configuration.providers?.binance);
          tickerProvider = new BinanceTickerProvider(binanceKeys.apiKey, binanceKeys.secretKey);
          break;
        case 'OKX':
          const okxKeys = this.resolveKeys('OKX', this.keys?.okx, configuration.providers?.okx);
          tickerProvider = new OKXTickerProvider(okxKeys.apiKey, okxKeys.secretKey);
          break;
        default:
          throw new Error(`Unknown ticker provider: ${providerName}`);
      }
      this.tickerProviders.push(tickerProvider);
    });

    // create status bar items for each symbol
    this.tickers.forEach((ticker, priority) => {
      this.items[ticker.symbol] = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, priority);
    });

    // the toggle icon sits to the left of the tickers and folds their data away
    this.toggleItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, this.tickers.length);
    this.toggleItem.command = 'crypto-price-ticker.toggle';
    this.updateToggleItem();

    this.getAllTokens();
    // Increase interval to reduce rate limiting (90 seconds instead of 60)
    setInterval(() => this.getAllTokens(), 90000);

    // handle the first refresh call
    this.refresh();
  }

  // dispose of the ticker
  dispose() {
    // hide and dispose the status bar item
    Object.values(this.items).forEach(item => {
      item.hide();
      item.dispose();
    });

    // hide and dispose the toggle icon
    this.toggleItem.hide();
    this.toggleItem.dispose();
  }

  // fold or unfold the ticker data behind the toggle icon
  toggle() {
    this.collapsed = !this.collapsed;
    this.state?.update(COLLAPSED_STATE_KEY, this.collapsed);
    this.updateToggleItem();

    // hide the data straight away, refresh to bring it back
    if (this.collapsed) {
      Object.values(this.items).forEach(item => item.hide());
    } else {
      this.refresh();
    }
  }

  // update the toggle icon to reflect the current state
  private updateToggleItem() {
    // the icons are from the built-in codicon set — custom names render as blank
    this.toggleItem.text = this.collapsed ? '$(pulse)' : '$(graph)';
    this.toggleItem.tooltip = this.collapsed ? 'Show crypto prices' : 'Hide crypto prices';
    this.toggleItem.show();
  }

  // the folded state is the single source of truth for the data visibility —
  // an in-flight refresh must never reveal items that were folded mid-flight
  private showItem(item: vscode.StatusBarItem) {
    if (!this.collapsed) {
      item.show();
    }
  }

  // prefer the keys from Secret Storage, fall back to the ones in settings.json
  private resolveKeys(provider: string, secretKeys?: ProviderKeySet, configKeys?: ProviderKeySet): ProviderKeySet {
    if (secretKeys?.apiKey && secretKeys?.secretKey) {
      return secretKeys;
    }

    if (configKeys?.apiKey || configKeys?.secretKey) {
      console.warn(`crypto-price-ticker: ${provider} keys found in settings.json — move them to Secret Storage with the "Set API Keys" command for better security.`);
    }

    return configKeys ?? {};
  }

  // refresh the ticker
  refresh() {
    (async () => {
      // don't render the data while it is folded behind the toggle icon
      if (this.collapsed) {
        return;
      }

      try {
        // render from the cached data first so unfolding the tickers feels instant,
        // then refresh the data in the background and render again with fresh prices
        await this.render();
        await this.getAllTokens();
        await this.render();
      } catch (error: any) {
        console.error('Error refreshing all tickers:', error.message);
        // Display error message on all items
        Object.values(this.items).forEach(item => {
          item.text = 'Connection error';
          item.color = 'red';
          this.showItem(item);
        });
      }
    })();
  }

  // render the status bar items from the cached token data
  private async render() {
    for (const ticker of this.tickers) {
      try {
        const tickerProvider = this.tickerProviders.find(
          provider =>
            (provider instanceof BinanceTickerProvider && ticker.provider === 'Binance') ||
            (provider instanceof OKXTickerProvider && ticker.provider === 'OKX')
        );
        if (!tickerProvider) {
          continue;
        }
        const allTokensForMarket = this.allTokens[`${ticker.provider}:${ticker.market}`];

        // Skip if no data available for this market
        if (!allTokensForMarket || allTokensForMarket.length === 0) {
          console.warn(`No data available for ${ticker.provider}:${ticker.market}, skipping ${ticker.symbol}`);
          continue;
        }

        const tickerData = await tickerProvider.getTicker(ticker.symbol, ticker.currency, ticker.market, allTokensForMarket);
        const item = this.items[ticker.symbol];

        // the badge distinguishes the market the price comes from
        const marketBadge = ticker.market === 'futures' ? 'Ⓜ' : ticker.market === 'swap' ? 'Ⓟ' : 'Ⓢ';

        // set the status bar item text using the template
        item.text = ticker.template
          .replace('{symbol}', ticker.symbol)
          .replace('{market}', marketBadge)
          .replace('{price}', tickerData.price.toString())
          .replace('{open}', tickerData.open.toString())
          .replace('{high}', tickerData.high.toString())
          .replace('{low}', tickerData.low.toString())
          .replace('{change}', tickerData.change.toString())
          .replace('{percent}', (tickerData.percent >= 0 ? '+' : '') + tickerData.percent + '%');
        // set the status bar item colour based on the percent change
        item.color = tickerData.percent < 0 ? this.lowerColor : this.higherColor;
        // make sure the status bar item is visible
        this.showItem(item);
      } catch (error: any) {
        console.error(`Error refreshing ${ticker.symbol} from ${ticker.provider}:`, error.message);
        const item = this.items[ticker.symbol];

        // Display error message on status bar
        if (error.name === 'AuthError') {
          item.text = `${ticker.symbol}: API Key error`;
          item.color = 'red';
        } else if (error.name === 'NetworkError') {
          item.text = `${ticker.symbol}: Network error`;
          item.color = 'orange';
        } else {
          item.text = `${ticker.symbol}: Error`;
          item.color = 'red';
        }
        this.showItem(item);
      }
    }
  }

  async getAllTokens() {
    // the (provider, market) pairs that the configured tickers actually need
    const usedPairs = [...new Set(this.tickers.map(ticker => `${ticker.provider}:${ticker.market}`))];

    for (const tickerProvider of this.tickerProviders) {
      const providerName = tickerProvider instanceof BinanceTickerProvider ? 'Binance' : 'OKX';
      const markets = usedPairs
        .filter(pair => pair.startsWith(`${providerName}:`))
        .map(pair => pair.split(':')[1] as MarketType);

      for (const market of markets) {
        const key = `${providerName}:${market}`;
        try {
          const marketTickers = await tickerProvider.getTickers(market);
          this.allTokens[key] = marketTickers;
          this.lastSuccessfulTokens[key] = marketTickers; // Cache successful data
          console.log(`${providerName} (${market}): Successfully updated token data`);
        } catch (error: any) {
          console.error(`Error retrieving ${market} tokens from ${providerName}:`, error.message);

          // Use cached data if available, otherwise keep current data
          if (this.lastSuccessfulTokens[key]) {
            this.allTokens[key] = this.lastSuccessfulTokens[key];
            console.warn(`${providerName} (${market}): Using cached data due to API error`);
          } else if (!this.allTokens[key]) {
            // If no cached data and no current data, initialize empty array
            this.allTokens[key] = [];
            console.warn(`${providerName} (${market}): No cached data available, using empty array`);
          }
          // If we have current data but no cached data, just keep using current data
        }
      }
    }
  }
}
