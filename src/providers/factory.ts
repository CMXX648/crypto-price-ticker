// Copyright (c) Mavis2103. Licensed under the MIT license.
// Copyright (c) cmxx648. Licensed under the MIT license.
// See LICENSE file in the project root for full license information.

import { TickerProvider, ProviderKeySet } from '.';
import { BinanceTickerProvider } from './binance';
import { OKXTickerProvider } from './okx';

// create the provider that serves a ticker definition — the single place mapping a
// provider name to an implementation, shared by the status bar tickers and the chart
export function createTickerProvider(provider: string, keys?: ProviderKeySet): TickerProvider {
  switch (provider) {
    case 'Binance':
      return new BinanceTickerProvider(keys?.apiKey, keys?.secretKey);
    case 'OKX':
      return new OKXTickerProvider(keys?.apiKey, keys?.secretKey);
    default:
      throw new Error(`Unknown ticker provider: ${provider}`);
  }
}

// prefer the keys from Secret Storage, fall back to the ones in settings.json
export function resolveProviderKeys(provider: string, secretKeys?: ProviderKeySet, configKeys?: ProviderKeySet): ProviderKeySet {
  const hasSecretApiKey = !!secretKeys?.apiKey;
  const hasSecretSecretKey = !!secretKeys?.secretKey;

  if (hasSecretApiKey && hasSecretSecretKey) {
    return secretKeys!;
  }

  // a half-filled Secret Storage entry is not "no secrets" — do not fall back
  // wholesale to settings.json, which would silently resurrect the other key
  if (hasSecretApiKey || hasSecretSecretKey) {
    console.warn(`crypto-price-ticker: ${provider} Secret Storage is incomplete (both apiKey and secretKey are required). Not falling back to settings.json.`);
    return { apiKey: secretKeys?.apiKey, secretKey: secretKeys?.secretKey };
  }

  // Clear API Keys must stick even when settings.json still has a deprecated copy
  if (secretKeys?.cleared) {
    return {};
  }

  if (configKeys?.apiKey || configKeys?.secretKey) {
    console.warn(`crypto-price-ticker: ${provider} keys found in settings.json — move them to Secret Storage with the "Set API Keys" command for better security.`);
  }

  return configKeys ?? {};
}