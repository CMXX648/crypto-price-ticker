// Copyright (c) Mavis2103. Licensed under the MIT license.
// See LICENSE file in the project root for full license information.

import * as vscode from 'vscode';
import { Tickers } from './ticker';
import { KeyValidator } from './keyValidator';
import { KlineChartView } from './chartView';
import { ProviderKeys } from './providers';
import { readChartConfig, readTickers, SUPPORTED_PROVIDERS } from './config';

// the prefix of the keys stored in Secret Storage
const SECRET_PREFIX = 'crypto-price-ticker';

// the tickers array
let tickers: Tickers | undefined;

// the K-line chart view
let chartView: KlineChartView | undefined;

// the API keys most recently read from Secret Storage, shared with the chart
let providerKeys: ProviderKeys | undefined;

// the refresh interval
let interval: NodeJS.Timeout | undefined;

// guards against overlapping rebuilds while secrets are being read
let rebuilding = false;

// a rebuild requested while another is in flight — re-run once it finishes
let pendingRebuild = false;

// this method is called when your extension is activated
export async function activate(context: vscode.ExtensionContext) {
  // toggle the visibility of the ticker data from the status bar icon
  context.subscriptions.push(
    vscode.commands.registerCommand('crypto-price-ticker.toggle', () => {
      tickers?.toggle();
    })
  );

  registerKeyCommands(context);
  registerChart(context);

  // construct the extension
  await constructor(context);

  // call the constructor again if the configuration changes
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(() => constructor(context)));
}

// register the K-line chart view together with its command and status bar entry
function registerChart(context: vscode.ExtensionContext) {
  chartView = new KlineChartView(
    () => readChartConfig(vscode.workspace.getConfiguration().get('crypto-price-ticker')),
    () => providerKeys
  );

  // the provider is registered once and stays dormant until the tab is opened
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(KlineChartView.viewId, chartView, { webviewOptions: { retainContextWhenHidden: false } })
  );

  // the chart lives in its own tab in the bottom panel, next to the terminal
  context.subscriptions.push(
    vscode.commands.registerCommand('crypto-price-ticker.showChart', async () => {
      await vscode.commands.executeCommand('workbench.view.extension.cryptoPanel');
      await vscode.commands.executeCommand(`${KlineChartView.viewId}.focus`);
    })
  );

  // a status bar entry that opens the chart, sitting leftmost of the ticker icons.
  // the id is required so VS Code can restore the item if it was hidden from the status bar menu
  const item = vscode.window.createStatusBarItem('crypto-price-ticker.chart', vscode.StatusBarAlignment.Left, 1000);
  item.name = 'Crypto K-line Chart';
  item.text = '$(graph-line)';
  item.tooltip = 'Show the crypto K-line chart';
  item.command = 'crypto-price-ticker.showChart';
  item.show();
  context.subscriptions.push(item);

  // follow configuration changes without making the user close and reopen the tab
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(() => chartView?.reload()));
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
      await context.secrets.delete(`${SECRET_PREFIX}.${id}.cleared`);
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
      // remember the clear so settings.json keys cannot resurrect the credentials
      await context.secrets.store(`${SECRET_PREFIX}.${id}.cleared`, '1');
      vscode.window.showInformationMessage(`crypto-price-ticker: ${provider} API keys cleared.`);

      await constructor(context);
    })
  );
}

// read the API keys from Secret Storage
async function readSecrets(context: vscode.ExtensionContext): Promise<ProviderKeys> {
  const read = async (provider: string) => ({
    apiKey: (await context.secrets.get(`${SECRET_PREFIX}.${provider}.apiKey`)) ?? undefined,
    secretKey: (await context.secrets.get(`${SECRET_PREFIX}.${provider}.secretKey`)) ?? undefined,
    cleared: (await context.secrets.get(`${SECRET_PREFIX}.${provider}.cleared`)) === '1'
  });

  return {
    binance: await read('binance'),
    okx: await read('okx')
  };
}

// construct the extension
async function constructor(context: vscode.ExtensionContext) {
  // a rebuild landing mid-flight must not be dropped — re-run once this one finishes
  if (rebuilding) {
    pendingRebuild = true;
    return;
  }
  rebuilding = true;

  try {
    // clear the interval if we already have one
    if (interval !== undefined) {
      clearInterval(interval);
      interval = undefined;
    }

    // dispose of the tickers if we already have an array
    if (tickers !== undefined) {
      tickers.dispose();
      tickers = undefined;
    }

    // get the ticker definition from the configuration
    const configuration: any = vscode.workspace.getConfiguration().get('crypto-price-ticker');
    const tickersConfig = readTickers(configuration);

    // the chart uses the same credentials
    providerKeys = await readSecrets(context);

    // create a new ticker
    tickers = new Tickers(tickersConfig, context.workspaceState, providerKeys);

    // create the interval and call refresh every x seconds
    interval = setInterval(() => refresh(configuration), configuration.interval * 1000);
  } catch (error: any) {
    console.error('crypto-price-ticker: failed to construct the tickers:', error.message);
    vscode.window.showErrorMessage(`crypto-price-ticker: ${error.message}`);
    tickers = undefined;
  } finally {
    rebuilding = false;
    if (pendingRebuild) {
      pendingRebuild = false;
      await constructor(context);
    }
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

  // stop the chart polling
  chartView?.dispose();
}
