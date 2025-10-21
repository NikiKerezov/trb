/**
 * Test script to execute a mock ID/USDT LONG trade with tight TPs
 * Tests position manager and stop loss trailing functionality
 */

import { config as dotenvConfig } from 'dotenv';
import { BybitClient } from './src/services/bybit-client';
import { PositionManager } from './src/services/position-manager';
import { ParsedSignal } from './src/types';
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

async function executeMockTradeWithMonitoring() {
  const logger = getLogger();

  try {
    logger.info('Starting mock trade execution with position monitoring...');

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
    const currentPrice = await bybitClient.getMarketPrice('ID/USDT');
    logger.info('Current ID/USDT price:', { currentPrice });

    // Create mock signal with VERY TIGHT TPs (1% and 2% above entry)
    // This increases chances of hitting TP1/TP2 quickly for testing
    const tp1Price = currentPrice * 1.01;  // 1% above
    const tp2Price = currentPrice * 1.02;  // 2% above
    const tp3Price = currentPrice * 1.03;  // 3% above
    const slPrice = currentPrice * 0.99;   // 1% below

    const mockSignal: ParsedSignal = {
      pair: 'ID/USDT',
      direction: 'LONG',
      entryZone: 'market',
      stopLoss: slPrice,
      takeProfits: [
        { level: 1, price: tp1Price },
        { level: 2, price: tp2Price },
        { level: 3, price: tp3Price }
      ],
      confidence: 95
    };

    logger.info('Mock signal created with tight TPs:', {
      entry: currentPrice,
      sl: slPrice,
      tp1: tp1Price,
      tp2: tp2Price,
      tp3: tp3Price,
      tp1Percent: '+1%',
      tp2Percent: '+2%',
      tp3Percent: '+3%'
    });

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

    logger.info('✅ Trade executed successfully!', {
      orderId: result.orderId,
      leverage: result.leverage,
      positionSize: result.positionSize,
      actualEntryPrice: result.actualEntryPrice
    });

    // Initialize position manager and start monitoring
    logger.info('Starting position manager to monitor for TP hits and SL trailing...');
    const positionManager = new PositionManager(bybitClient);

    // Create position tracking
    const position = positionManager.createPosition(
      mockSignal,
      result.orderId,
      result.leverage,
      result.positionSize,
      result.actualEntryPrice
    );

    logger.info('Position created in manager:', {
      positionId: position.id,
      symbol: position.symbol,
      stopLoss: position.stopLoss
    });

    // Start monitoring
    positionManager.startMonitoring();

    // Monitor for 60 seconds to see if price moves and TPs are hit
    logger.info('Monitoring position for 60 seconds to check for TP hits and SL trailing...');
    logger.info('Watch for logs showing "Take profit hit" and "Stop loss adjusted"');

    let monitorCount = 0;
    const monitorInterval = setInterval(async () => {
      monitorCount++;

      // Get current position state
      const currentPosition = positionManager.getPosition(position.id);
      if (currentPosition) {
        const currentMarketPrice = await bybitClient.getMarketPrice('ID/USDT');

        logger.info(`[${monitorCount}] Position update:`, {
          currentPrice: currentMarketPrice,
          entryPrice: currentPosition.entryPrice,
          currentSL: currentPosition.stopLoss,
          tp1Filled: currentPosition.takeProfits[0]?.filled,
          tp2Filled: currentPosition.takeProfits[1]?.filled,
          tp3Filled: currentPosition.takeProfits[2]?.filled,
          pnl: currentPosition.pnl,
          status: currentPosition.status
        });

        // Check if position is closed
        if (currentPosition.status === 'COMPLETED') {
          logger.info('✅ Position closed!');
          clearInterval(monitorInterval);
          positionManager.stopMonitoring();

          logger.info('Test completed. Position summary:', {
            finalPnl: currentPosition.pnl,
            tp1Hit: currentPosition.takeProfits[0]?.filled,
            tp2Hit: currentPosition.takeProfits[1]?.filled,
            tp3Hit: currentPosition.takeProfits[2]?.filled,
            finalSL: currentPosition.stopLoss
          });

          process.exit(0);
        }
      }
    }, 5000); // Check every 5 seconds

    // Auto-stop after 60 seconds
    setTimeout(() => {
      clearInterval(monitorInterval);
      positionManager.stopMonitoring();

      const finalPosition = positionManager.getPosition(position.id);
      logger.info('Test timeout (60s). Final position state:', {
        status: finalPosition?.status,
        currentSL: finalPosition?.stopLoss,
        tp1Hit: finalPosition?.takeProfits[0]?.filled,
        tp2Hit: finalPosition?.takeProfits[1]?.filled,
        pnl: finalPosition?.pnl
      });

      logger.info('Test completed. If no TP was hit, the market did not move enough.');
      process.exit(0);
    }, 60000);

  } catch (error) {
    logger.error('Error executing mock trade:', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    });
    process.exit(1);
  }
}

// Run the test
executeMockTradeWithMonitoring().catch((error) => {
  console.error('\n❌ Mock trade execution failed:', error);
  process.exit(1);
});
