# Telegram Trading Bot Setup Guide

This guide will help you set up and configure the TypeScript trading bot that monitors Telegram signals and executes trades on Bybit.

## Prerequisites

- Node.js 18+ installed
- npm or yarn package manager
- Telegram account
- Bybit account (testnet recommended for initial testing)

## Installation

1. **Clone and install dependencies:**
   ```bash
   npm install
   ```

2. **Build the project:**
   ```bash
   npm run build
   ```

## Configuration

1. **Copy the environment template:**
   ```bash
   cp .env.example .env
   ```

2. **Configure Telegram API:**
   
   a. Go to https://my.telegram.org/
   
   b. Log in with your phone number
   
   c. Navigate to "API Development Tools"
   
   d. Create a new application to get:
      - `API ID` (number)
      - `API Hash` (32-character string)
   
   e. Add these to your `.env` file:
   ```
   TELEGRAM_API_ID=your_api_id_here
   TELEGRAM_API_HASH=your_api_hash_here
   TELEGRAM_SIGNAL_SOURCE=@your_signal_bot_username
   ```

3. **Configure Bybit API:**
   
   a. Log in to your Bybit account
   
   b. Go to Account & Security > API Management
   
   c. Create a new API key with these permissions:
      - Read-Write for Derivatives (required for trading)
      - Read-Write for Spot (optional)
   
   d. Add the credentials to your `.env` file:
   ```
   BYBIT_API_KEY=your_api_key_here
   BYBIT_SECRET=your_secret_here
   BYBIT_TESTNET=true  # Use true for testing, false for live trading
   ```

4. **Configure Bot Settings:**
   ```
   PORTFOLIO_PERCENTAGE=10  # Use 10% of portfolio per trade
   LOG_LEVEL=info          # info, debug, warn, error
   ```

## Getting Telegram Session String

The bot needs to authenticate with your personal Telegram account. To generate a session string:

1. Make sure you have added your API credentials to `.env`:
   ```
   TELEGRAM_API_ID=your_api_id
   TELEGRAM_API_HASH=your_api_hash
   ```

2. Run the session generator:
   ```bash
   npm run generate-session
   ```

3. Follow the prompts:
   - Enter your phone number (with country code, e.g., +1234567890)
   - Enter the verification code sent to your Telegram
   - Enter your 2FA password (if you have 2FA enabled)

4. Copy the generated session string and add it to your `.env` file:
   ```
   TELEGRAM_SESSION_STRING=your_generated_session_string_here
   ```

## Signal Format

The bot only processes messages that match this exact format:

```
🚀 AI SIGNAL IS READY

📉 Pair: ACE/USDT
🔴 Direction: SHORT
🎯 Entry Zone: 0.313
🛡️ Stop Loss: 0.329

🎯 Take Profits: 1 - 0.310, 2 - 0.307, 3 - 0.304

🧠 Confidence: 90.9%
```

Any message that doesn't match this format will be ignored.

## Running the Bot

1. **Development mode (with auto-restart):**
   ```bash
   npm run dev
   ```

2. **Production mode:**
   ```bash
   npm start
   ```

3. **Build and run:**
   ```bash
   npm run build
   npm start
   ```

## Trading Strategy

The bot implements the following strategy:

1. **Position Opening:**
   - Uses 10% of portfolio per trade (configurable)
   - Calculates leverage so stop loss = -100% of position size
   - Places market order at current price
   - Sets stop loss and take profit orders

2. **Position Management:**
   - When price hits TP1: Move stop loss to entry price
   - When price hits TP2: Move stop loss to TP1 price
   - When price hits TP3+: Move stop loss to previous TP level

3. **Risk Management:**
   - Maximum 5 concurrent trades (configurable)
   - Only one position per symbol at a time
   - Automatic stop loss adjustment

## Security Considerations

1. **API Keys:**
   - Never commit `.env` file to version control
   - Use testnet for initial testing
   - Limit API key permissions to only what's needed

2. **Telegram Session:**
   - Keep session string secure
   - Regenerate if compromised

3. **Position Limits:**
   - Start with small position sizes
   - Test thoroughly on testnet before live trading

## Monitoring and Logs

- Logs are written to `logs/` directory
- Bot status is logged every 5 minutes
- All trading actions are logged with full context
- Error logs include stack traces for debugging

## Troubleshooting

1. **"Failed to connect to Bybit API":**
   - Check API key and secret
   - Verify testnet setting matches your API key type
   - Check network connectivity

2. **"Session string required":**
   - The bot needs to authenticate with Telegram first
   - Follow the session string setup process

3. **"Signal parsing failed":**
   - Verify the signal format matches exactly
   - Check for extra spaces or formatting differences

4. **"Insufficient balance":**
   - Ensure you have enough USDT in your account
   - Check if funds are available for trading (not in open orders)

## Support

For issues or questions:
1. Check the logs in `logs/` directory
2. Review the signal format requirements
3. Verify all API credentials are correct
4. Test with smaller position sizes first