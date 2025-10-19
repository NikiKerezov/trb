/**
 * Logging utility with different levels and structured output
 */

import winston from 'winston';
import { BotConfig } from '../types';

let logger: winston.Logger;

/**
 * Initialize logger with configuration
 */
export function initializeLogger(config: BotConfig): void {
  const logFormat = winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json(),
    winston.format.printf(({ timestamp, level, message, stack, ...meta }) => {
      let log = `${timestamp} [${level.toUpperCase()}]: ${message}`;
      
      if (Object.keys(meta).length > 0) {
        log += ` ${JSON.stringify(meta)}`;
      }
      
      if (stack) {
        log += `\n${stack}`;
      }
      
      return log;
    })
  );

  logger = winston.createLogger({
    level: config.logLevel,
    format: logFormat,
    transports: [
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.colorize(),
          logFormat
        )
      }),
      new winston.transports.File({
        filename: 'logs/error.log',
        level: 'error',
        maxsize: 5242880, // 5MB
        maxFiles: 5
      }),
      new winston.transports.File({
        filename: 'logs/combined.log',
        maxsize: 5242880, // 5MB
        maxFiles: 5
      })
    ]
  });
}

/**
 * Get the logger instance
 */
export function getLogger(): winston.Logger {
  if (!logger) {
    throw new Error('Logger not initialized. Call initializeLogger() first.');
  }
  return logger;
}

/**
 * Log trading signal received
 */
export function logSignalReceived(signal: unknown, source: string): void {
  getLogger().info('Trading signal received', {
    source,
    signal: typeof signal === 'object' ? JSON.stringify(signal) : signal
  });
}

/**
 * Log trade execution
 */
export function logTradeExecution(
  action: 'OPEN' | 'CLOSE' | 'UPDATE_SL' | 'TAKE_PROFIT',
  details: Record<string, unknown>
): void {
  getLogger().info(`Trade ${action.toLowerCase()}`, details);
}

/**
 * Log API errors with context
 */
export function logApiError(service: 'telegram' | 'bybit', error: Error, context?: Record<string, unknown>): void {
  getLogger().error(`${service.toUpperCase()} API Error`, {
    error: error.message,
    stack: error.stack,
    context
  });
}

/**
 * Log configuration errors
 */
export function logConfigError(errors: string[]): void {
  getLogger().error('Configuration validation failed', { errors });
}

/**
 * Log position updates
 */
export function logPositionUpdate(positionId: string, update: Record<string, unknown>): void {
  getLogger().info('Position updated', {
    positionId,
    ...update
  });
}