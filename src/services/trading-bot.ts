/**
 * Main trading bot service that orchestrates all components
 */

import { AppConfig, RawTelegramMessage, ParsedSignal } from '../types';
import { TelegramClient } from './telegram-client';
import { BybitClient } from './bybit-client';
import { PositionManager } from './position-manager';
import { SignalParser } from './signal-parser';
import { getLogger, logSignalReceived, logApiError } from '../utils/logger';

export class TradingBot {
  private config: AppConfig;
  private telegramClient: TelegramClient;
  private bybitClient: BybitClient;
  private positionManager: PositionManager;
  private isRunning = false;

  constructor(config: AppConfig) {
    this.config = config;
    this.telegramClient = new TelegramClient(config.telegram);
    this.bybitClient = new BybitClient(config.bybit);
    this.positionManager = new PositionManager(this.bybitClient);
  }

  /**
   * Start the trading bot
   */
  async start(): Promise<void> {
    const logger = getLogger();
    
    try {
      logger.info('Starting trading bot...');

      // Test Bybit connection
      logger.info('Testing Bybit API connection...');
      const bybitConnected = await this.bybitClient.testConnection();
      if (!bybitConnected) {
        throw new Error('Failed to connect to Bybit API');
      }
      logger.info('Bybit API connection successful');

      // Connect to Telegram
      logger.info('Connecting to Telegram...');
      await this.telegramClient.connect();
      logger.info('Telegram connection successful');

      // Set up message handler
      this.telegramClient.onMessage(this.handleTelegramMessage.bind(this));

      // Start position monitoring
      this.positionManager.startMonitoring();

      this.isRunning = true;
      logger.info('Trading bot started successfully', {
        telegramSource: this.config.telegram.signalSource,
        portfolioPercentage: this.config.bot.portfolioPercentage,
        testnet: this.config.bybit.testnet
      });

      // Log initial account balance
      try {
        const balance = await this.bybitClient.getAccountBalance();
        logger.info('Initial account balance', balance);
      } catch (error) {
        logger.warn('Could not fetch initial balance', { 
          error: error instanceof Error ? error.message : 'Unknown error' 
        });
      }

    } catch (error) {
      logger.error('Failed to start trading bot', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      await this.stop();
      throw error;
    }
  }

  /**
   * Stop the trading bot
   */
  async stop(): Promise<void> {
    const logger = getLogger();
    
    try {
      logger.info('Stopping trading bot...');
      
      this.isRunning = false;

      // Stop position monitoring
      this.positionManager.stopMonitoring();

      // Disconnect from Telegram
      if (this.telegramClient.isClientConnected()) {
        await this.telegramClient.disconnect();
      }

      logger.info('Trading bot stopped successfully');

      // Log final statistics
      const stats = this.positionManager.getPositionStats();
      logger.info('Final trading statistics', stats);

    } catch (error) {
      logger.error('Error stopping trading bot', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Handle incoming Telegram messages
   */
  private async handleTelegramMessage(message: RawTelegramMessage): Promise<void> {
    const logger = getLogger();

    try {
      // Log that we received a message
      logSignalReceived(message.text, message.senderUsername || 'unknown');

      // Check if this could be a trading signal
      if (!SignalParser.isPotentialSignal(message.text)) {
        logger.debug('Message is not a potential trading signal, ignoring', {
          messageId: message.messageId,
          preview: message.text.substring(0, 50)
        });
        return;
      }

      // Parse the signal
      const parseResult = SignalParser.parseMessage(message);
      
      if (!parseResult.success) {
        logger.warn('Failed to parse trading signal', {
          messageId: message.messageId,
          error: parseResult.error,
          messagePreview: message.text.substring(0, 100)
        });
        return;
      }

      const signal = parseResult.signal;

      // Validate the parsed signal
      const validation = SignalParser.validateSignal(signal);
      if (!validation.valid) {
        logger.warn('Invalid signal data', {
          messageId: message.messageId,
          errors: validation.errors,
          signal
        });
        return;
      }

      logger.info('Valid trading signal received', {
        messageId: message.messageId,
        signal: {
          pair: signal.pair,
          direction: signal.direction,
          entryZone: signal.entryZone,
          stopLoss: signal.stopLoss,
          takeProfits: signal.takeProfits.length,
          confidence: signal.confidence
        }
      });

      // Check if we already have a position for this symbol
      const existingPosition = this.positionManager.getPositionBySymbol(signal.pair);
      if (existingPosition) {
        logger.warn('Position already exists for symbol, skipping signal', {
          symbol: signal.pair,
          existingPositionId: existingPosition.id
        });
        return;
      }

      // Check maximum concurrent trades
      const activePositions = this.positionManager.getActivePositions();
      if (activePositions.length >= this.config.bot.maxConcurrentTrades) {
        logger.warn('Maximum concurrent trades reached, skipping signal', {
          activeCount: activePositions.length,
          maxAllowed: this.config.bot.maxConcurrentTrades,
          signal: { pair: signal.pair, direction: signal.direction }
        });
        return;
      }

      // Execute the trade
      await this.executeTrade(signal, message.messageId);

    } catch (error) {
      logApiError('telegram', error as Error, {
        action: 'handle_message',
        messageId: message.messageId
      });
    }
  }

  /**
   * Execute a trade based on a parsed signal
   */
  private async executeTrade(signal: ParsedSignal, messageId: number): Promise<void> {
    const logger = getLogger();

    try {
      // Get current account balance
      const balance = await this.bybitClient.getAccountBalance();
      const portfolioValue = balance.availableBalance;

      if (portfolioValue <= 0) {
        logger.error('Insufficient balance to execute trade', {
          availableBalance: balance.availableBalance,
          signal: { pair: signal.pair, direction: signal.direction }
        });
        return;
      }

      logger.info('Executing trade', {
        messageId,
        signal: {
          pair: signal.pair,
          direction: signal.direction,
          entryZone: signal.entryZone,
          confidence: signal.confidence
        },
        portfolioValue,
        portfolioPercentage: this.config.bot.portfolioPercentage
      });

      // Execute the trade through Bybit
      const tradeResult = await this.bybitClient.executeTrade(
        signal,
        portfolioValue,
        this.config.bot.portfolioPercentage
      );

      // Create and track the position
      const position = this.positionManager.createPosition(
        signal,
        tradeResult.orderId,
        tradeResult.leverage,
        tradeResult.positionSize
      );

      logger.info('Trade executed successfully', {
        messageId,
        positionId: position.id,
        orderId: tradeResult.orderId,
        symbol: signal.pair,
        direction: signal.direction,
        size: tradeResult.positionSize,
        leverage: tradeResult.leverage
      });

    } catch (error) {
      logger.error('Failed to execute trade', {
        messageId,
        signal: {
          pair: signal.pair,
          direction: signal.direction
        },
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Get current bot status
   */
  getStatus(): {
    isRunning: boolean;
    telegramConnected: boolean;
    positionStats: ReturnType<PositionManager['getPositionStats']>;
    config: {
      signalSource: string;
      portfolioPercentage: number;
      testnet: boolean;
      maxConcurrentTrades: number;
    };
  } {
    return {
      isRunning: this.isRunning,
      telegramConnected: this.telegramClient.isClientConnected(),
      positionStats: this.positionManager.getPositionStats(),
      config: {
        signalSource: this.config.telegram.signalSource,
        portfolioPercentage: this.config.bot.portfolioPercentage,
        testnet: this.config.bybit.testnet,
        maxConcurrentTrades: this.config.bot.maxConcurrentTrades
      }
    };
  }

  /**
   * Get all positions
   */
  getPositions(): ReturnType<PositionManager['getAllPositions']> {
    return this.positionManager.getAllPositions();
  }

  /**
   * Manually close a position
   */
  async closePosition(positionId: string, reason = 'manual'): Promise<boolean> {
    const logger = getLogger();
    
    try {
      const success = await this.positionManager.closePosition(positionId, reason);
      
      if (success) {
        logger.info('Position closed manually', { positionId, reason });
      } else {
        logger.warn('Failed to close position', { positionId, reason });
      }
      
      return success;
    } catch (error) {
      logger.error('Error closing position manually', {
        positionId,
        reason,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return false;
    }
  }

  /**
   * Get current account balance
   */
  async getAccountBalance(): Promise<ReturnType<BybitClient['getAccountBalance']>> {
    return this.bybitClient.getAccountBalance();
  }

  /**
   * Cleanup old positions
   */
  cleanupOldPositions(): number {
    return this.positionManager.cleanupOldPositions();
  }
}