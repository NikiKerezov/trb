/**
 * Signal parsing service with exact format matching
 */

import { ParsedSignal, SignalParseResult, Direction, TakeProfitLevel, RawTelegramMessage } from '../types';
import { getLogger } from '../utils/logger';

export class SignalParser {
  private static readonly SIGNAL_HEADER = '🚀 AI SIGNAL IS READY';
  
  /**
   * Parse a raw Telegram message to extract trading signal
   */
  static parseMessage(message: RawTelegramMessage): SignalParseResult {
    const logger = getLogger();
    
    try {
      const text = message.text.trim();
      
      // Check if message starts with the expected header
      if (!text.startsWith(this.SIGNAL_HEADER)) {
        return {
          success: false,
          error: 'Message does not start with expected signal header'
        };
      }

      // Extract signal components using regex patterns
      // Allow any emoji or no emoji before field names
      const pairMatch = text.match(/(?:📉|📊|💹)?\s*Pair:\s*([A-Z]+\/[A-Z]+)/i);
      const directionMatch = text.match(/(?:🔴|🟢|🔵|⚪️|▶️)?\s*Direction:\s*(LONG|SHORT)/i);
      const entryMatch = text.match(/(?:🎯|📍|➡️)?\s*Entry Zone:\s*([\d.,]+|market)/i);
      const stopLossMatch = text.match(/(?:🛡️|❌|🚫|⛔️)?\s*Stop Loss:\s*([\d.,]+)/i);
      const takeProfitsMatch = text.match(/(?:🎯|✅|💰)?\s*Take Profits?:\s*(.+?)(?=\n\n|🧠|$)/si);
      const confidenceMatch = text.match(/(?:🧠|📊|💡)?\s*Confidence:\s*([\d.]+)%/i);

      // Validate all required components are present
      if (!pairMatch || !pairMatch[1]) {
        return { success: false, error: 'Pair not found or invalid format' };
      }
      if (!directionMatch || !directionMatch[1]) {
        return { success: false, error: 'Direction not found or invalid format' };
      }
      if (!entryMatch || !entryMatch[1]) {
        return { success: false, error: 'Entry zone not found or invalid format' };
      }
      if (!stopLossMatch || !stopLossMatch[1]) {
        return { success: false, error: 'Stop loss not found or invalid format' };
      }
      if (!takeProfitsMatch || !takeProfitsMatch[1]) {
        return { success: false, error: 'Take profits not found or invalid format' };
      }
      if (!confidenceMatch || !confidenceMatch[1]) {
        return { success: false, error: 'Confidence not found or invalid format' };
      }

      // Parse take profits
      const takeProfitsResult = this.parseTakeProfits(takeProfitsMatch![1]);
      if (!takeProfitsResult.success) {
        return takeProfitsResult;
      }

      // Convert and validate numeric values
      // Remove commas from numbers (e.g., "108,700" -> "108700")
      const entryZoneStr = entryMatch![1].toLowerCase().replace(/,/g, '');
      const entryZone: number | 'market' = entryZoneStr === 'market' ? 'market' : parseFloat(entryZoneStr);
      const stopLoss = parseFloat(stopLossMatch![1].replace(/,/g, ''));
      const confidence = parseFloat(confidenceMatch![1].replace(/,/g, ''));

      if (entryZone !== 'market' && (isNaN(entryZone as number) || (entryZone as number) <= 0)) {
        return { success: false, error: 'Invalid entry zone value' };
      }
      if (isNaN(stopLoss) || stopLoss <= 0) {
        return { success: false, error: 'Invalid stop loss value' };
      }
      if (isNaN(confidence) || confidence < 0 || confidence > 100) {
        return { success: false, error: 'Invalid confidence value' };
      }

      // Validate direction-specific logic (skip if entry is market)
      const direction = directionMatch[1] as Direction;
      if (entryZone !== 'market') {
        if (direction === 'LONG' && stopLoss >= (entryZone as number)) {
          return {
            success: false,
            error: 'For LONG positions, stop loss must be below entry zone'
          };
        }
        if (direction === 'SHORT' && stopLoss <= (entryZone as number)) {
          return {
            success: false,
            error: 'For SHORT positions, stop loss must be above entry zone'
          };
        }

        // Validate take profit levels against direction
        const invalidTPs = takeProfitsResult.takeProfits.filter(tp => {
          if (direction === 'LONG') {
            return tp.price <= (entryZone as number);
          } else {
            return tp.price >= (entryZone as number);
          }
        });

        if (invalidTPs.length > 0) {
          return {
            success: false,
            error: `Invalid take profit levels for ${direction} position: ${invalidTPs.map(tp => `TP${tp.level}: ${tp.price}`).join(', ')}`
          };
        }
      }

      const signal: ParsedSignal = {
        pair: pairMatch[1],
        direction,
        entryZone,
        stopLoss,
        takeProfits: takeProfitsResult.takeProfits,
        confidence
      };

      logger.info('Signal parsed successfully', {
        messageId: message.messageId,
        signal: {
          pair: signal.pair,
          direction: signal.direction,
          entryZone: signal.entryZone,
          stopLoss: signal.stopLoss,
          takeProfitsCount: signal.takeProfits.length,
          confidence: signal.confidence
        }
      });

      return { success: true, signal };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown parsing error';
      logger.error('Error parsing signal', {
        messageId: message.messageId,
        error: errorMessage,
        messageText: message.text.substring(0, 200) + (message.text.length > 200 ? '...' : '')
      });

      return {
        success: false,
        error: `Parsing error: ${errorMessage}`
      };
    }
  }

  /**
   * Parse take profit levels from the take profits string
   */
  private static parseTakeProfits(takeProfitsText: string): 
    | { success: true; takeProfits: TakeProfitLevel[] }
    | { success: false; error: string } {
    
    try {
      const takeProfits: TakeProfitLevel[] = [];
      
      // Match patterns like "1 - 0.310, 2 - 0.307, 3 - 0.304" or "1 - 109,000"
      const tpMatches = takeProfitsText.matchAll(/(\d+)\s*-\s*([\d.,]+)/g);

      for (const match of tpMatches) {
        const level = parseInt(match[1]!);
        const price = parseFloat(match[2]!.replace(/,/g, ''));
        
        if (isNaN(level) || level <= 0) {
          return { success: false, error: `Invalid take profit level: ${match[1]!}` };
        }
        if (isNaN(price) || price <= 0) {
          return { success: false, error: `Invalid take profit price: ${match[2]!}` };
        }
        
        takeProfits.push({ level, price });
      }

      if (takeProfits.length === 0) {
        return { success: false, error: 'No valid take profit levels found' };
      }

      // Sort by level to ensure order
      takeProfits.sort((a, b) => a.level - b.level);

      // Validate that levels are sequential starting from 1
      for (let i = 0; i < takeProfits.length; i++) {
        if (takeProfits[i]!.level !== i + 1) {
          return { 
            success: false, 
            error: `Take profit levels must be sequential starting from 1. Found level ${takeProfits[i]!.level} at position ${i + 1}` 
          };
        }
      }

      return { success: true, takeProfits };

    } catch (error) {
      return {
        success: false,
        error: `Error parsing take profits: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  /**
   * Validate signal data integrity
   */
  static validateSignal(signal: ParsedSignal): { valid: true } | { valid: false; errors: string[] } {
    const errors: string[] = [];

    // Validate pair format
    if (!/^[A-Z]+\/[A-Z]+$/.test(signal.pair)) {
      errors.push('Invalid pair format. Expected format: XXX/YYY');
    }

    // Validate numeric values
    if (signal.entryZone !== 'market' && signal.entryZone <= 0) {
      errors.push('Entry zone must be positive');
    }
    if (signal.stopLoss <= 0) {
      errors.push('Stop loss must be positive');
    }
    if (signal.confidence < 0 || signal.confidence > 100) {
      errors.push('Confidence must be between 0 and 100');
    }

    // Validate take profit ordering for the direction
    if (signal.direction === 'LONG') {
      // For LONG: TP1 < TP2 < TP3 (prices increasing - selling at higher prices for profit)
      for (let i = 0; i < signal.takeProfits.length - 1; i++) {
        if (signal.takeProfits[i]!.price >= signal.takeProfits[i + 1]!.price) {
          errors.push(`For LONG positions, TP${signal.takeProfits[i]!.level} (${signal.takeProfits[i]!.price}) must be less than TP${signal.takeProfits[i + 1]!.level} (${signal.takeProfits[i + 1]!.price})`);
        }
      }
    } else {
      // For SHORT: TP1 > TP2 > TP3 (prices decreasing - buying back at lower prices for profit)
      for (let i = 0; i < signal.takeProfits.length - 1; i++) {
        if (signal.takeProfits[i]!.price <= signal.takeProfits[i + 1]!.price) {
          errors.push(`For SHORT positions, TP${signal.takeProfits[i]!.level} (${signal.takeProfits[i]!.price}) must be greater than TP${signal.takeProfits[i + 1]!.level} (${signal.takeProfits[i + 1]!.price})`);
        }
      }
    }

    return errors.length === 0 ? { valid: true } : { valid: false, errors };
  }

  /**
   * Check if a message could potentially be a signal (basic format check)
   */
  static isPotentialSignal(text: string): boolean {
    return text.trim().startsWith(this.SIGNAL_HEADER);
  }
}