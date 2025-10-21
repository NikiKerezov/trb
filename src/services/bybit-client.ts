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
   * Convert signal symbol format (BTC/USDT) to Bybit format (BTCUSDT)
   */
  private convertSymbolToBybit(symbol: string): string {
    return symbol.replace('/', '');
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

      // For POST requests, use JSON body for signature; for GET, use query params
      let paramsString: string;
      if (method === 'POST') {
        paramsString = Object.keys(params).length > 0 ? JSON.stringify(params) : '';
      } else {
        paramsString = new URLSearchParams(
          Object.entries(params).map(([key, value]) => [key, String(value)]) as Array<[string, string]>
        ).toString();
      }

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

      // Error codes that indicate "already set" - treat as success:
      // 110043: "leverage not modified" - leverage already at requested value
      // 34040: "not modified" - stop loss/take profit already at requested value
      if (data.retCode !== 0 && data.retCode !== 110043 && data.retCode !== 34040) {
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
      availableBalance: null  // Not using availableBalance, just set to null
    };
  }

  /**
   * Get current position information
   */
  async getPosition(symbol: string): Promise<PositionInfo | null> {
    // Convert symbol format if needed (BTC/USDT -> BTCUSDT)
    const bybitSymbol = this.convertSymbolToBybit(symbol);

    // Log to verify the fix is working
    getLogger().info('getPosition called', {
      inputSymbol: symbol,
      convertedSymbol: bybitSymbol
    });

    const result = await this.makeRequest('/v5/position/list', 'GET', {
      category: 'linear',
      symbol: bybitSymbol
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

    const position = result.list.find(p => p.symbol === bybitSymbol && parseFloat(p.size) > 0);
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
    portfolioPercentage: number,
    currentPrice: number
  ): { size: number; leverage: number } {
    // Amount we're willing to risk (in USDT)
    const riskAmount = (portfolioValue * portfolioPercentage) / 100;

    // Use current price for market entries
    const entryPrice = signal.entryZone === 'market' ? currentPrice : signal.entryZone;

    // Distance from entry to stop loss (in price units)
    const stopLossDistance = Math.abs(entryPrice - signal.stopLoss);

    // Risk per unit: how much we lose per unit if stop loss hits
    const riskPerUnit = stopLossDistance;

    // Position size: how many units we can buy with our risk amount
    // If we buy X units and stop loss hits, we lose X * riskPerUnit
    // We want X * riskPerUnit = riskAmount
    const positionSizeInUnits = riskAmount / riskPerUnit;

    // Position value in USDT at entry price
    const positionValueUSDT = positionSizeInUnits * entryPrice;

    // Leverage = Position Value / Margin Required
    // We want margin required to be reasonable (max 20x leverage for safety)
    const maxLeverage = 20;
    const requiredMargin = positionValueUSDT / maxLeverage;

    // Ensure we don't exceed available balance for margin
    const availableForMargin = portfolioValue * 0.8; // Use max 80% of balance as margin
    const actualMargin = Math.min(requiredMargin, availableForMargin);

    // Calculate final leverage and position size
    const leverage = Math.min(maxLeverage, Math.max(1, positionValueUSDT / actualMargin));
    const finalPositionSize = (actualMargin * leverage) / entryPrice;

    return {
      size: Number(finalPositionSize.toFixed(6)),
      leverage: Math.floor(leverage)
    };
  }

  /**
   * Set leverage for a symbol
   */
  async setLeverage(symbol: string, leverage: number): Promise<void> {
    // Convert symbol format if needed (BTC/USDT -> BTCUSDT)
    const bybitSymbol = this.convertSymbolToBybit(symbol);

    await this.makeRequest('/v5/position/set-leverage', 'POST', {
      category: 'linear',
      symbol: bybitSymbol,
      buyLeverage: leverage.toString(),
      sellLeverage: leverage.toString()
    });

    logTradeExecution('UPDATE_SL', {
      action: 'set_leverage',
      symbol: bybitSymbol,
      leverage
    });
  }

  /**
   * Place a market order
   */
  async placeMarketOrder(order: TradeOrder): Promise<OrderResponse> {
    // Convert symbol format if needed (BTC/USDT -> BTCUSDT)
    const bybitSymbol = this.convertSymbolToBybit(order.symbol);

    // Round quantity - for low-priced altcoins, use whole numbers
    const roundedQty = Math.floor(order.qty);

    getLogger().info('Placing market order', {
      originalQty: order.qty,
      roundedQty,
      symbol: bybitSymbol
    });

    const params = {
      category: 'linear',
      symbol: bybitSymbol,
      side: order.side,
      orderType: 'Market',
      qty: roundedQty.toString(),
      timeInForce: 'IOC'
    };

    const result = await this.makeRequest('/v5/order/create', 'POST', params) as {
      orderId: string;
      orderLinkId: string;
    };

    const response: OrderResponse = {
      orderId: result.orderId,
      symbol: bybitSymbol,
      side: order.side,
      orderType: 'Market',
      qty: order.qty,
      status: 'Created',
      createdTime: new Date().toISOString()
    };

    logTradeExecution('OPEN', {
      orderId: response.orderId,
      symbol: bybitSymbol,
      side: order.side,
      qty: order.qty
    });

    return response;
  }

  /**
   * Set stop loss for a position
   */
  async setStopLoss(symbol: string, side: Direction, stopLossPrice: number): Promise<void> {
    // Convert symbol format if needed (BTC/USDT -> BTCUSDT)
    const bybitSymbol = this.convertSymbolToBybit(symbol);

    // Use trading-stop endpoint to set stop loss for the position
    await this.makeRequest('/v5/position/trading-stop', 'POST', {
      category: 'linear',
      symbol: bybitSymbol,
      stopLoss: stopLossPrice.toString(),
      positionIdx: 0 // 0 for one-way mode (default), 1 for Buy side in hedge mode, 2 for Sell side
    });

    logTradeExecution('UPDATE_SL', {
      symbol: bybitSymbol,
      side,
      stopLossPrice,
      action: 'set_stop_loss'
    });
  }

  /**
   * Cancel existing stop loss orders
   */
  async cancelStopLoss(symbol: string): Promise<void> {
    // Convert symbol format if needed (BTC/USDT -> BTCUSDT)
    const bybitSymbol = this.convertSymbolToBybit(symbol);

    try {
      // Get all open orders for the symbol
      const result = await this.makeRequest('/v5/order/realtime', 'GET', {
        category: 'linear',
        symbol: bybitSymbol
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
          symbol: bybitSymbol,
          orderId: order.orderId
        });
      }

      if (stopLossOrders.length > 0) {
        logTradeExecution('UPDATE_SL', {
          symbol: bybitSymbol,
          action: 'cancel_stop_loss',
          cancelledOrders: stopLossOrders.length
        });
      }
    } catch (error) {
      // Log but don't throw - it's ok if there are no stop loss orders to cancel
      getLogger().warn('Error cancelling stop loss orders', { symbol: bybitSymbol, error });
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
    // Use only the highest TP (last in array) for the entire position
    const highestTP = takeProfits[takeProfits.length - 1];

    if (!highestTP) {
      getLogger().warn('No take profit levels found');
      return;
    }

    const orderSide = side === 'LONG' ? 'Sell' : 'Buy';
    // Round quantity to whole number for altcoins
    const roundedQty = Math.floor(positionSize);

    try {
      await this.makeRequest('/v5/order/create', 'POST', {
        category: 'linear',
        symbol,
        side: orderSide,
        orderType: 'Limit',
        qty: roundedQty.toString(),
        price: highestTP.price.toString(),
        timeInForce: 'GTC',
        reduceOnly: true
      });

      logTradeExecution('TAKE_PROFIT', {
        symbol,
        side,
        level: highestTP.level,
        price: highestTP.price,
        qty: roundedQty
      });

      getLogger().info('Take profit order placed for entire position', {
        symbol,
        tpLevel: highestTP.level,
        tpPrice: highestTP.price,
        qty: roundedQty
      });
    } catch (error) {
      logApiError('bybit', error as Error, {
        action: 'set_take_profit',
        symbol,
        level: highestTP.level,
        price: highestTP.price
      });
      throw error; // Throw to allow retry if needed
    }
  }

  /**
   * Execute a complete trade based on signal with atomic rollback on failure
   */
  async executeTrade(
    signal: ParsedSignal,
    portfolioValue: number,
    portfolioPercentage: number
  ): Promise<{ orderId: string; leverage: number; positionSize: number; actualEntryPrice: number }> {
    const logger = getLogger();
    let orderResponse: OrderResponse | null = null;

    // Convert symbol from BTC/USDT to BTCUSDT format for Bybit API
    const bybitSymbol = this.convertSymbolToBybit(signal.pair);

    try {
      // Fetch market price if entry is market
      let currentPrice: number;
      if (signal.entryZone === 'market') {
        currentPrice = await this.getMarketPrice(bybitSymbol);
        logger.info('Market entry requested, fetched current price', {
          symbol: signal.pair,
          currentPrice
        });
      } else {
        currentPrice = signal.entryZone;
      }

      // Calculate position size and leverage
      const { size, leverage } = this.calculatePositionSize(signal, portfolioValue, portfolioPercentage, currentPrice);

      logger.info('Executing trade', {
        signal: {
          pair: signal.pair,
          direction: signal.direction,
          entryZone: signal.entryZone,
          actualEntryPrice: currentPrice,
          stopLoss: signal.stopLoss
        },
        calculatedSize: size,
        calculatedLeverage: leverage,
        portfolioValue,
        portfolioPercentage
      });

      // Set leverage
      await this.setLeverage(bybitSymbol, leverage);

      // Place market order
      const order: TradeOrder = {
        symbol: bybitSymbol,
        side: signal.direction === 'LONG' ? 'Buy' : 'Sell',
        orderType: 'Market',
        qty: size
      };

      orderResponse = await this.placeMarketOrder(order);

      // Wait for order to fill and verify position exists
      await new Promise(resolve => setTimeout(resolve, 3000));

      const position = await this.getPosition(bybitSymbol);
      if (!position || position.size === 0) {
        throw new Error('Order placed but position not found - possible fill failure');
      }

      // Set stop loss with retry mechanism
      let stopLossSet = false;
      for (let attempt = 1; attempt <= 3 && !stopLossSet; attempt++) {
        try {
          await this.setStopLoss(bybitSymbol, signal.direction, signal.stopLoss);
          stopLossSet = true;
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : JSON.stringify(error);
          logger.warn(`Stop loss attempt ${attempt} failed`, {
            error: errorMsg,
            stopLossPrice: signal.stopLoss,
            symbol: bybitSymbol
          });
          if (attempt === 3) {
            throw new Error(`Failed to set stop loss after 3 attempts. Last error: ${errorMsg}`);
          }
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        }
      }

      // Set take profit orders
      // Don't swallow errors - we need to see why TP placement fails
      await this.setTakeProfits(bybitSymbol, signal.direction, signal.takeProfits, size);

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
        positionSize: position.size,
        actualEntryPrice: currentPrice
      };

    } catch (error) {
      logger.error('Trade execution failed, initiating rollback', {
        error: error instanceof Error ? error.message : 'Unknown error',
        orderId: orderResponse?.orderId
      });

      // Rollback: Close position if order was placed
      if (orderResponse) {
        try {
          await this.emergencyClosePosition(bybitSymbol, signal.direction);
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
   * Get current market price for a symbol
   */
  async getMarketPrice(symbol: string): Promise<number> {
    // Convert symbol format if needed (BTC/USDT -> BTCUSDT)
    const bybitSymbol = this.convertSymbolToBybit(symbol);

    const result = await this.makeRequest('/v5/market/tickers', 'GET', {
      category: 'linear',
      symbol: bybitSymbol
    }) as {
      list: Array<{
        symbol: string;
        lastPrice: string;
      }>;
    };

    if (!result.list || result.list.length === 0) {
      throw new Error(`Market price not found for symbol: ${bybitSymbol}`);
    }

    const ticker = result.list[0];
    if (!ticker) {
      throw new Error(`Market price not found for symbol: ${bybitSymbol}`);
    }

    const price = parseFloat(ticker.lastPrice);
    if (isNaN(price) || price <= 0) {
      throw new Error(`Invalid market price for symbol: ${symbol}`);
    }

    return price;
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