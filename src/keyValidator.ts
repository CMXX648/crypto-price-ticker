// Copyright (c) Mavis2103. Licensed under the MIT license.
// Copyright (c) cmxx648. Licensed under the MIT license.
// See LICENSE file in the project root for full license information.

import { ValidationError } from './errors';

export interface ProviderConfig {
  apiKey?: string;
  secretKey?: string;
}

export interface ValidationResult {
  isValid: boolean;
  message?: string;
}

export class KeyValidator {
  validate(providerName: string, config: ProviderConfig): ValidationResult {
    // If both are missing, it might be public mode
    if (!config.apiKey && !config.secretKey) {
      return { isValid: true };
    }

    // If one is provided, both must be provided
    if (!config.apiKey || !config.secretKey) {
      return {
        isValid: false,
        message: `${providerName}: Both API Key and Secret Key must be provided or both left empty.`
      };
    }

    // Check for empty strings
    if (config.apiKey.trim() === '' || config.secretKey.trim() === '') {
      return {
        isValid: false,
        message: `${providerName}: API Key and Secret Key cannot be empty.`
      };
    }

    // Check minimum length
    if (config.apiKey.length < 20) {
      return {
        isValid: false,
        message: `${providerName}: API Key too short (minimum 20 characters).`
      };
    }

    if (config.secretKey.length < 20) {
      return {
        isValid: false,
        message: `${providerName}: Secret Key too short (minimum 20 characters).`
      };
    }

    // Provider-specific validation
    switch (providerName.toLowerCase()) {
      case 'binance':
        return this.validateBinanceKeys(config);
      case 'okx':
        return this.validateOKXKeys(config);
      default:
        return { isValid: true };
    }
  }

  private validateBinanceKeys(config: ProviderConfig): ValidationResult {
    // Binance API keys are typically 64-character hex
    const hexRegex = /^[a-fA-F0-9]{64}$/;
    if (!hexRegex.test(config.apiKey!)) {
      return {
        isValid: false,
        message: 'Binance: API Key must be 64 hexadecimal characters.'
      };
    }

    // Secret key is also typically 64 characters
    if (config.secretKey!.length !== 64) {
      return {
        isValid: false,
        message: 'Binance: Secret Key must be 64 characters.'
      };
    }

    return { isValid: true };
  }

  private validateOKXKeys(config: ProviderConfig): ValidationResult {
    // OKX API keys may have different format, basic validation
    if (config.apiKey!.length < 32) {
      return {
        isValid: false,
        message: 'OKX: API Key too short (minimum 32 characters).'
      };
    }

    if (config.secretKey!.length < 32) {
      return {
        isValid: false,
        message: 'OKX: Secret Key too short (minimum 32 characters).'
      };
    }

    return { isValid: true };
  }
}
