// Copyright (c) Mavis2103. Licensed under the MIT license.
// Copyright (c) cmxx648. Licensed under the MIT license.
// See LICENSE file in the project root for full license information.

export class TickerError extends Error {
  constructor(message: string, public code: string = 'UNKNOWN_ERROR') {
    super(message);
    this.name = 'TickerError';
  }
}

export class AuthError extends TickerError {
  constructor(message: string) {
    super(message, 'AUTH_ERROR');
    this.name = 'AuthError';
  }
}

export class ApiClientError extends TickerError {
  constructor(message: string, public statusCode: number, public originalError?: any) {
    super(message, 'API_CLIENT_ERROR');
    this.name = 'ApiClientError';
  }
}

export class NetworkError extends TickerError {
  constructor(message: string) {
    super(message, 'NETWORK_ERROR');
    this.name = 'NetworkError';
  }
}

export class ValidationError extends TickerError {
  constructor(message: string) {
    super(message, 'VALIDATION_ERROR');
    this.name = 'ValidationError';
  }
}
