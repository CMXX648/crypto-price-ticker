// Copyright (c) Mavis2103. Licensed under the MIT license.
// See LICENSE file in the project root for full license information.

import { Candle, KlineInterval } from './providers';

// everything the renderer needs in order to draw one frame
export interface ChartFrame {
  candles: Candle[];
  symbol: string;
  currency: string;
  interval: KlineInterval;
  provider: string;
  market: string;
  width: number;
  height: number;
  upColor?: string;
  downColor?: string;
}

// the drawing is kept inside sane bounds no matter how small the panel gets
const MIN_WIDTH = 260;
const MIN_HEIGHT = 120;
const MIN_AXIS_WIDTH = 54;
const MAX_AXIS_WIDTH = 84;

const FALLBACK_UP = 'var(--vscode-charts-green,#26a69a)';
const FALLBACK_DOWN = 'var(--vscode-charts-red,#ef5350)';

// candle colours come from higherColor/lowerColor; grid and labels still follow the theme
function chartStyle(upColor?: string, downColor?: string): string {
  const up = sanitizeCssColor(upColor, FALLBACK_UP);
  const down = sanitizeCssColor(downColor, FALLBACK_DOWN);
  return [
    '<style>',
    `.kl-up{fill:${up}}`,
    `.kl-down{fill:${down}}`,
    `.kl-up-line{stroke:${up}}`,
    `.kl-down-line{stroke:${down}}`,
    '.kl-text{fill:var(--vscode-foreground,#cccccc)}',
    '.kl-dim{fill:var(--vscode-descriptionForeground,#8a8a8a)}',
    '.kl-grid{stroke:var(--vscode-foreground,#cccccc);stroke-opacity:.12}',
    '.kl-capsule-text{fill:var(--vscode-editor-background,#1e1e1e)}',
    'text{font-family:var(--vscode-font-family,sans-serif)}',
    '</style>'
  ].join('');
}

// user colours are interpolated into CSS, so reject anything that is not a colour
function sanitizeCssColor(value: string | undefined, fallback: string): string {
  if (!value) {
    return fallback;
  }

  const color = value.trim();
  if (/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(color)) {
    return color;
  }
  if (/^[a-zA-Z]{1,40}$/.test(color)) {
    return color;
  }
  if (/^(?:rgb|rgba|hsl|hsla)\([\d\s.,/%]+\)$/.test(color)) {
    return color;
  }

  return fallback;
}

// the symbol comes from user configuration, so it must never break the markup
function escapeXml(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function pad2(value: number): string {
  return value < 10 ? `0${value}` : `${value}`;
}

function formatTime(time: number, interval: KlineInterval): string {
  const date = new Date(time);
  const day = `${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  const clock = `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  return interval === '1d' ? day : clock;
}

// the price shown next to the current candle — keep every digit that matters
function formatPrice(price: number): string {
  if (!isFinite(price)) {
    return '-';
  }

  const abs = Math.abs(price);
  if (abs >= 100) {
    return price.toFixed(2);
  }
  if (abs >= 1) {
    return price.toFixed(3);
  }
  if (abs >= 0.01) {
    return price.toFixed(5);
  }
  return price.toPrecision(4);
}

// the grid labels need enough decimals to stay distinguishable from their neighbours,
// which depends on the range on screen rather than on the absolute price
function axisDigits(perStep: number): number {
  if (!isFinite(perStep) || perStep <= 0) {
    return 2;
  }

  return Math.max(0, Math.min(8, Math.ceil(-Math.log10(perStep)) + 1));
}

function round(value: number): string {
  return value.toFixed(1);
}

// draw a simple candlestick chart: price axis, grid, candles and a last price capsule
export function renderChart(frame: ChartFrame): string {
  const candles = frame.candles;
  const width = Math.max(MIN_WIDTH, Math.round(frame.width));
  const height = Math.max(MIN_HEIGHT, Math.round(frame.height));

  const style = chartStyle(frame.upColor, frame.downColor);

  if (candles.length === 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">${style}<text class="kl-dim" x="12" y="24" font-size="12">No candles to draw.</text></svg>`;
  }

  const compact = height < 190;
  const axisFont = compact ? 9 : 10;
  const headerFont = compact ? 11 : 12;

  const padLeft = 6;
  const axisWidth = Math.round(Math.min(MAX_AXIS_WIDTH, Math.max(MIN_AXIS_WIDTH, width * 0.11)));
  const plotRight = width - axisWidth;
  const plotTop = compact ? 20 : 26;
  const plotBottom = height - (compact ? 16 : 20);

  // the scale always covers the visible high and low plus a small margin
  const highest = Math.max(...candles.map(candle => candle.high));
  const lowest = Math.min(...candles.map(candle => candle.low));
  const span = highest - lowest;
  const margin = span > 0 ? span * 0.06 : Math.max(highest * 0.001, 1e-8);
  const top = highest + margin;
  const bottom = lowest - margin;
  const scale = (plotBottom - plotTop) / (top - bottom);
  const y = (price: number) => plotBottom - (price - bottom) * scale;

  const step = (plotRight - padLeft) / candles.length;
  const bodyWidth = Math.max(1, Math.min(12, Math.round(step * 0.62)));
  const wickWidth = Math.max(1, Math.min(2, step * 0.14));
  const center = (index: number) => padLeft + step * (index + 0.5);

  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">`);
  parts.push(style);

  // grid and price axis
  const gridCount = compact ? 2 : 4;
  const digits = axisDigits((top - bottom) / gridCount);
  for (let index = 0; index <= gridCount; index++) {
    const price = top - (top - bottom) * (index / gridCount);
    const line = y(price);
    parts.push(`<line class="kl-grid" x1="${padLeft}" y1="${round(line)}" x2="${plotRight}" y2="${round(line)}"/>`);
    parts.push(`<text class="kl-dim" x="${plotRight + 6}" y="${round(line + axisFont * 0.36)}" font-size="${axisFont}">${price.toFixed(digits)}</text>`);
  }

  // wicks first so every body sits on top of its own wick
  for (let index = 0; index < candles.length; index++) {
    const candle = candles[index];
    const rising = candle.close >= candle.open;
    const x = round(center(index));
    parts.push(`<line class="${rising ? 'kl-up-line' : 'kl-down-line'}" x1="${x}" y1="${round(y(candle.high))}" x2="${x}" y2="${round(y(candle.low))}" stroke-width="${round(wickWidth)}"/>`);
  }

  for (let index = 0; index < candles.length; index++) {
    const candle = candles[index];
    const rising = candle.close >= candle.open;
    const open = y(candle.open);
    const close = y(candle.close);
    const bodyHeight = Math.max(1, Math.abs(close - open));
    parts.push(`<rect class="${rising ? 'kl-up' : 'kl-down'}" x="${round(center(index) - bodyWidth / 2)}" y="${round(Math.min(open, close))}" width="${bodyWidth}" height="${round(bodyHeight)}"/>`);
  }

  // the last price capsule rides on the axis and is always clamped inside the plot
  const last = candles[candles.length - 1];
  const lastRising = last.close >= last.open;
  const capsuleY = Math.max(plotTop + 9, Math.min(plotBottom - 9, y(last.close)));
  const capsuleWidth = axisWidth - 6;
  parts.push(`<rect class="${lastRising ? 'kl-up' : 'kl-down'}" x="${plotRight + 3}" y="${round(capsuleY - 8)}" width="${capsuleWidth}" height="16" rx="2"/>`);
  parts.push(`<text class="kl-capsule-text" x="${round(plotRight + 3 + capsuleWidth / 2)}" y="${round(capsuleY + 4)}" font-size="${axisFont}" font-weight="600" text-anchor="middle">${formatPrice(last.close)}</text>`);

  // time axis — never more labels than the width can carry
  const labelCount = Math.max(2, Math.min(5, Math.floor((plotRight - padLeft) / 90)));
  for (let index = 0; index < labelCount; index++) {
    const candleIndex = Math.round((index * (candles.length - 1)) / (labelCount - 1));
    const x = Math.min(Math.max(center(candleIndex), padLeft + 14), plotRight - 14);
    parts.push(`<text class="kl-dim" x="${round(x)}" y="${height - (compact ? 4 : 6)}" font-size="${axisFont}" text-anchor="middle">${formatTime(candles[candleIndex].time, frame.interval)}</text>`);
  }

  // header: what is on screen, and where the price currently is
  const headerY = compact ? 13 : 17;
  const change = candles[0].open > 0 ? ((last.close - candles[0].open) / candles[0].open) * 100 : 0;
  const label = `${escapeXml(frame.symbol)}/${escapeXml(frame.currency)}`;
  const meta = `  ${frame.interval} · ${escapeXml(frame.provider)} ${escapeXml(frame.market)}`;
  parts.push(`<text class="kl-text" x="${padLeft}" y="${headerY}" font-size="${headerFont}" font-weight="600">${label}<tspan class="kl-dim" font-weight="400">${meta}</tspan></text>`);

  // the price readout only fits when the panel is wide enough
  if (width >= 420) {
    const sign = change >= 0 ? '+' : '';
    parts.push(`<text class="kl-text" x="${plotRight}" y="${headerY}" font-size="${headerFont}" font-weight="600" text-anchor="end">${formatPrice(last.close)}<tspan class="${change >= 0 ? 'kl-up' : 'kl-down'}" font-size="${axisFont}">  ${sign}${change.toFixed(2)}%</tspan></text>`);
  }

  parts.push('</svg>');
  return parts.join('');
}