/**
 * Trading and position management types
 */

import { Direction, ParsedSignal } from './signal';

export type TradeStatus = 'PENDING' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED' | 'ERROR';

export type Position = {
  id: string;
  symbol: string;
  side: Direction;
  size: number;
  entryPrice: number;
  currentPrice: number;
  stopLoss: number;
  takeProfits: Array<{
    level: number;
    price: number;
    filled: boolean;
  }>;
  leverage: number;
  pnl: number;
  status: TradeStatus;
  createdAt: Date;
  updatedAt: Date;
};

export type TradeOrder = {
  symbol: string;
  side: 'Buy' | 'Sell';
  orderType: 'Market' | 'Limit';
  qty: number;
  price?: number;
  stopLoss?: number;
  takeProfit?: number;
  leverage?: number;
};

export type OrderResponse = {
  orderId: string;
  symbol: string;
  side: string;
  orderType: string;
  qty: number;
  price?: number;
  status: string;
  createdTime: string;
};

export type PositionInfo = {
  symbol: string;
  side: string;
  size: number;
  entryPrice: number;
  markPrice: number;
  unrealisedPnl: number;
  leverage: number;
  positionStatus: string;
};

export type AccountBalance = {
  coin: string;
  walletBalance: number;
  availableBalance: number;
};

export type TradeExecutionRequest = {
  signal: ParsedSignal;
  portfolioValue: number;
  leverage: number;
};