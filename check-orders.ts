/**
 * Check open orders
 */

import { config as dotenvConfig } from 'dotenv';
import { BybitClient } from './src/services/bybit-client';
import { initializeLogger, getLogger } from './src/utils/logger';

dotenvConfig();

initializeLogger({
  portfolioPercentage: 1,
  logLevel: 'info',
  maxConcurrentTrades: 5,
  stopLossBuffer: 0.1
});

async function checkOrders() {
  const logger = getLogger();

  try {
    const bybitClient = new BybitClient({
      apiKey: process.env.BYBIT_API_KEY!,
      secret: process.env.BYBIT_SECRET!,
      testnet: process.env.BYBIT_TESTNET === 'true',
      baseUrl: process.env.BYBIT_TESTNET === 'true'
        ? 'https://api-testnet.bybit.com'
        : 'https://api.bybit.com'
    });

    const orders = await bybitClient['makeRequest']('/v5/order/realtime', 'GET', {
      category: 'linear',
      symbol: 'IDUSDT'
    });

    console.log('Open IDUSDT orders:', JSON.stringify(orders, null, 2));

  } catch (error) {
    logger.error('Error:', error);
    process.exit(1);
  }
}

checkOrders().then(() => process.exit(0));
