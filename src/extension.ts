// Copyright (c) Mavis2103. Licensed under the MIT license.
// See LICENSE file in the project root for full license information.

import * as vscode from 'vscode';
import { Tickers, ProviderKeys } from './ticker';
import { KeyValidator } from './keyValidator';

// the providers that can be configured
const SUPPORTED_PROVIDERS = ['Binance', 'OKX'] as const;

// the market types a provider supports
const SUPPORTED_MARKETS: { [provider: string]: string[] } = {
  Binance: ['spot', 'futures'],
  OKX: ['spot', 'swap']
};

// the prefix of the keys stored in Secret Storage
const SECRET_PREFIX = 'crypto-price-ticker';

// the tickers array
let tickers: Tickers | undefined;

// the refresh interval
let interval: NodeJS.Timeout | undefined;

// guards against overlapping rebuilds while secrets are being read
let rebuilding = false;

// this method is called when your extension is activated
export async function activate(context: vscode.ExtensionContext) {
  // toggle the visibility of the ticker data from the status bar icon
  context.subscriptions.push(
    vscode.commands.registerCommand('crypto-price-ticker.toggle', () => {
      tickers?.toggle();
    })
  );

  registerKeyCommands(context);

  // construct the extension
  await constructor(context);

  // call the constructor again if the configuration changes
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(() => constructor(context)));
}

// register the commands that manage the API keys in Secret Storage
function registerKeyCommands(context: vscode.ExtensionContext) {
  const keyValidator = new KeyValidator();

  context.subscriptions.push(
    vscode.commands.registerCommand('crypto-price-ticker.setApiKeys', async () => {
      const provider = await vscode.window.showQuickPick([...SUPPORTED_PROVIDERS], { placeHolder: 'Select the provider' });
      if (!provider) {
        return;
      }

      // mask the input so the keys are never echoed to the screen
      const apiKey = await vscode.window.showInputBox({ prompt: `${provider} API Key`, password: true, placeHolder: 'Paste your API key' });
      if (apiKey === undefined) {
        return;
      }

      const secretKey = await vscode.window.showInputBox({ prompt: `${provider} Secret Key`, password: true, placeHolder: 'Paste your secret key' });
      if (secretKey === undefined) {
        return;
      }

      const validation = keyValidator.validate(provider, { apiKey, secretKey });
      if (!validation.isValid) {
        vscode.window.showWarningMessage(`crypto-price-ticker: ${validation.message}`);
        return;
      }

      const id = provider.toLowerCase();
      await context.secrets.store(`${SECRET_PREFIX}.${id}.apiKey`, apiKey);
      await context.secrets.store(`${SECRET_PREFIX}.${id}.secretKey`, secretKey);
      vscode.window.showInformationMessage(`crypto-price-ticker: ${provider} API keys saved to Secret Storage.`);

      // rebuild so the new keys are picked up straight away
      await constructor(context);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('crypto-price-ticker.clearApiKeys', async () => {
      const provider = await vscode.window.showQuickPick([...SUPPORTED_PROVIDERS], { placeHolder: 'Select the provider' });
      if (!provider) {
        return;
      }

      const id = provider.toLowerCase();
      await context.secrets.delete(`${SECRET_PREFIX}.${id}.apiKey`);
      await context.secrets.delete(`${SECRET_PREFIX}.${id}.secretKey`);
      vscode.window.showInformationMessage(`crypto-price-ticker: ${provider} API keys cleared.`);

      await constructor(context);
    })
  );
}

// read the API keys from Secret Storage
async function readSecrets(context: vscode.ExtensionContext): Promise<ProviderKeys> {
  const read = async (provider: string) => ({
    apiKey: (await context.secrets.get(`${SECRET_PREFIX}.${provider}.apiKey`)) ?? undefined,
    secretKey: (await context.secrets.get(`${SECRET_PREFIX}.${provider}.secretKey`)) ?? undefined
  });

  return {
    binance: await read('binance'),
    okx: await read('okx')
  };
}

// construct the extension
async function constructor(context: vscode.ExtensionContext) {
  // skip if a rebuild is already running, the next change will catch up
  if (rebuilding) {
    return;
  }
  rebuilding = true;

  try {
    // clear the interval if we already have one
    if (interval !== undefined) {
      clearInterval(interval);
    }

    // dispose of the tickers if we already have an array
    if (tickers !== undefined) {
      tickers.dispose();
    }

    // get the ticker definition from the configuration
    const configuration: any = vscode.workspace.getConfiguration().get('crypto-price-ticker');
    const tickerDefinitions: any[] = configuration.tickers;

    const tickersConfig = tickerDefinitions.map((definition: any) => {
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

    // create a new ticker
    tickers = new Tickers(tickersConfig, context.workspaceState, await readSecrets(context));

    // create the interval and call refresh every x seconds
    interval = setInterval(() => refresh(configuration), configuration.interval * 1000);
  } catch (error: any) {
    console.error('crypto-price-ticker: failed to construct the tickers:', error.message);
    vscode.window.showErrorMessage(`crypto-price-ticker: ${error.message}`);
  } finally {
    rebuilding = false;
  }
}

// refresh the tickers
function refresh(configuration: any) {
  // exit early when refreshing is not required
  if (configuration.onlyRefreshWhenFocused && !vscode.window.state.focused) {
    return;
  }

  // iterate over the tickers and refresh
  tickers?.refresh();
}

// this method is called when your extension is deactivated
export function deactivate() {
  // dispose of the tickers
  tickers?.dispose();
}
