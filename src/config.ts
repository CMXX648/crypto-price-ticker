// Copyright (c) Mavis2103. Licensed under the MIT license.
// See LICENSE file in the project root for full license information.

import { Ticker } from './ticker';
import { KlineInterval } from './providers';

// the providers that can be configured
export const SUPPORTED_PROVIDERS = ['Binance', 'OKX'] as const;

// the market types a provider supports
export const SUPPORTED_MARKETS: { [provider: string]: string[] } = {
  Binance: ['spot', 'futures'],
  OKX: ['spot', 'swap']
};

// the candle intervals the chart offers
export const KLINE_INTERVALS: KlineInterval[] = ['1m', '5m', '15m', '1h', '4h', '1d'];

// defaults for the chart, mirrored in the configuration schema in package.json
export const DEFAULT_REFRESH_SECONDS = 15;
export const DEFAULT_CHART_SCALE = 100;
export const DEFAULT_HIGHER_COLOR = 'lightgreen';
export const DEFAULT_LOWER_COLOR = 'coral';
const DEFAULT_CANDLES = 60;
const MIN_CANDLES = 10;
const MAX_CANDLES = 300;
const MIN_REFRESH_SECONDS = 5;
const MAX_REFRESH_SECONDS = 600;
const MIN_CHART_SCALE = 40;
const MAX_CHART_SCALE = 100;

// everything the chart needs in order to draw a frame
export interface ChartConfig {
  ticker: Ticker;
  interval: KlineInterval;
  candles: number;
  refreshSeconds: number;
  scale: number;
  upColor: string;
  downColor: string;
}

// normalize the ticker definitions — the single source of truth shared by the status
// bar tickers and the chart, so both always agree on the provider and the market
export function readTickers(configuration: any): Ticker[] {
  const definitions: any[] = configuration?.tickers || [];

  return definitions.map((definition: any) => {
    const provider = SUPPORTED_PROVIDERS.includes(definition.provider) ? definition.provider : 'Binance';

    // a market the provider does not serve falls back to spot
    const market = definition.market;
    if (market && !SUPPORTED_MARKETS[provider].includes(market)) {
      console.warn(`crypto-price-ticker: market "${market}" is not supported by ${provider}, falling back to spot`);
    }

    return {
      symbol: definition.symbol || 'BTC',
      currency: definition.currency || 'USDT',
      exchange: definition.exchange,
      template: definition.template || '{symbol}{market} {price}',
      provider,
      market: market && SUPPORTED_MARKETS[provider].includes(market) ? market : 'spot'
    };
  });
}

// the ticker the chart follows: an explicit override, otherwise the first configured one
export function readChartConfig(configuration: any): ChartConfig | undefined {
  const tickers = readTickers(configuration);
  if (tickers.length === 0) {
    return undefined;
  }

  return {
    ticker: findChartTicker(tickers, configuration?.chartTicker),
    interval: KLINE_INTERVALS.includes(configuration?.chartInterval) ? configuration.chartInterval : '1m',
    candles: clamp(configuration?.chartCandles, DEFAULT_CANDLES, MIN_CANDLES, MAX_CANDLES),
    refreshSeconds: clamp(configuration?.chartRefreshSeconds, DEFAULT_REFRESH_SECONDS, MIN_REFRESH_SECONDS, MAX_REFRESH_SECONDS),
    scale: clamp(configuration?.chartScale, DEFAULT_CHART_SCALE, MIN_CHART_SCALE, MAX_CHART_SCALE),
    upColor: readColor(configuration?.higherColor, DEFAULT_HIGHER_COLOR),
    downColor: readColor(configuration?.lowerColor, DEFAULT_LOWER_COLOR)
  };
}

// pick a configured ticker for the chart so the source is always one of the status
// bar listings — empty means the first one; otherwise match by symbol, pair, or
// pair + provider + market so two BTC listings can be told apart
export function findChartTicker(tickers: Ticker[], requested: any): Ticker {
  const query = typeof requested === 'string' ? requested.trim().toUpperCase().replace(/\s+/g, ' ') : '';
  if (!query) {
    return tickers[0];
  }

  let best = tickers[0];
  let bestScore = 0;
  for (const ticker of tickers) {
    const score = scoreTickerMatch(ticker, query);
    if (score > bestScore) {
      best = ticker;
      bestScore = score;
    }
  }

  if (bestScore === 0) {
    console.warn(`crypto-price-ticker: chartTicker "${query}" did not match a configured ticker, using ${best.symbol}/${best.currency} ${best.provider} ${best.market}`);
  }

  return best;
}

function scoreTickerMatch(ticker: Ticker, query: string): number {
  const symbol = ticker.symbol.toUpperCase();
  const currency = ticker.currency.toUpperCase();
  const provider = ticker.provider.toUpperCase();
  const market = String(ticker.market).toUpperCase();
  const pair = `${symbol}/${currency}`;
  const compactQuery = query.replace(/[\s/_-]/g, '');

  if (query === `${pair} ${provider} ${market}` || compactQuery === `${symbol}${currency}${provider}${market}`) {
    return 100;
  }
  if (query === `${pair} ${provider}` || compactQuery === `${symbol}${currency}${provider}`) {
    return 80;
  }
  if (query === pair || query === `${symbol}-${currency}` || query === `${symbol}${currency}` || compactQuery === `${symbol}${currency}`) {
    return 60;
  }
  if (query === symbol) {
    return 40;
  }
  return 0;
}

function readColor(value: any, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

// the settings are user editable, so never trust them to be sane numbers
function clamp(value: any, fallback: number, minimum: number, maximum: number): number {
  const parsed = typeof value === 'number' ? value : parseFloat(value);
  if (!isFinite(parsed)) {
    return fallback;
  }

  return Math.min(Math.max(Math.round(parsed), minimum), maximum);
}
