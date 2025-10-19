/**
 * Bybit API client for trade execution and position management
 */

import crypto from 'crypto';
import fetch, { Response } from 'node-fetch';
import { 
  BybitConfig, 
  TradeOrder, 
  OrderResponse, 
  PositionInfo, 
  AccountBalance,
  ParsedSignal,
  Direction
} from '../types';
import { getLogger, logApiError, logTradeExecution } from '../utils/logger';

export class BybitClient {
  private config: BybitConfig;
  private baseUrl: string;
  private requestQueue: Array<() => Promise<unknown>> = [];
  private isProcessingQueue = false;
  private lastRequestTime = 0;
  private readonly MIN_REQUEST_INTERVAL = 100; // 100ms between requests (10 req/sec limit)

  constructor(config: BybitConfig) {
    this.config = config;
    this.baseUrl = config.baseUrl || (config.testnet 
      ? 'https://api-testnet.bybit.com' 
      : 'https://api.bybit.com');
  }

  /**
   * Generate authentication signature for Bybit API
   */
  private generateSignature(timestamp: number, params: string): string {
    const recvWindow = '5000';
    const message = timestamp + this.config.apiKey + recvWindow + params;
    return crypto
      .createHmac('sha256', this.config.secret)
      .update(message)
      .digest('hex');
  }

  /**
   * Rate limiting wrapper for API requests
   */
  private async withRateLimit<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.requestQueue.push(async () => {
        try {
          const result = await fn();
          resolve(result);
          return result;
        } catch (error) {
          reject(error);
          return Promise.reject(error);
        }
      });
      
      this.processRequestQueue();
    });
  }

  /**
   * Process the request queue with rate limiting
   */
  private async processRequestQueue(): Promise<void> {
    if (this.isProcessingQueue || this.requestQueue.length === 0) {
      return;
    }

    this.isProcessingQueue = true;

    while (this.requestQueue.length > 0) {
      const now = Date.now();
      const timeSinceLastRequest = now - this.lastRequestTime;

      if (timeSinceLastRequest < this.MIN_REQUEST_INTERVAL) {
        await new Promise(resolve => 
          setTimeout(resolve, this.MIN_REQUEST_INTERVAL - timeSinceLastRequest)
        );
      }

      const request = this.requestQueue.shift();
      if (request) {
        this.lastRequestTime = Date.now();
        try {
          await request();
        } catch (error) {
          // Error is already handled in the request wrapper
        }
      }
    }

    this.isProcessingQueue = false;
  }

  /**
   * Make authenticated request to Bybit API
   */
  private async makeRequest(
    endpoint: string, 
    method: 'GET' | 'POST' = 'GET', 
    params: Record<string, unknown> = {}
  ): Promise<unknown> {
    return this.withRateLimit(() => this.makeRawRequest(endpoint, method, params));
  }

  /**
   * Make raw authenticated request to Bybit API (without rate limiting)
   */
  private async makeRawRequest(
    endpoint: string, 
    method: 'GET' | 'POST' = 'GET', 
    params: Record<string, unknown> = {}
  ): Promise<unknown> {
    const logger = getLogger();
    
    try {
      const timestamp = Date.now();
      const paramsString = new URLSearchParams(
        Object.entries(params).map(([key, value]) => [key, String(value)]) as Array<[string, string]>
      ).toString();

      const signature = this.generateSignature(timestamp, paramsString);

      const headers = {
        'Content-Type': 'application/json',
        'X-BAPI-API-KEY': this.config.apiKey,
        'X-BAPI-SIGN': signature,
        'X-BAPI-SIGN-TYPE': '2',
        'X-BAPI-TIMESTAMP': timestamp.toString(),
        'X-BAPI-RECV-WINDOW': '5000'
      };

      const url = `${this.baseUrl}${endpoint}`;
      const requestOptions: Parameters<typeof fetch>[1] = {
        method,
        headers
      };

      let finalUrl = url;
      
      if (method === 'POST') {
        requestOptions.body = JSON.stringify(params);
      } else if (Object.keys(params).length > 0) {
        finalUrl = `${url}?${paramsString}`;
      }

      const response = await fetch(finalUrl, requestOptions);
      return this.handleResponse(response, endpoint);

    } catch (error) {
      logApiError('bybit', error as Error, { endpoint, method, params });
      throw error;
    }
  }

  /**
   * Handle API response and check for errors
   */
  private async handleResponse(response: Response, endpoint: string): Promise<unknown> {
    const responseText = await response.text();
    
    if (!response.ok) {
      throw new Error(`Bybit API error: ${response.status} ${response.statusText} - ${responseText}`);
    }

    try {
      const data = JSON.parse(responseText) as { retCode: number; retMsg: string; result: unknown };
      
      if (data.retCode !== 0) {
        throw new Error(`Bybit API error: ${data.retCode} - ${data.retMsg}`);
      }

      return data.result;
    } catch (parseError) {
      throw new Error(`Failed to parse Bybit API response: ${responseText}`);
    }
  }

  /**
   * Get account balance
   */
  async getAccountBalance(coin = 'USDT'): Promise<AccountBalance> {
    const result = await this.makeRequest('/v5/account/wallet-balance', 'GET', {
      accountType: 'UNIFIED',
      coin
    }) as { 
      list: Array<{
        coin: Array<{
          coin: string;
          walletBalance: string;
          availableBalance: string;
        }>;
      }>;
    };

    const coinData = result.list[0]?.coin?.find(c => c.coin === coin);
    if (!coinData) {
      throw new Error(`Balance not found for coin: ${coin}`);
    }

    return {
      coin,
      walletBalance: parseFloat(coinData.walletBalance),
      availableBalance: parseFloat(coinData.availableBalance)
    };
  }

  /**
   * Get current position information
   */
  async getPosition(symbol: string): Promise<PositionInfo | null> {
    const result = await this.makeRequest('/v5/position/list', 'GET', {
      category: 'linear',
      symbol
    }) as {
      list: Array<{
        symbol: string;
        side: string;
        size: string;
        avgPrice: string;
        markPrice: string;
        unrealisedPnl: string;
        leverage: string;
        positionStatus: string;
      }>;
    };

    const position = result.list.find(p => p.symbol === symbol && parseFloat(p.size) > 0);
    if (!position) {
      return null;
    }

    return {
      symbol: position.symbol,
      side: position.side,
      size: parseFloat(position.size),
      entryPrice: parseFloat(position.avgPrice),
      markPrice: parseFloat(position.markPrice),
      unrealisedPnl: parseFloat(position.unrealisedPnl),
      leverage: parseFloat(position.leverage),
      positionStatus: position.positionStatus
    };
  }

  /**
   * Calculate position size based on signal and portfolio percentage
   * Uses conservative risk management principles
   */
  calculatePositionSize(
    signal: ParsedSignal, 
    portfolioValue: number, 
    portfolioPercentage: number
  ): { size: number; leverage: number } {
    // Amount we're willing to risk (in USDT)
    const riskAmount = (portfolioValue * portfolioPercentage) / 100;
    
    // Distance from entry to stop loss (in price units)
    const stopLossDistance = Math.abs(signal.entryZone - signal.stopLoss);
    
    // Risk per unit: how much we lose per unit if stop loss hits
    const riskPerUnit = stopLossDistance;
    
    // Position size: how many units we can buy with our risk amount
    // If we buy X units and stop loss hits, we lose X * riskPerUnit
    // We want X * riskPerUnit = riskAmount
    const positionSizeInUnits = riskAmount / riskPerUnit;
    
    // Position value in USDT at entry price
    const positionValueUSDT = positionSizeInUnits * signal.entryZone;
    
    // Leverage = Position Value / Margin Required
    // We want margin required to be reasonable (max 20x leverage for safety)
    const maxLeverage = 20;
    const requiredMargin = positionValueUSDT / maxLeverage;
    
    // Ensure we don't exceed available balance for margin
    const availableForMargin = portfolioValue * 0.8; // Use max 80% of balance as margin
    const actualMargin = Math.min(requiredMargin, availableForMargin);
    
    // Calculate final leverage and position size
    const leverage = Math.min(maxLeverage, Math.max(1, positionValueUSDT / actualMargin));
    const finalPositionSize = (actualMargin * leverage) / signal.entryZone;
    
    return { 
      size: Number(finalPositionSize.toFixed(6)), 
      leverage: Math.floor(leverage) 
    };
  }

  /**
   * Set leverage for a symbol
   */
  async setLeverage(symbol: string, leverage: number): Promise<void> {
    await this.makeRequest('/v5/position/set-leverage', 'POST', {
      category: 'linear',
      symbol,
      buyLeverage: leverage.toString(),
      sellLeverage: leverage.toString()
    });

    logTradeExecution('UPDATE_SL', {
      action: 'set_leverage',
      symbol,
      leverage
    });
  }

  /**
   * Place a market order
   */
  async placeMarketOrder(order: TradeOrder): Promise<OrderResponse> {
    const params = {
      category: 'linear',
      symbol: order.symbol,
      side: order.side,
      orderType: 'Market',
      qty: order.qty.toString(),
      timeInForce: 'IOC'
    };

    const result = await this.makeRequest('/v5/order/create', 'POST', params) as {
      orderId: string;
      orderLinkId: string;
    };

    const response: OrderResponse = {
      orderId: result.orderId,
      symbol: order.symbol,
      side: order.side,
      orderType: 'Market',
      qty: order.qty,
      status: 'Created',
      createdTime: new Date().toISOString()
    };

    logTradeExecution('OPEN', {
      orderId: response.orderId,
      symbol: order.symbol,
      side: order.side,
      qty: order.qty
    });

    return response;
  }

  /**
   * Set stop loss for a position
   */
  async setStopLoss(symbol: string, side: Direction, stopLossPrice: number): Promise<void> {
    // Close existing stop loss orders first
    await this.cancelStopLoss(symbol);

    // Create new stop loss order
    const orderSide = side === 'LONG' ? 'Sell' : 'Buy';
    
    await this.makeRequest('/v5/order/create', 'POST', {
      category: 'linear',
      symbol,
      side: orderSide,
      orderType: 'Market',
      qty: '0', // Will close entire position
      stopLoss: stopLossPrice.toString(),
      timeInForce: 'GTC',
      reduceOnly: true
    });

    logTradeExecution('UPDATE_SL', {
      symbol,
      side,
      stopLossPrice,
      action: 'set_stop_loss'
    });
  }

  /**
   * Cancel existing stop loss orders
   */
  async cancelStopLoss(symbol: string): Promise<void> {
    try {
      // Get all open orders for the symbol
      const result = await this.makeRequest('/v5/order/realtime', 'GET', {
        category: 'linear',
        symbol
      }) as {
        list: Array<{
          orderId: string;
          orderType: string;
          stopLoss?: string;
        }>;
      };

      // Cancel stop loss orders
      const stopLossOrders = result.list.filter(order => order.stopLoss);
      
      for (const order of stopLossOrders) {
        await this.makeRequest('/v5/order/cancel', 'POST', {
          category: 'linear',
          symbol,
          orderId: order.orderId
        });
      }

      if (stopLossOrders.length > 0) {
        logTradeExecution('UPDATE_SL', {
          symbol,
          action: 'cancel_stop_loss',
          cancelledOrders: stopLossOrders.length
        });
      }
    } catch (error) {
      // Log but don't throw - it's ok if there are no stop loss orders to cancel
      getLogger().warn('Error cancelling stop loss orders', { symbol, error });
    }
  }

  /**
   * Place take profit orders
   */
  async setTakeProfits(
    symbol: string, 
    side: Direction, 
    takeProfits: Array<{ level: number; price: number }>,
    positionSize: number
  ): Promise<void> {
    const orderSide = side === 'LONG' ? 'Sell' : 'Buy';
    const sizePerTP = positionSize / takeProfits.length;

    for (const tp of takeProfits) {
      try {
        await this.makeRequest('/v5/order/create', 'POST', {
          category: 'linear',
          symbol,
          side: orderSide,
          orderType: 'Limit',
          qty: sizePerTP.toString(),
          price: tp.price.toString(),
          timeInForce: 'GTC',
          reduceOnly: true
        });

        logTradeExecution('TAKE_PROFIT', {
          symbol,
          side,
          level: tp.level,
          price: tp.price,
          qty: sizePerTP
        });
      } catch (error) {
        logApiError('bybit', error as Error, {
          action: 'set_take_profit',
          symbol,
          level: tp.level,
          price: tp.price
        });
      }
    }
  }

  /**
   * Execute a complete trade based on signal with atomic rollback on failure
   */
  async executeTrade(
    signal: ParsedSignal, 
    portfolioValue: number, 
    portfolioPercentage: number
  ): Promise<{ orderId: string; leverage: number; positionSize: number }> {
    const logger = getLogger();
    let orderResponse: OrderResponse | null = null;
    
    try {
      // Calculate position size and leverage
      const { size, leverage } = this.calculatePositionSize(signal, portfolioValue, portfolioPercentage);
      
      logger.info('Executing trade', {
        signal: {
          pair: signal.pair,
          direction: signal.direction,
          entryZone: signal.entryZone,
          stopLoss: signal.stopLoss
        },
        calculatedSize: size,
        calculatedLeverage: leverage,
        portfolioValue,
        portfolioPercentage
      });

      // Set leverage
      await this.setLeverage(signal.pair, leverage);

      // Place market order
      const order: TradeOrder = {
        symbol: signal.pair,
        side: signal.direction === 'LONG' ? 'Buy' : 'Sell',
        orderType: 'Market',
        qty: size
      };

      orderResponse = await this.placeMarketOrder(order);

      // Wait for order to fill and verify position exists
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const position = await this.getPosition(signal.pair);
      if (!position || position.size === 0) {
        throw new Error('Order placed but position not found - possible fill failure');
      }

      // Set stop loss with retry mechanism
      let stopLossSet = false;
      for (let attempt = 1; attempt <= 3 && !stopLossSet; attempt++) {
        try {
          await this.setStopLoss(signal.pair, signal.direction, signal.stopLoss);
          stopLossSet = true;
        } catch (error) {
          logger.warn(`Stop loss attempt ${attempt} failed`, { error });
          if (attempt === 3) {
            throw new Error('Failed to set stop loss after 3 attempts');
          }
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        }
      }

      // Set take profit orders (non-critical, log failures but don't rollback)
      try {
        await this.setTakeProfits(signal.pair, signal.direction, signal.takeProfits, size);
      } catch (error) {
        logger.error('Failed to set take profit orders', { 
          error: error instanceof Error ? error.message : 'Unknown error',
          symbol: signal.pair 
        });
        // Continue without take profits - stop loss is more critical
      }

      logger.info('Trade executed successfully', {
        orderId: orderResponse.orderId,
        symbol: signal.pair,
        side: signal.direction,
        size,
        leverage,
        stopLossSet,
        actualPositionSize: position.size
      });

      return {
        orderId: orderResponse.orderId,
        leverage,
        positionSize: position.size
      };

    } catch (error) {
      logger.error('Trade execution failed, initiating rollback', {
        error: error instanceof Error ? error.message : 'Unknown error',
        orderId: orderResponse?.orderId
      });

      // Rollback: Close position if order was placed
      if (orderResponse) {
        try {
          await this.emergencyClosePosition(signal.pair, signal.direction);
          logger.info('Emergency position closure completed', { 
            symbol: signal.pair,
            orderId: orderResponse.orderId 
          });
        } catch (rollbackError) {
          logger.error('CRITICAL: Failed to close position during rollback', {
            symbol: signal.pair,
            orderId: orderResponse.orderId,
            rollbackError: rollbackError instanceof Error ? rollbackError.message : 'Unknown error'
          });
        }
      }

      logApiError('bybit', error as Error, {
        action: 'execute_trade',
        signal: {
          pair: signal.pair,
          direction: signal.direction
        }
      });
      throw error;
    }
  }

  /**
   * Emergency position closure
   */
  private async emergencyClosePosition(symbol: string, direction: Direction): Promise<void> {
    const position = await this.getPosition(symbol);
    if (!position || position.size === 0) {
      return; // No position to close
    }

    const orderSide = direction === 'LONG' ? 'Sell' : 'Buy';
    await this.placeMarketOrder({
      symbol,
      side: orderSide,
      orderType: 'Market',
      qty: position.size
    });
  }

  /**
   * Check API connection
   */
  async testConnection(): Promise<boolean> {
    try {
      await this.makeRequest('/v5/market/time', 'GET');
      return true;
    } catch (error) {
      logApiError('bybit', error as Error, { action: 'test_connection' });
      return false;
    }
  }
}