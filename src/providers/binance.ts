import { BaseTickerProvider, MarketType } from '.';
import got from 'got';
import { ApiClientError } from '../errors';

export interface BinanceTicker {
  price: number;
  open: number;
  high: number;
  low: number;
  change: number;
  percent: number;
}

export interface BinanceTickerData {
  symbol: string;
  lastPrice: string;
  openPrice: string;
  highPrice: string;
  lowPrice: string;
  priceChange: string;
  priceChangePercent: string;
}

export class BinanceTickerProvider extends BaseTickerProvider {
  constructor(apiKey?: string, secretKey?: string) {
    super(apiKey, secretKey, 'Binance');
  }

  async getTickers(market: MarketType = 'spot'): Promise<BinanceTickerData[]> {
    // USDⓈ-M futures are served from the fapi cluster, spot from the api cluster
    const hosts = market === 'futures'
      ? ['https://fapi.binance.com/fapi/v1']
      : ['https://api.binance.com/api/v3', 'https://api1.binance.com/api/v3', 'https://api2.binance.com/api/v3', 'https://api3.binance.com/api/v3'];
    // Randomize endpoint order to distribute load
    const endpoints = hosts.map(host => `${host}/ticker/24hr`);
    const shuffledEndpoints = [...endpoints].sort(() => Math.random() - 0.5);

    for (let attempt = 0; attempt < 3; attempt++) {
      for (const url of shuffledEndpoints) {
        try {
          // Generate random User-Agent to avoid fingerprinting
          const userAgents = [
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15'
          ];

          const options: any = {
            headers: {
              'User-Agent': userAgents[Math.floor(Math.random() * userAgents.length)],
              'Accept': 'application/json, text/plain, */*',
              'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7',
              'Accept-Encoding': 'gzip, deflate, br',
              // Remove Connection header for HTTP/2 compatibility
              'Cache-Control': 'no-cache',
              'Pragma': 'no-cache',
              'Sec-Fetch-Dest': 'empty',
              'Sec-Fetch-Mode': 'cors',
              'Sec-Fetch-Site': 'cross-site'
              // Remove Origin and Referer for now to avoid CORS issues
            },
            timeout: {
              request: 15000 // Increased timeout
            },
            retry: {
              limit: 0
            },
            // Disable HTTP/2 to avoid connection header conflicts
            http2: false,
            followRedirect: true,
            maxRedirects: 3
          };

          if (this.apiKey) {
            options.headers['X-MBX-APIKEY'] = this.apiKey;
          }

          // Add jitter to delay to avoid synchronized requests
          if (attempt > 0) {
            const baseDelay = 2000 * attempt;
            const jitter = Math.random() * 1000; // 0-1s random jitter
            await new Promise(resolve => setTimeout(resolve, baseDelay + jitter));
          }

          // Add small random delay between endpoint attempts
          if (shuffledEndpoints.indexOf(url) > 0) {
            await new Promise(resolve => setTimeout(resolve, 200 + Math.random() * 300));
          }

          const response = await got(url, options);
          let data: BinanceTickerData[] = [];

          // Handle different response formats
          if (url.includes('/ticker/price')) {
            // Price-only endpoint - need to supplement with 24hr data
            const priceData = JSON.parse(response.body);
            // Convert price-only format to 24hr format (simplified)
            data = priceData.map((item: any) => ({
              symbol: item.symbol,
              lastPrice: item.price,
              openPrice: item.price, // Fallback
              highPrice: item.price, // Fallback
              lowPrice: item.price, // Fallback
              priceChange: '0', // Fallback
              priceChangePercent: '0' // Fallback
            }));
          } else {
            // Standard 24hr ticker format
            data = JSON.parse(response.body);
          }

          console.log(`Binance: Successfully retrieved ${data.length} tickers from ${url}`);
          return data;
        } catch (error: any) {
          console.warn(`Binance: Failed to fetch from ${url} (attempt ${attempt + 1}):`, error.message);

          // If it's a 418 error, try next endpoint immediately
          if (error.response?.statusCode === 418) {
            console.warn("Binance: Got 418 I'm a teapot, trying next endpoint...");
            continue;
          }

          // For other errors, continue to next endpoint
          continue;
        }
      }
    }

    // Last resort: try alternative data sources (spot data only, futures have no equivalent)
    if (market !== 'spot') {
      throw new Error(`Could not retrieve ${market} tickers from Binance: All endpoints exhausted`);
    }

    console.warn('Binance: All official endpoints failed, trying alternative sources...');
    return await this.getTickersFromAlternativeSource();
  }

  private async getTickersFromAlternativeSource(): Promise<BinanceTickerData[]> {
    const alternativeSources = [
      // CoinGecko as fallback (free tier)
      'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usdt&order=market_cap_desc&per_page=250&page=1',
      // CoinMarketCap free tier
      'https://pro-api.coinmarketcap.com/v1/cryptocurrency/listings/latest?limit=200',
      // Binance public data via different route
      'https://www.binance.com/api/v3/ticker/24hr',
      // Alternative: use CryptoCompare
      'https://min-api.cryptocompare.com/data/pricemultifull?fsyms=BTC,ETH,BNB,ADA,XRP,DOT,DOGE,UNI,LINK,LTC&tsyms=USDT'
    ];

    for (const source of alternativeSources) {
      try {
        const options = {
          headers: {
            'User-Agent': 'CryptoPriceTicker/1.0',
            'Accept': 'application/json'
          },
          timeout: { request: 10000 }
        };

        const response = await got(source, options);
        const data = JSON.parse(response.body);

        // Convert different API formats to Binance format
        if (source.includes('coingecko')) {
          return this.convertCoinGeckoToBinanceFormat(data);
        } else if (source.includes('cryptocompare')) {
          return this.convertCryptoCompareToBinanceFormat(data);
        } else if (source.includes('binance.com/api')) {
          // Direct Binance format
          return data;
        }
      } catch (error: any) {
        console.warn(`Alternative source ${source} failed:`, error.message);
        continue;
      }
    }

    throw new Error('Could not retrieve tickers from Binance: All sources exhausted');
  }

  private convertCoinGeckoToBinanceFormat(data: any[]): BinanceTickerData[] {
    return data.map(coin => ({
      symbol: coin.symbol.toUpperCase() + 'USDT',
      lastPrice: coin.current_price.toString(),
      openPrice: (coin.current_price * (1 - coin.price_change_percentage_24h / 100)).toString(),
      highPrice: coin.high_24h?.toString() || coin.current_price.toString(),
      lowPrice: coin.low_24h?.toString() || coin.current_price.toString(),
      priceChange: (coin.current_price - coin.current_price * (1 - coin.price_change_percentage_24h / 100)).toString(),
      priceChangePercent: coin.price_change_percentage_24h?.toString() || '0'
    }));
  }

  private convertCryptoCompareToBinanceFormat(data: any): BinanceTickerData[] {
    const result: BinanceTickerData[] = [];
    if (data.RAW) {
      Object.keys(data.RAW).forEach(symbol => {
        const coinData = data.RAW[symbol].USDT;
        if (coinData) {
          result.push({
            symbol: symbol + 'USDT',
            lastPrice: coinData.PRICE.toString(),
            openPrice: coinData.OPEN24HOUR.toString(),
            highPrice: coinData.HIGH24HOUR.toString(),
            lowPrice: coinData.LOW24HOUR.toString(),
            priceChange: coinData.CHANGE24HOUR.toString(),
            priceChangePercent: coinData.CHANGEPCT24HOUR.toString()
          });
        }
      });
    }
    return result;
  }

  async getTicker(symbol: string, currency: string, market: MarketType, allTickers: BinanceTickerData[]): Promise<BinanceTicker> {
    // spot and USDⓈ-M futures share the BTCUSDT symbol shape
    const tickerData = allTickers.find(ticker => ticker.symbol === `${symbol}${currency.toUpperCase()}`);

    if (!tickerData) {
      throw new Error(`Could not retrieve price for ${symbol} from Binance`);
    }

    return {
      price: parseFloat(tickerData.lastPrice),
      open: parseFloat(tickerData.openPrice),
      high: parseFloat(tickerData.highPrice),
      low: parseFloat(tickerData.lowPrice),
      change: parseFloat(tickerData.priceChange),
      percent: parseFloat(parseFloat(tickerData.priceChangePercent).toFixed(2))
    };
  }

  protected isApiError(data: any): boolean {
    // Binance API errors have 'code' and 'msg' fields
    return data && typeof data.code === 'number' && data.code !== 200;
  }

  protected handleApiError(data: any, retries: number): void {
    const code = data.code;
    const message = data.msg || 'Unknown Binance API error';

    console.error(`Binance API Error [${code}]: ${message}`);

    switch (code) {
      case -1000:
        throw new ApiClientError(`Binance: System error - ${message}`, code);
      case -1001:
        throw new ApiClientError(`Binance: Network error - ${message}`, code);
      case -1002:
        throw new ApiClientError(`Binance: Authorization failed - ${message}`, code);
      case -1003:
        // Rate limit - can retry
        if (retries < 2) {
          console.warn(`Binance: Rate limit hit (${message}), will retry...`);
          throw new ApiClientError(`Binance: Rate limit - ${message}`, code);
        } else {
          throw new ApiClientError(`Binance: Rate limit exceeded - ${message}`, code);
        }
      case -1015:
        throw new ApiClientError(`Binance: Too many requests - ${message}`, code);
      case -1021:
        throw new ApiClientError(`Binance: Invalid timestamp - ${message}`, code);
      default:
        throw new ApiClientError(`Binance: API error [${code}] - ${message}`, code);
    }
  }
}
