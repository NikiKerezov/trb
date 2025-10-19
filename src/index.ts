/**
 * Main entry point for the Telegram Trading Bot
 */

import { loadConfig, maskSensitiveConfig } from './utils/config';
import { initializeLogger, getLogger, logConfigError } from './utils/logger';
import { TradingBot } from './services/trading-bot';

/**
 * Initialize and start the trading bot
 */
async function main(): Promise<void> {
  try {
    // Load and validate configuration
    const configResult = loadConfig();
    
    if (!configResult.valid) {
      console.error('Configuration validation failed:');
      configResult.errors.forEach(error => console.error(`  - ${error}`));
      process.exit(1);
    }

    const config = configResult.config;

    // Initialize logging
    initializeLogger(config.bot);
    const logger = getLogger();

    // Log startup information (with masked sensitive data)
    logger.info('Trading bot starting up', {
      config: maskSensitiveConfig(config),
      environment: {
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch
      }
    });

    // Create and start the trading bot
    const bot = new TradingBot(config);

    // Handle graceful shutdown
    const shutdown = async (signal: string) => {
      logger.info(`Received ${signal}, shutting down gracefully...`);
      
      try {
        await bot.stop();
        logger.info('Trading bot stopped successfully');
        process.exit(0);
      } catch (error) {
        logger.error('Error during shutdown', {
          error: error instanceof Error ? error.message : 'Unknown error'
        });
        process.exit(1);
      }
    };

    // Register signal handlers
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGUSR2', () => shutdown('SIGUSR2')); // For nodemon

    // Handle unhandled rejections and exceptions
    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled Rejection at Promise', {
        promise: promise.toString(),
        reason: reason instanceof Error ? reason.message : reason
      });
    });

    process.on('uncaughtException', (error) => {
      logger.error('Uncaught Exception', {
        error: error.message,
        stack: error.stack
      });
      process.exit(1);
    });

    // Start the bot
    await bot.start();

    // Log status every 5 minutes
    setInterval(() => {
      const status = bot.getStatus();
      logger.info('Bot status update', status);
      
      // Cleanup old positions every hour
      if (Math.random() < 0.2) { // 20% chance to run cleanup on status update
        bot.cleanupOldPositions();
      }
    }, 5 * 60 * 1000); // 5 minutes

    logger.info('Trading bot is now running. Press Ctrl+C to stop.');

  } catch (error) {
    console.error('Failed to start trading bot:', error);
    process.exit(1);
  }
}

/**
 * Check if required environment variables are set and provide helpful error messages
 */
function checkEnvironment(): void {
  const requiredEnvVars = [
    'TELEGRAM_API_ID',
    'TELEGRAM_API_HASH',
    'TELEGRAM_SIGNAL_SOURCE',
    'BYBIT_API_KEY',
    'BYBIT_SECRET'
  ];

  const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

  if (missingVars.length > 0) {
    console.error('Missing required environment variables:');
    missingVars.forEach(varName => {
      console.error(`  - ${varName}`);
    });
    console.error('\nPlease copy .env.example to .env and fill in your API credentials.');
    console.error('\nFor Telegram API credentials:');
    console.error('  1. Go to https://my.telegram.org/');
    console.error('  2. Log in with your phone number');
    console.error('  3. Go to "API Development Tools"');
    console.error('  4. Create a new application to get API ID and API Hash');
    console.error('\nFor Bybit API credentials:');
    console.error('  1. Log in to your Bybit account');
    console.error('  2. Go to Account & Security > API Management');
    console.error('  3. Create a new API key with trading permissions');
    console.error('  4. Set BYBIT_TESTNET=true for testing');
    process.exit(1);
  }
}

// Check environment before starting
checkEnvironment();

// Start the application
if (require.main === module) {
  main().catch(error => {
    console.error('Unhandled error in main:', error);
    process.exit(1);
  });
}

export { TradingBot } from './services/trading-bot';
export * from './types';
export { loadConfig } from './utils/config';