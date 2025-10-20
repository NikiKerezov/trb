/**
 * Script to close IDUSDT position
 */

import { config as dotenvConfig } from 'dotenv';
import { BybitClient } from './src/services/bybit-client';
import { initializeLogger, getLogger } from './src/utils/logger';

// Load environment variables
dotenvConfig();

// Initialize logger
initializeLogger({
  portfolioPercentage: 1,
  logLevel: 'info',
  maxConcurrentTrades: 5,
  stopLossBuffer: 0.1
});

async function closePosition() {
  const logger = getLogger();

  try {
    logger.info('Closing IDUSDT position...');

    // Initialize Bybit client
    const bybitClient = new BybitClient({
      apiKey: process.env.BYBIT_API_KEY!,
      secret: process.env.BYBIT_SECRET!,
      testnet: process.env.BYBIT_TESTNET === 'true',
      baseUrl: process.env.BYBIT_TESTNET === 'true'
        ? 'https://api-testnet.bybit.com'
        : 'https://api.bybit.com'
    });

    // Test connection
    const connected = await bybitClient.testConnection();
    if (!connected) {
      throw new Error('Failed to connect to Bybit API');
    }

    // Get current position
    const position = await bybitClient.getPosition('IDUSDT');
    if (!position) {
      logger.info('No IDUSDT position found');
      return;
    }

    logger.info('Found position:', position);

    // Close position by placing opposite market order
    const closeResult = await bybitClient['makeRequest']('/v5/order/create', 'POST', {
      category: 'linear',
      symbol: 'IDUSDT',
      side: position.side === 'Buy' ? 'Sell' : 'Buy',
      orderType: 'Market',
      qty: position.size.toString(),
      reduceOnly: true
    });

    logger.info('Position closed successfully:', closeResult);

  } catch (error) {
    logger.error('Error closing position:', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    });
    process.exit(1);
  }
}

// Run the script
closePosition().then(() => {
  console.log('\n✅ Position closed.');
  process.exit(0);
}).catch((error) => {
  console.error('\n❌ Failed to close position:', error);
  process.exit(1);
});
