/**
 * Position management service for tracking and updating positions
 */

import { 
  Position, 
  TradeStatus, 
  ParsedSignal, 
  Direction,
  PositionInfo 
} from '../types';
import { BybitClient } from './bybit-client';
import { getLogger, logPositionUpdate, logTradeExecution } from '../utils/logger';

export class PositionManager {
  private positions: Map<string, Position> = new Map();
  private bybitClient: BybitClient;
  private monitoringInterval: NodeJS.Timeout | null = null;
  private readonly MONITORING_INTERVAL_MS = 10000; // 10 seconds

  constructor(bybitClient: BybitClient) {
    this.bybitClient = bybitClient;
  }

  /**
   * Create and track a new position
   */
  createPosition(
    signal: ParsedSignal,
    orderId: string,
    leverage: number,
    positionSize: number,
    actualEntryPrice: number
  ): Position {
    const position: Position = {
      id: `${signal.pair}_${Date.now()}`,
      symbol: signal.pair,
      side: signal.direction,
      size: positionSize,
      entryPrice: actualEntryPrice,
      currentPrice: actualEntryPrice,
      stopLoss: signal.stopLoss,
      takeProfits: signal.takeProfits.map(tp => ({
        level: tp.level,
        price: tp.price,
        filled: false
      })),
      leverage,
      pnl: 0,
      status: 'ACTIVE',
      createdAt: new Date(),
      updatedAt: new Date()
    };

    this.positions.set(position.id, position);
    
    logPositionUpdate(position.id, {
      action: 'created',
      symbol: position.symbol,
      side: position.side,
      size: position.size,
      entryPrice: position.entryPrice
    });

    return position;
  }

  /**
   * Update position with current market data
   */
  async updatePosition(positionId: string): Promise<Position | null> {
    const position = this.positions.get(positionId);
    if (!position) {
      return null;
    }

    try {
      // Get current position data from Bybit
      const bybitPosition = await this.bybitClient.getPosition(position.symbol);
      
      if (!bybitPosition) {
        // Position closed
        position.status = 'COMPLETED';
        position.updatedAt = new Date();
        
        logPositionUpdate(positionId, {
          action: 'closed',
          finalPnl: position.pnl
        });
        
        return position;
      }

      // Update position data
      const oldPrice = position.currentPrice;
      position.currentPrice = bybitPosition.markPrice;
      position.pnl = bybitPosition.unrealisedPnl;
      position.updatedAt = new Date();

      // Check for take profit hits and adjust stop loss
      await this.checkTakeProfitHits(position, oldPrice, position.currentPrice);

      return position;

    } catch (error) {
      getLogger().error('Error updating position', {
        positionId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return position;
    }
  }

  /**
   * Check if any take profit levels have been hit and adjust stop loss accordingly
   */
  private async checkTakeProfitHits(
    position: Position, 
    oldPrice: number, 
    newPrice: number
  ): Promise<void> {
    const logger = getLogger();

    for (const tp of position.takeProfits) {
      if (tp.filled) continue;

      const priceHitTP = this.checkPriceHitLevel(
        position.side,
        oldPrice,
        newPrice,
        tp.price
      );

      if (priceHitTP) {
        tp.filled = true;
        
        logTradeExecution('TAKE_PROFIT', {
          positionId: position.id,
          symbol: position.symbol,
          level: tp.level,
          price: tp.price,
          action: 'hit'
        });

        // Adjust stop loss based on TP level
        await this.adjustStopLoss(position, tp.level);
      }
    }
  }

  /**
   * Check if price has crossed a specific level
   */
  private checkPriceHitLevel(
    side: Direction,
    oldPrice: number,
    newPrice: number,
    targetPrice: number
  ): boolean {
    if (side === 'LONG') {
      // For LONG: price moving up hits TP when it crosses above
      return oldPrice < targetPrice && newPrice >= targetPrice;
    } else {
      // For SHORT: price moving down hits TP when it crosses below
      return oldPrice > targetPrice && newPrice <= targetPrice;
    }
  }

  /**
   * Adjust stop loss based on take profit level hit
   */
  private async adjustStopLoss(position: Position, tpLevel: number): Promise<void> {
    const logger = getLogger();

    try {
      let newStopLoss: number;

      switch (tpLevel) {
        case 1:
          // TP1 hit: Move stop loss to entry price
          newStopLoss = position.entryPrice;
          break;
        case 2:
          // TP2 hit: Move stop loss to TP1 price
          const tp1 = position.takeProfits.find(tp => tp.level === 1);
          newStopLoss = tp1 ? tp1.price : position.entryPrice;
          break;
        default:
          // TP3+ hit: Move stop loss to previous TP level
          const prevTP = position.takeProfits.find(tp => tp.level === tpLevel - 1);
          newStopLoss = prevTP ? prevTP.price : position.stopLoss;
          break;
      }

      // Only update if the new stop loss is better than the current one
      const shouldUpdate = position.side === 'LONG' 
        ? newStopLoss > position.stopLoss
        : newStopLoss < position.stopLoss;

      if (shouldUpdate) {
        await this.bybitClient.setStopLoss(position.symbol, position.side, newStopLoss);
        
        const oldStopLoss = position.stopLoss;
        position.stopLoss = newStopLoss;
        position.updatedAt = new Date();

        logPositionUpdate(position.id, {
          action: 'stop_loss_adjusted',
          tpLevel,
          oldStopLoss,
          newStopLoss,
          reason: `TP${tpLevel} hit`
        });

        logger.info('Stop loss adjusted', {
          positionId: position.id,
          symbol: position.symbol,
          tpLevel,
          oldStopLoss,
          newStopLoss
        });
      }

    } catch (error) {
      logger.error('Error adjusting stop loss', {
        positionId: position.id,
        tpLevel,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Start monitoring all active positions
   */
  startMonitoring(): void {
    if (this.monitoringInterval) {
      return; // Already monitoring
    }

    const logger = getLogger();
    logger.info('Starting position monitoring', {
      intervalMs: this.MONITORING_INTERVAL_MS
    });

    let cleanupCounter = 0;
    this.monitoringInterval = setInterval(async () => {
      const activePositions = Array.from(this.positions.values())
        .filter(p => p.status === 'ACTIVE');

      for (const position of activePositions) {
        try {
          await this.updatePosition(position.id);
        } catch (error) {
          logger.error('Error in position monitoring', {
            positionId: position.id,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      }

      // Auto-cleanup completed positions every 10 monitoring cycles (100 seconds)
      cleanupCounter++;
      if (cleanupCounter >= 10) {
        cleanupCounter = 0;
        try {
          const removedCount = this.cleanupOldPositions();
          if (removedCount > 0) {
            logger.info('Automatic position cleanup completed', { removedCount });
          }
        } catch (error) {
          logger.error('Error in automatic cleanup', {
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      }
    }, this.MONITORING_INTERVAL_MS);
  }

  /**
   * Stop monitoring positions
   */
  stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
      
      getLogger().info('Position monitoring stopped');
    }
  }

  /**
   * Get all positions
   */
  getAllPositions(): Position[] {
    return Array.from(this.positions.values());
  }

  /**
   * Get active positions
   */
  getActivePositions(): Position[] {
    return Array.from(this.positions.values())
      .filter(p => p.status === 'ACTIVE');
  }

  /**
   * Get position by ID
   */
  getPosition(positionId: string): Position | undefined {
    return this.positions.get(positionId);
  }

  /**
   * Get position by symbol
   */
  getPositionBySymbol(symbol: string): Position | undefined {
    return Array.from(this.positions.values())
      .find(p => p.symbol === symbol && p.status === 'ACTIVE');
  }

  /**
   * Close a position manually
   */
  async closePosition(positionId: string, reason = 'manual'): Promise<boolean> {
    const position = this.positions.get(positionId);
    if (!position || position.status !== 'ACTIVE') {
      return false;
    }

    try {
      // Cancel all open orders for this symbol
      await this.bybitClient.cancelStopLoss(position.symbol);
      
      // Close position with market order
      const orderSide = position.side === 'LONG' ? 'Sell' : 'Buy';
      await this.bybitClient.placeMarketOrder({
        symbol: position.symbol,
        side: orderSide,
        orderType: 'Market',
        qty: position.size
      });

      position.status = 'COMPLETED';
      position.updatedAt = new Date();

      logPositionUpdate(positionId, {
        action: 'manually_closed',
        reason,
        finalPnl: position.pnl
      });

      return true;

    } catch (error) {
      getLogger().error('Error closing position', {
        positionId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return false;
    }
  }

  /**
   * Get position statistics
   */
  getPositionStats(): {
    total: number;
    active: number;
    completed: number;
    totalPnl: number;
    activePnl: number;
  } {
    const positions = this.getAllPositions();
    
    return {
      total: positions.length,
      active: positions.filter(p => p.status === 'ACTIVE').length,
      completed: positions.filter(p => p.status === 'COMPLETED').length,
      totalPnl: positions.reduce((sum, p) => sum + p.pnl, 0),
      activePnl: positions
        .filter(p => p.status === 'ACTIVE')
        .reduce((sum, p) => sum + p.pnl, 0)
    };
  }

  /**
   * Cleanup old completed positions
   */
  cleanupOldPositions(maxAge = 24 * 60 * 60 * 1000): number { // Default 24 hours
    const cutoffTime = new Date(Date.now() - maxAge);
    let removedCount = 0;

    for (const [id, position] of this.positions.entries()) {
      if (position.status === 'COMPLETED' && position.updatedAt < cutoffTime) {
        this.positions.delete(id);
        removedCount++;
      }
    }

    if (removedCount > 0) {
      getLogger().info('Cleaned up old positions', { removedCount });
    }

    return removedCount;
  }
}