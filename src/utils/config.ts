/**
 * Configuration management with validation and security
 */

import * as dotenv from 'dotenv';
import { AppConfig, ConfigValidationResult, TelegramConfig, BybitConfig, BotConfig } from '../types';

// Load environment variables
dotenv.config();

/**
 * Validates and loads configuration from environment variables
 */
export function loadConfig(): ConfigValidationResult {
  const errors: string[] = [];

  // Telegram configuration validation
  const telegramApiId = process.env.TELEGRAM_API_ID;
  const telegramApiHash = process.env.TELEGRAM_API_HASH;
  const telegramSessionString = process.env.TELEGRAM_SESSION_STRING;
  const telegramSignalSource = process.env.TELEGRAM_SIGNAL_SOURCE;

  if (!telegramApiId || isNaN(Number(telegramApiId))) {
    errors.push('TELEGRAM_API_ID must be a valid number');
  }
  if (!telegramApiHash || telegramApiHash.trim() === '') {
    errors.push('TELEGRAM_API_HASH is required');
  }
  if (!telegramSignalSource || telegramSignalSource.trim() === '') {
    errors.push('TELEGRAM_SIGNAL_SOURCE is required');
  }

  // Bybit configuration validation
  const bybitApiKey = process.env.BYBIT_API_KEY;
  const bybitSecret = process.env.BYBIT_SECRET;
  const bybitTestnet = process.env.BYBIT_TESTNET?.toLowerCase() === 'true';

  if (!bybitApiKey || bybitApiKey.trim() === '') {
    errors.push('BYBIT_API_KEY is required');
  }
  if (!bybitSecret || bybitSecret.trim() === '') {
    errors.push('BYBIT_SECRET is required');
  }

  // Bot configuration validation
  const portfolioPercentage = Number(process.env.PORTFOLIO_PERCENTAGE) || 10;
  const logLevel = process.env.LOG_LEVEL as 'error' | 'warn' | 'info' | 'debug' || 'info';

  if (portfolioPercentage <= 0 || portfolioPercentage > 100) {
    errors.push('PORTFOLIO_PERCENTAGE must be between 1 and 100');
  }

  const validLogLevels = ['error', 'warn', 'info', 'debug'];
  if (!validLogLevels.includes(logLevel)) {
    errors.push(`LOG_LEVEL must be one of: ${validLogLevels.join(', ')}`);
  }

  if (errors.length > 0) {
    return {
      valid: false,
      errors
    };
  }

  const telegram: TelegramConfig = {
    apiId: Number(telegramApiId),
    apiHash: telegramApiHash!,
    signalSource: telegramSignalSource!
  };

  if (telegramSessionString) {
    telegram.sessionString = telegramSessionString;
  }

  const bybit: BybitConfig = {
    apiKey: bybitApiKey!,
    secret: bybitSecret!,
    testnet: bybitTestnet,
    baseUrl: bybitTestnet 
      ? 'https://api-testnet.bybit.com' 
      : 'https://api.bybit.com'
  };

  const bot: BotConfig = {
    portfolioPercentage,
    logLevel,
    maxConcurrentTrades: 5,
    stopLossBuffer: 0.1 // 0.1% buffer for stop loss calculations
  };

  return {
    valid: true,
    config: {
      telegram,
      bybit,
      bot
    }
  };
}

/**
 * Validates API key format and basic security requirements
 */
export function validateApiKey(key: string, type: 'telegram' | 'bybit'): boolean {
  if (!key || key.trim() === '') {
    return false;
  }

  switch (type) {
    case 'telegram':
      // Telegram API hash should be 32 characters
      return key.length === 32;
    case 'bybit':
      // Bybit API key should be alphanumeric and at least 20 characters
      return /^[a-zA-Z0-9]{20,}$/.test(key);
    default:
      return false;
  }
}

/**
 * Masks sensitive configuration values for logging
 */
export function maskSensitiveConfig(config: AppConfig): Record<string, unknown> {
  return {
    telegram: {
      apiId: config.telegram.apiId,
      apiHash: '***masked***',
      signalSource: config.telegram.signalSource,
      sessionString: config.telegram.sessionString ? '***masked***' : undefined
    },
    bybit: {
      apiKey: config.bybit.apiKey.substring(0, 8) + '***masked***',
      secret: '***masked***',
      testnet: config.bybit.testnet,
      baseUrl: config.bybit.baseUrl
    },
    bot: config.bot
  };
}