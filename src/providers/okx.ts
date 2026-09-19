// Copyright (c) Mavis2103. Licensed under the MIT license.
// Copyright (c) cmxx648. Licensed under the MIT license.
// See LICENSE file in the project root for full license information.

import { BaseTickerProvider, MarketType, KlineInterval, Candle } from '.';
import got from 'got';
import { ApiClientError } from '../errors';

// OKX caps a single candlestick request at 300 bars and uses uppercase units for hours and days
const MAX_CANDLES = 300;
const BAR_MAP: Record<KlineInterval, string> = {
  '1m': '1m',
  '5m': '5m',
  '15m': '15m',
  '1h': '1H',
  '4h': '4H',
  '1d': '1D'
};

export interface OKXTicker {
  price: number;
  open: number;
  high: number;
  low: number;
  change: number;
  percent: number;
}

export interface OKXTickerData {
  instId: string;
  last: string;
  open24h: string;
  high24h: string;
  low24h: string;
}

export class OKXTickerProvider extends BaseTickerProvider {
  constructor(apiKey?: string, secretKey?: string) {
    super(apiKey, secretKey, 'OKX');
  }

  async getTickers(market: MarketType = 'spot'): Promise<OKXTickerData[]> {
    try {
      // perpetual swaps are queried with instType=SWAP, spot pairs with SPOT
      const instType = market === 'swap' ? 'SWAP' : 'SPOT';
      const url = `https://www.okx.com/api/v5/market/tickers?instType=${instType}`;
      const options: any = {
        headers: {}
      };

      if (this.apiKey) {
        options.headers['OK-ACCESS-KEY'] = this.apiKey;
        console.log('OKX: Using API key to increase rate limit');
      }

      const response = await got(url, options);
      const data: { code: string; data: OKXTickerData[]; msg?: string } = JSON.parse(response.body);

      if (data.code !== '0') {
        throw new ApiClientError(`OKX API Error [${data.code}]: ${data.msg || 'Unknown error'}`, parseInt(data.code));
      }

      console.log(`OKX: Successfully retrieved ${data.data.length} tickers`);
      return data.data;
    } catch (error: any) {
      console.error('OKX: Error retrieving tickers:', error.message);

      // If API key fails, try fallback to public API
      if (this.apiKey && !(error instanceof ApiClientError)) {
        console.warn('OKX: Retrying with public API...');
        try {
          const instType = market === 'swap' ? 'SWAP' : 'SPOT';
          const response = await got(`https://www.okx.com/api/v5/market/tickers?instType=${instType}`);
          const data: { code: string; data: OKXTickerData[]; msg?: string } = JSON.parse(response.body);

          if (data.code !== '0') {
            throw new ApiClientError(`OKX API Error [${data.code}]: ${data.msg || 'Unknown error'}`, parseInt(data.code));
          }

          console.log(`OKX: Successfully retrieved ${data.data.length} tickers (public API)`);
          return data.data;
        } catch (fallbackError: any) {
          console.error('OKX: Even public API failed:', fallbackError.message);
        }
      }

      throw new Error(`Could not retrieve ${market} tickers from OKX: ${error.message}`);
    }
  }

  async getTicker(symbol: string, currency: string, market: MarketType, allTickers: OKXTickerData[]): Promise<OKXTicker> {
    // perpetual swaps carry a -SWAP suffix, spot pairs are plain SYMBOL-CURRENCY
    const instId = market === 'swap' ? `${symbol}-${currency.toUpperCase()}-SWAP` : `${symbol}-${currency.toUpperCase()}`;
    const tickerData = allTickers.find(ticker => ticker.instId === instId);

    if (!tickerData) {
      throw new Error(`Could not retrieve price for ${symbol} from OKX`);
    }

    const last = parseFloat(tickerData.last);
    const open24h = parseFloat(tickerData.open24h);
    const change = last - open24h;
    const percent = parseFloat(((change / open24h) * 100).toFixed(2));

    return {
      price: last,
      open: open24h,
      high: parseFloat(tickerData.high24h),
      low: parseFloat(tickerData.low24h),
      change: parseFloat(change.toFixed(2)),
      percent: percent
    };
  }

  async getKlines(symbol: string, currency: string, market: MarketType, interval: KlineInterval, limit: number): Promise<Candle[]> {
    // perpetual swaps carry a -SWAP suffix, spot pairs are plain SYMBOL-CURRENCY
    const instId = market === 'swap' ? `${symbol}-${currency.toUpperCase()}-SWAP` : `${symbol}-${currency.toUpperCase()}`;
    const bar = BAR_MAP[interval] || '1m';
    const capped = Math.min(Math.max(limit, 1), MAX_CANDLES);
    const url = `https://www.okx.com/api/v5/market/candles?instId=${encodeURIComponent(instId)}&bar=${bar}&limit=${capped}`;

    const options: any = { timeout: { request: 15000 } };
    if (this.apiKey) {
      options.headers = { 'OK-ACCESS-KEY': this.apiKey };
    }

    const response: { code: string; data: string[][]; msg?: string } = await this.makeApiRequest(url, options);

    if (response.code !== '0' || !Array.isArray(response.data)) {
      throw new ApiClientError(`OKX API Error [${response.code}]: ${response.msg || 'Unknown error'}`, parseInt(response.code));
    }

    // [ts, o, h, l, c, vol, volCcy, volCcyQuote, confirm] — newest first, so reverse into ascending order
    return response.data
      .map(row => ({
        time: Number(row[0]),
        open: parseFloat(row[1]),
        high: parseFloat(row[2]),
        low: parseFloat(row[3]),
        close: parseFloat(row[4]),
        volume: parseFloat(row[5])
      }))
      .reverse();
  }

  protected isApiError(data: any): boolean {
    // OKX API errors have 'code' field that's not '0'
    return data && data.code && data.code !== '0';
  }

  protected handleApiError(data: any, retries: number): void {
    const code = data.code;
    const message = data.msg || 'Unknown OKX API error';

    console.error(`OKX API Error [${code}]: ${message}`);

    switch (code) {
      case '50004':
        throw new ApiClientError(`OKX: Invalid API key - ${message}`, 401);
      case '50005':
        throw new ApiClientError(`OKX: Invalid secret key - ${message}`, 401);
      case '50006':
        throw new ApiClientError(`OKX: Too many requests - ${message}`, 429);
      case '50011':
        throw new ApiClientError(`OKX: Invalid timestamp - ${message}`, 400);
      case '50013':
        throw new ApiClientError(`OKX: Invalid request - ${message}`, 400);
      default:
        throw new ApiClientError(`OKX: API error [${code}] - ${message}`, 500);
    }
  }
}
