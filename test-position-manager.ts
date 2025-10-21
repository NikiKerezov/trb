/**
 * Focused test to verify position manager can query positions with slash symbols
 * This tests the exact bug that was failing on VPS
 */

import { config as dotenvConfig } from 'dotenv';
import { BybitClient } from './src/services/bybit-client';
import { PositionManager } from './src/services/position-manager';
import { ParsedSignal } from './src/types';
import { initializeLogger, getLogger } from './src/utils/logger';

dotenvConfig();

initializeLogger({
  portfolioPercentage: 1,
  logLevel: 'info',
  maxConcurrentTrades: 5,
  stopLossBuffer: 0.1
});

async function testPositionManagerFix() {
  const logger = getLogger();

  try {
    logger.info('=== Testing Position Manager with Slash Symbol ===');
    logger.info('This test verifies the "symbol not exist" bug is fixed');

    const bybitClient = new BybitClient({
      apiKey: process.env.BYBIT_API_KEY!,
      secret: process.env.BYBIT_SECRET!,
      testnet: process.env.BYBIT_TESTNET === 'true',
      baseUrl: process.env.BYBIT_TESTNET === 'true'
        ? 'https://api-testnet.bybit.com'
        : 'https://api.bybit.com'
    });

    await bybitClient.testConnection();
    logger.info('Connected to Bybit');

    const currentPrice = await bybitClient.getMarketPrice('ID/USDT');
    logger.info('Current ID/USDT price:', { currentPrice });

    const mockSignal: ParsedSignal = {
      pair: 'ID/USDT',  // WITH SLASH - this was causing errors
      direction: 'LONG',
      entryZone: 'market',
      stopLoss: currentPrice * 0.99,
      takeProfits: [
        { level: 1, price: currentPrice * 1.01 },
        { level: 2, price: currentPrice * 1.02 },
        { level: 3, price: currentPrice * 1.03 }
      ],
      confidence: 95
    };

    const balance = await bybitClient.getAccountBalance();

    logger.info('Executing trade...');
    const result = await bybitClient.executeTrade(mockSignal, balance.walletBalance, 1);
    logger.info('Trade executed:', { orderId: result.orderId, size: result.positionSize });

    // Create position with SLASH symbol (this is what fails on VPS)
    const positionManager = new PositionManager(bybitClient);
    const position = positionManager.createPosition(
      mockSignal,
      result.orderId,
      result.leverage,
      result.positionSize,
      result.actualEntryPrice
    );

    logger.info('Position created with symbol:', { symbol: position.symbol });
    logger.info('Starting position manager monitoring...');
    logger.info('Watch for "getPosition called" and "Position updated successfully" logs');
    logger.info('If you see "Error updating position" - the fix FAILED');
    logger.info('');

    positionManager.startMonitoring();

    // Wait 35 seconds to see 3 automatic updates (every 10 seconds)
    await new Promise(resolve => setTimeout(resolve, 35000));

    logger.info('');
    logger.info('=== Test Complete ===');

    const stats = positionManager.getPositionStats();
    logger.info('Position stats:', stats);

    positionManager.stopMonitoring();

    // Close position
    logger.info('Closing test position...');
    const bybitPosition = await bybitClient.getPosition('ID/USDT');
    if (bybitPosition && bybitPosition.size > 0) {
      await bybitClient.placeMarketOrder({
        symbol: 'IDUSDT',
        side: 'Sell',
        orderType: 'Market',
        qty: bybitPosition.size
      });
      logger.info('Position closed');
    }

    logger.info('');
    logger.info('✅ TEST PASSED - No "symbol not exist" errors!');
    process.exit(0);

  } catch (error) {
    logger.error('❌ TEST FAILED:', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    process.exit(1);
  }
}

testPositionManagerFix();
