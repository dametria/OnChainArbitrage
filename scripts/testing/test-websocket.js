#!/usr/bin/env node

/**
 * WebSocket Price Monitor Test Script
 * 
 * Demonstrates the new event-driven WebSocket monitoring system.
 * This script subscribes to DEX pool Sync events and reports price changes in real-time.
 * 
 * Benefits over polling:
 * - 95%+ reduction in API calls (only queries when prices actually change)
 * - Faster response time (real-time events vs 1-second polling)
 * - Unlimited pairs (no API rate limit concerns)
 */

<<<<<<< Updated upstream
const { eventPriceMonitor } = require('../src/eventPriceMonitor');
const logger = require('../src/logger').default;
=======
const { EventPriceMonitor } = require('../src/eventPriceMonitor.ts');
const logger = require('../src/logger.ts').default;
>>>>>>> Stashed changes

async function main() {
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('         🌐 WEBSOCKET PRICE MONITOR TEST');
  console.log('═══════════════════════════════════════════════════════\n');

  console.log('📊 Event-driven monitoring (instead of polling)');
  console.log('✅ 95% less API calls');
  console.log('✅ Real-time price updates');
  console.log('✅ Auto-reconnection & failover\n');

  // Opportunity callback
  const opportunities = [];
  const handleOpportunity = (opp) => {
    opportunities.push(opp);
    
    console.log('\n🔔 NEW ARBITRAGE OPPORTUNITY 🔔');
    console.log('═══════════════════════════════════════════════════════');
    console.log(`Pair:       ${opp.pair}`);
    console.log(`Buy from:   ${opp.buyDex} @ ${opp.buyPrice.toFixed(8)}`);
    console.log(`Sell to:    ${opp.sellDex} @ ${opp.sellPrice.toFixed(8)}`);
    console.log(`Spread:     ${opp.spread.toFixed(2)}%`);
    console.log(`Timestamp:  ${new Date(opp.timestamp).toLocaleTimeString()}`);
    console.log('═══════════════════════════════════════════════════════\n');
  };

  try {
    // Initialize event-driven monitor
    console.log('🚀 Initializing WebSocket connections...\n');
    await eventPriceMonitor.initialize(handleOpportunity);

    // Display status
    const status = eventPriceMonitor.getStatus();
    console.log('\n✅ WebSocket monitoring active!\n');
    console.log('Status:');
    console.log(`  Pairs monitored: ${status.pairs}`);
    console.log(`  Pool subscriptions: ${status.subscriptions}`);
    console.log(`  Active WSS provider: ${status.wssStatus.activeProvider}`);
    console.log(`  Current prices: ${status.prices}\n`);

    console.log('🔍 Listening for Sync events from DEX pools...');
    console.log('📊 Price changes will be reported as they happen\n');
    console.log('Press Ctrl+C to stop\n');

    // Display prices every 30 seconds
    setInterval(() => {
      const prices = eventPriceMonitor.getPrices();
      if (prices.size > 0) {
        console.log(`\n📈 Current Prices (${new Date().toLocaleTimeString()}):`);
        console.log('─────────────────────────────────────────────────────');
        
        const pricesByPair = new Map();
        for (const [key, data] of prices.entries()) {
          const [dex, pair] = key.split('-');
          if (!pricesByPair.has(pair)) {
            pricesByPair.set(pair, []);
          }
          pricesByPair.get(pair).push({ dex, price: data.price });
        }

        for (const [pair, dexPrices] of pricesByPair.entries()) {
          console.log(`\n${pair}:`);
          for (const { dex, price } of dexPrices) {
            console.log(`  ${dex.padEnd(12)} ${price.toFixed(8)}`);
          }
          
          if (dexPrices.length >= 2) {
            const prices = dexPrices.map(d => d.price);
            const min = Math.min(...prices);
            const max = Math.max(...prices);
            const spread = ((max - min) / min * 100).toFixed(2);
            console.log(`  Spread: ${spread}%`);
          }
        }
        
        console.log('\n─────────────────────────────────────────────────────');
        console.log(`Total opportunities found: ${opportunities.length}`);
      }
    }, 30000);

    // Keep running
    await new Promise(() => {});

  } catch (error) {
    console.error('\n❌ Error:', error);
    process.exit(1);
  }
}

// Handle shutdown
process.on('SIGINT', async () => {
  console.log('\n\n🛑 Shutting down WebSocket monitor...');
  
  try {
    await eventPriceMonitor.stop();
    console.log('✅ Cleanup complete');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error during shutdown:', error);
    process.exit(1);
  }
});

// Run
main().catch(console.error);
