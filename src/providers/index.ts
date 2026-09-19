// Copyright (c) Mavis2103. Licensed under the MIT license.
// Copyright (c) cmxx648. Licensed under the MIT license.
// See LICENSE file in the project root for full license information.

import { KeyValidator, ProviderConfig } from '../keyValidator';
import { AuthError, ApiClientError, NetworkError, TickerError } from '../errors';
import got from 'got';

export interface TickerProvider {
  getTicker(symbol: string, currency: string, market: MarketType, allTickers?: any[]): Promise<any>;
  getTickers(market: MarketType): Promise<any[]>;
  getKlines(symbol: string, currency: string, market: MarketType, interval: KlineInterval, limit: number): Promise<Candle[]>;
}

// the market type a ticker is fetched from
// Binance supports spot and futures, OKX supports spot and swap (perpetual)
export type MarketType = 'spot' | 'futures' | 'swap';

// the candle intervals the K-line chart can request
export type KlineInterval = '1m' | '5m' | '15m' | '1h' | '4h' | '1d';

// a single OHLC candle
export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// credentials for a single provider
export interface ProviderKeySet {
  apiKey?: string;
  secretKey?: string;
  // true when the user explicitly cleared Secret Storage for this provider
  cleared?: boolean;
}

// credentials for every supported provider
export interface ProviderKeys {
  binance?: ProviderKeySet;
  okx?: ProviderKeySet;
}

export abstract class BaseTickerProvider implements TickerProvider {
  protected apiKey?: string;
  protected secretKey?: string;
  protected providerName: string;
  protected keyValidator: KeyValidator;

  constructor(apiKey?: string, secretKey?: string, providerName: string = 'Unknown') {
    this.apiKey = apiKey;
    this.secretKey = secretKey;
    this.providerName = providerName;
    this.keyValidator = new KeyValidator();

    // Validate keys when initializing
    if (apiKey || secretKey) {
      const config: ProviderConfig = { apiKey, secretKey };
      const validation = this.keyValidator.validate(providerName, config);
      if (!validation.isValid) {
        console.warn(`Configuration warning ${providerName}: ${validation.message}`);
        // Still allow continuation but log warning
      }
    }
  }

  abstract getTicker(symbol: string, currency: string, market: MarketType, allTickers?: any[]): Promise<any>;
  abstract getTickers(market: MarketType): Promise<any>;
  abstract getKlines(symbol: string, currency: string, market: MarketType, interval: KlineInterval, limit: number): Promise<Candle[]>;

  protected async makeApiRequest(url: string, options: any = {}, requiresAuth: boolean = false): Promise<any> {
    if (requiresAuth) {
      if (!this.apiKey || !this.secretKey) {
        throw new AuthError(`${this.providerName}: API Key and Secret Key are required for this operation.`);
      }
    }

    const MAX_RETRIES = 3;
    let retries = 0;

    while (retries < MAX_RETRIES) {
      try {
        const response = await got(url, options);
        const data = JSON.parse(response.body);

        // Check for API-specific error codes
        if (this.isApiError(data)) {
          this.handleApiError(data, retries);
        }

        return data;
      } catch (error: any) {
        if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
          // Network error
          retries++;
          if (retries < MAX_RETRIES) {
            const delay = Math.pow(2, retries) * 1000; // Exponential backoff
            console.warn(`${this.providerName}: Network error, retrying in ${delay}ms (attempt ${retries}/${MAX_RETRIES})`);
            await new Promise(resolve => setTimeout(resolve, delay));
            continue;
          } else {
            throw new NetworkError(`${this.providerName}: Network error after ${MAX_RETRIES} attempts.`);
          }
        }

        // Re-throw custom errors
        if (error instanceof TickerError) {
          throw error;
        }

        // Unknown error
        console.error(`${this.providerName}: Unknown error:`, error);
        throw new TickerError(`${this.providerName}: Unknown error - ${error.message}`);
      }
    }
  }

  protected isApiError(data: any): boolean {
    // Override in subclasses for provider-specific error checking
    return false;
  }

  protected handleApiError(data: any, retries: number): void {
    // Override in subclasses for provider-specific error handling
    throw new ApiClientError(`${this.providerName}: API error - ${JSON.stringify(data)}`, 0);
  }
}
