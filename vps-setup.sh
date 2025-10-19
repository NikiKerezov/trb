#!/bin/bash

echo "🚀 Trading Bot VPS Setup Script"
echo "=============================="

# Update system
echo "📦 Updating system packages..."
apt update && apt upgrade -y

# Install Node.js 20
echo "📦 Installing Node.js 20..."
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

# Install essential packages
echo "📦 Installing build tools..."
apt install -y git build-essential

# Install PM2
echo "📦 Installing PM2..."
npm install -g pm2

# Create bot directory
echo "📁 Creating bot directory..."
mkdir -p ~/trading-bot
cd ~/trading-bot

echo "✅ Basic setup complete!"
echo ""
echo "Next steps:"
echo "1. Upload your bot files to ~/trading-bot"
echo "2. Create .env file with your credentials"
echo "3. Run: npm install"
echo "4. Test: npm run dev"
echo "5. Production: pm2 start npm --name trading-bot -- start"