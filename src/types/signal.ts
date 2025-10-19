/**
 * Trading signal types and interfaces
 */

export type Direction = 'LONG' | 'SHORT';

export type TakeProfitLevel = {
  level: number;
  price: number;
};

export type ParsedSignal = {
  pair: string;
  direction: Direction;
  entryZone: number;
  stopLoss: number;
  takeProfits: TakeProfitLevel[];
  confidence: number;
};

export type SignalParseResult = {
  success: true;
  signal: ParsedSignal;
} | {
  success: false;
  error: string;
};

export type RawTelegramMessage = {
  text: string;
  chatId: number;
  messageId: number;
  date: Date;
  fromBot?: boolean;
  senderUsername?: string;
};