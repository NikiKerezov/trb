/**
 * Configuration types for the trading bot
 */

export type TelegramConfig = {
  apiId: number;
  apiHash: string;
  sessionString?: string;
  signalSource: string;
};

export type BybitConfig = {
  apiKey: string;
  secret: string;
  testnet: boolean;
  baseUrl?: string;
};

export type BotConfig = {
  portfolioPercentage: number;
  logLevel: 'error' | 'warn' | 'info' | 'debug';
  maxConcurrentTrades: number;
  stopLossBuffer: number; // Buffer percentage for stop loss calculations
};

export type AppConfig = {
  telegram: TelegramConfig;
  bybit: BybitConfig;
  bot: BotConfig;
};

export type ConfigValidationResult = {
  valid: true;
  config: AppConfig;
} | {
  valid: false;
  errors: string[];
};