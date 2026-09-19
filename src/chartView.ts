// Copyright (c) Mavis2103. Licensed under the MIT license.
// Copyright (c) cmxx648. Licensed under the MIT license.
// See LICENSE file in the project root for full license information.

import * as vscode from 'vscode';
import { renderChart } from './chart';
import { Candle, ProviderKeys, TickerProvider } from './providers';
import { createTickerProvider, resolveProviderKeys } from './providers/factory';
import { ChartConfig, DEFAULT_CHART_SCALE, DEFAULT_REFRESH_SECONDS } from './config';

// the K-line chart that lives in its own tab in the bottom panel.
//
// the view is created lazily — VS Code only calls resolveWebviewView once the user
// actually opens the tab — and the poll timer only runs while the tab is visible,
// so an unused chart costs nothing at all
export class KlineChartView implements vscode.WebviewViewProvider {
  public static readonly viewId = 'crypto.kline';

  private view?: vscode.WebviewView;
  private timer?: NodeJS.Timeout;
  private config?: ChartConfig;
  private candles: Candle[] = [];
  private size = { width: 900, height: 360 };
  private provider?: { name: string; instance: TickerProvider };
  private polling = false;

  constructor(private readonly readConfig: () => ChartConfig | undefined, private readonly readKeys: () => ProviderKeys | undefined) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.html = this.html();

    view.webview.onDidReceiveMessage(message => this.onMessage(message));
    view.onDidChangeVisibility(() => (view.visible ? this.start() : this.stop()));
    view.onDidDispose(() => this.dispose());

    if (view.visible) {
      this.start();
    }
  }

  // called when the configuration changes so the chart follows the new ticker,
  // interval, size and colours without the user having to close and reopen the tab
  reload(): void {
    const previous = this.config;
    this.config = this.readConfig();
    this.applyLayout();

    const sourceChanged = !previous || !this.config || !sameSource(previous, this.config);
    const intervalChanged = previous?.refreshSeconds !== this.config?.refreshSeconds;

    // a colour or scale tweak can redraw from the candles already in hand;
    // only restart the poller when the data source or cadence actually changed
    if (sourceChanged || intervalChanged) {
      this.provider = undefined;
      if (this.timer !== undefined) {
        this.stop();
        this.start();
      } else if (this.view?.visible) {
        this.start();
      }
      return;
    }

    if (this.candles.length > 0) {
      this.draw();
    }
  }

  private start(): void {
    if (this.timer !== undefined) {
      return;
    }

    this.provider = undefined;
    this.config = this.readConfig();
    this.applyLayout();

    this.timer = setInterval(() => void this.poll(), (this.config?.refreshSeconds ?? DEFAULT_REFRESH_SECONDS) * 1000);
    void this.poll();
  }

  private stop(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  private async poll(): Promise<void> {
    if (!this.view || this.polling) {
      return;
    }

    const config = this.config ?? (this.config = this.readConfig());
    if (!config) {
      this.notice('No ticker is configured. Add one under "crypto-price-ticker.tickers" in your settings.');
      return;
    }

    this.polling = true;
    const ticker = config.ticker;

    try {
      // the candle endpoints are public, but the keys still raise the rate limit
      const provider = this.providerFor(config);
      this.candles = await provider.getKlines(ticker.symbol, ticker.currency, ticker.market, config.interval, config.candles);
      this.draw();
    } catch (error: any) {
      console.error(`crypto-price-ticker: could not load candles for ${ticker.symbol}/${ticker.currency}:`, error.message);
      this.notice(`Could not load ${config.interval} candles for ${ticker.symbol}/${ticker.currency} from ${ticker.provider} ${ticker.market}.`);
    } finally {
      this.polling = false;
    }
  }

  private draw(): void {
    const config = this.config;
    if (!config || this.candles.length === 0) {
      return;
    }

    const ticker = config.ticker;
    const svg = renderChart({
      candles: this.candles,
      symbol: ticker.symbol,
      currency: ticker.currency,
      interval: config.interval,
      provider: ticker.provider,
      market: ticker.market,
      width: this.size.width,
      height: this.size.height,
      upColor: config.upColor,
      downColor: config.downColor
    });

    this.post({ type: 'chart', svg });
  }

  private withProvider(provider: string): TickerProvider {
    const configuration: any = vscode.workspace.getConfiguration().get('crypto-price-ticker') || {};
    const id = provider.toLowerCase();
    const secrets = this.readKeys();
    const secretKeys = id === 'okx' ? secrets?.okx : secrets?.binance;

    return createTickerProvider(provider, resolveProviderKeys(provider, secretKeys, configuration.providers?.[id]));
  }

  private providerFor(config: ChartConfig): TickerProvider {
    if (!this.provider || this.provider.name !== config.ticker.provider) {
      this.provider = { name: config.ticker.provider, instance: this.withProvider(config.ticker.provider) };
    }

    return this.provider.instance;
  }

  private onMessage(message: any): void {
    if (!message || message.type !== 'resize') {
      return;
    }

    const width = Number(message.width);
    const height = Number(message.height);
    if (!isFinite(width) || !isFinite(height) || width <= 0 || height <= 0) {
      return;
    }

    const changed = Math.abs(width - this.size.width) > 2 || Math.abs(height - this.size.height) > 2;
    this.size = { width, height };

    // always redraw from the candles already in hand: a resize never hits the network,
    // and the webview re-reports its size whenever VS Code re-creates it (the tab was
    // hidden or moved), which is also what brings the chart back after a reload
    if (this.candles.length > 0) {
      this.draw();
    } else if (changed) {
      // nothing to draw yet — a poll is already on its way
      console.log(`crypto-price-ticker: chart viewport is ${width}x${height}`);
    }
  }

  private applyLayout(): void {
    this.post({ type: 'layout', scale: this.config?.scale ?? DEFAULT_CHART_SCALE });
  }

  private notice(text: string): void {
    this.post({ type: 'message', text });
  }

  private post(message: any): void {
    void this.view?.webview.postMessage(message);
  }

  dispose(): void {
    this.stop();
    this.view = undefined;
  }

  private html(): string {
    const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);
    const scale = this.readConfig()?.scale ?? DEFAULT_CHART_SCALE;
    const chartBox = scale < 100
      ? `#chart { position: absolute; top: 0; left: 0; width: ${scale}%; height: ${scale}%; }`
      : `#chart { position: absolute; top: 0; right: 0; bottom: 0; left: 0; }`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: var(--vscode-editor-background); }
${chartBox}
#chart > svg { display: block; width: 100%; height: 100%; }
.kl-msg { padding: 12px 14px; font-size: 12px; line-height: 1.5; font-family: var(--vscode-font-family); color: var(--vscode-descriptionForeground); }
</style>
</head>
<body>
<div id="chart"><div class="kl-msg">Loading…</div></div>
<script nonce="${nonce}">
(function () {
  var host = document.getElementById('chart');
  var api = acquireVsCodeApi();
  var timer = 0;

  function report() {
    api.postMessage({ type: 'resize', width: host.clientWidth, height: host.clientHeight });
  }

  // debounced so dragging the panel edge does not flood the extension host
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(report, 120);
  }

  function applyLayout(scale) {
    if (!scale || scale >= 100) {
      host.style.top = '0';
      host.style.right = '0';
      host.style.bottom = '0';
      host.style.left = '0';
      host.style.width = '';
      host.style.height = '';
    } else {
      host.style.top = '0';
      host.style.left = '0';
      host.style.right = 'auto';
      host.style.bottom = 'auto';
      host.style.width = scale + '%';
      host.style.height = scale + '%';
    }
    report();
  }

  window.addEventListener('message', function (event) {
    var message = event.data || {};
    if (message.type === 'chart') {
      host.innerHTML = message.svg;
    } else if (message.type === 'message') {
      host.innerHTML = '';
      var box = document.createElement('div');
      box.className = 'kl-msg';
      box.textContent = message.text;
      host.appendChild(box);
    } else if (message.type === 'layout') {
      applyLayout(message.scale);
    }
  });

  new ResizeObserver(schedule).observe(host);
  schedule();
})();
</script>
</body>
</html>`;
  }
}

function sameSource(left: ChartConfig, right: ChartConfig): boolean {
  return left.ticker.symbol === right.ticker.symbol
    && left.ticker.currency === right.ticker.currency
    && left.ticker.provider === right.ticker.provider
    && left.ticker.market === right.ticker.market
    && left.interval === right.interval
    && left.candles === right.candles;
}