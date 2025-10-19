/**
 * Test script to execute a mock BTC/USDT LONG trade
 */

import { config as dotenvConfig } from 'dotenv';
import { BybitClient } from './src/services/bybit-client';
import { ParsedSignal } from './src/types';
import { initializeLogger, getLogger } from './src/utils/logger';

// Load environment variables
dotenvConfig();

// Initialize logger
initializeLogger({
  portfolioPercentage: 1,
  logLevel: 'debug',
  maxConcurrentTrades: 5,
  stopLossBuffer: 0.1
});

async function executeMockTrade() {
  const logger = getLogger();

  try {
    logger.info('Starting mock trade execution...');

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
    logger.info('Connected to Bybit API successfully');

    // Get current ID/USDT price
    const currentPrice = await bybitClient.getMarketPrice('IDUSDT');
    logger.info('Current ID/USDT price:', { currentPrice });

    // Create mock signal with your requirements:
    // SL: $0.001 lower, TP1: $0.001 higher, TP2: $0.002 higher, TP3: $0.003 higher
    const mockSignal: ParsedSignal = {
      pair: 'ID/USDT',
      direction: 'LONG',
      entryZone: 'market',
      stopLoss: currentPrice - 0.001,
      takeProfits: [
        { level: 1, price: currentPrice + 0.001 },
        { level: 2, price: currentPrice + 0.002 },
        { level: 3, price: currentPrice + 0.003 }
      ],
      confidence: 95
    };

    logger.info('Mock signal created:', mockSignal);

    // Get account balance
    const balance = await bybitClient.getAccountBalance();
    const portfolioValue = balance.walletBalance;
    logger.info('Account balance:', { walletBalance: portfolioValue });

    if (!portfolioValue || portfolioValue <= 0) {
      throw new Error('Insufficient balance');
    }

    // Execute trade with 1% of portfolio
    logger.info('Executing trade...');
    const result = await bybitClient.executeTrade(
      mockSignal,
      portfolioValue,
      1 // 1% of portfolio
    );

    logger.info('Trade executed successfully!', result);
    logger.info('Position details:', {
      orderId: result.orderId,
      leverage: result.leverage,
      positionSize: result.positionSize,
      actualEntryPrice: result.actualEntryPrice
    });

  } catch (error) {
    logger.error('Error executing mock trade:', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    });
    process.exit(1);
  }
}

// Run the test
executeMockTrade().then(() => {
  console.log('\n✅ Mock trade execution completed. Check the logs above for details.');
  process.exit(0);
}).catch((error) => {
  console.error('\n❌ Mock trade execution failed:', error);
  process.exit(1);
});
