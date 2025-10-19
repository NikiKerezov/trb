#!/usr/bin/env node

const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const input = require('input');
require('dotenv').config();

(async () => {
  console.log('📱 Telegram Session Generator');
  console.log('============================\n');

  const apiId = parseInt(process.env.TELEGRAM_API_ID);
  const apiHash = process.env.TELEGRAM_API_HASH;

  if (!apiId || !apiHash) {
    console.error('❌ Missing required environment variables!');
    console.error('\nPlease ensure your .env file contains:');
    console.error('TELEGRAM_API_ID=your_api_id');
    console.error('TELEGRAM_API_HASH=your_api_hash');
    process.exit(1);
  }

  console.log('✅ API credentials loaded');
  console.log(`API ID: ${apiId}\n`);

  const stringSession = new StringSession(''); // Empty string for new session
  
  console.log('Initializing Telegram client...\n');

  try {
    const client = new TelegramClient(stringSession, apiId, apiHash, {
      connectionRetries: 5,
    });

    await client.start({
      phoneNumber: async () => 
        await input.text('Enter your phone number with country code (e.g., +1234567890): '),
      password: async () => 
        await input.text('Enter your 2FA password (leave empty if not set): '),
      phoneCode: async () => 
        await input.text('Enter the code you received: '),
      onError: (err) => console.log('Error:', err),
    });

    console.log('\n✅ Success! You are now connected.');
    const sessionString = client.session.save();
    
    console.log('\n📋 Your session string:\n');
    console.log(sessionString);
    
    console.log('\n\nAdd this line to your .env file:');
    console.log(`TELEGRAM_SESSION_STRING=${sessionString}`);
    
    console.log('\n✅ Done! You can now run the bot with: npm run dev\n');
    
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error('\nCommon issues:');
    console.error('- Make sure your API ID and Hash are correct');
    console.error('- Check your internet connection');
    console.error('- Ensure you enter the phone number with country code');
    console.error('- The verification code expires quickly, enter it promptly');
    process.exit(1);
  }
})();