/**
 * Standalone JavaScript session generator (no TypeScript compilation)
 */

const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const readline = require('readline');
require('dotenv').config();

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(query) {
  return new Promise(resolve => rl.question(query, resolve));
}

async function generateSession() {
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

  console.log('✅ API credentials found');
  console.log(`API ID: ${apiId}`);
  console.log(`API Hash: ${apiHash.substring(0, 8)}...${apiHash.substring(apiHash.length - 4)}\n`);

  const stringSession = new StringSession('');

  console.log('🔄 Connecting to Telegram...\n');

  const client = new TelegramClient(stringSession, apiId, apiHash, {
    connectionRetries: 5,
  });

  await client.start({
    phoneNumber: async () => await question('📞 Enter your phone number (with country code, e.g., +1234567890): '),
    password: async () => await question('🔐 Enter your 2FA password (press Enter if not enabled): '),
    phoneCode: async () => await question('💬 Enter the verification code sent to your phone: '),
    onError: (err) => console.log(err),
  });

  console.log('\n✅ Successfully authenticated!');
  console.log('\n🎉 Your session string:');
  console.log('\n' + client.session.save());
  console.log('\n📋 Add this to your .env file:');
  console.log(`\nTELEGRAM_SESSION_STRING=${client.session.save()}`);
  console.log('\n⚠️  Keep this string secure!');
  
  rl.close();
  process.exit(0);
}

generateSession().catch(error => {
  console.error('Error:', error);
  rl.close();
  process.exit(1);
});