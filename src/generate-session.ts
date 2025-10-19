/**
 * Script to generate Telegram session string for first-time authentication
 */

import { TelegramClient, sessions } from 'telegram';
import * as dotenv from 'dotenv';

const { StringSession } = sessions;
const input = require('input');

// Load environment variables
dotenv.config();

async function generateSession() {
  console.log('📱 Telegram Session Generator');
  console.log('============================\n');

  // Validate environment variables
  const apiId = process.env.TELEGRAM_API_ID;
  const apiHash = process.env.TELEGRAM_API_HASH;

  if (!apiId || !apiHash) {
    console.error('❌ Missing required environment variables!');
    console.error('\nPlease ensure your .env file contains:');
    console.error('TELEGRAM_API_ID=your_api_id');
    console.error('TELEGRAM_API_HASH=your_api_hash');
    process.exit(1);
  }

  console.log('✅ API credentials found\n');

  try {
    // Create empty session
    const session = new StringSession('');
    
    // Initialize client
    const client = new TelegramClient(
      session, 
      Number(apiId), 
      apiHash, 
      {
        connectionRetries: 5,
      }
    );

    console.log('🔄 Connecting to Telegram...\n');

    // Start authentication
    await client.start({
      phoneNumber: async () => {
        return await input.text('📞 Please enter your phone number (with country code): ');
      },
      password: async () => {
        const pwd = await input.text('🔐 Please enter your 2FA password (press Enter if none): ');
        return pwd || '';
      },
      phoneCode: async () => {
        return await input.text('💬 Please enter the verification code: ');
      },
      onError: (err) => {
        console.error('❌ Error:', err.message);
      }
    });

    console.log('\n✅ Successfully authenticated!\n');

    // Get the session string
    const sessionString = client.session.save() as unknown as string;

    console.log('🎉 Your session string has been generated!\n');
    console.log('📋 Add this to your .env file:\n');
    console.log(`TELEGRAM_SESSION_STRING=${sessionString}`);
    console.log('\n⚠️  Keep this string secure - it provides access to your Telegram account!');
    console.log('\n✅ You can now run the trading bot with: npm run dev');

    // Disconnect
    await client.disconnect();

  } catch (error) {
    console.error('\n❌ Failed to generate session:', error);
    process.exit(1);
  }
}

// Run the generator
generateSession().catch(error => {
  console.error('Unhandled error:', error);
  process.exit(1);
});