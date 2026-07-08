#!/usr/bin/env node

/**
 * 🎯 Dynamic Pair Selection (ESM Version)
 *
 * Automatically selects the best trading pairs based on:
 * - Real-time volume data from Polygon DEXs
 * - Excludes ultra-efficient top pairs
 * - Targets "sweet spot" pairs with volume but less MEV competition
 *
 * Usage: node scripts/discovery/select-dynamic-pairs.js
 */

import https from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// ESM equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const CONFIG = {
  // Exclude top N pairs (too efficient, dominated by MEV bots)
  EXCLUDE_TOP_N: 5,

  // Select next N pairs (sweet spot for arbitrage)
  SELECT_NEXT_N: 10,

  // Minimum daily volume (USD)
  MIN_VOLUME_USD: 500000, // $500k

  // Maximum daily volume (USD) - avoid ultra-high volume
  MAX_VOLUME_USD: 20000000, // $20M

  // Minimum liquidity (USD)
  MIN_LIQUIDITY_USD: 300000, // $300k

  // Polygon chain ID
  CHAIN_ID: 'polygon',
};

console.log('\n🎯 Dynamic Pair Selection for Arbitrage Bot');
console.log('═══════════════════════════════════════════\n');

/**
 * Fetch top pairs from DexScreener API
 */
async function fetchTopPairs() {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.dexscreener.com',
      path: '/latest/dex/search?q=polygon',
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'ArbitrageBot/1.0'
      }
    };

    console.log('📊 Fetching live data from DexScreener API...');

    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.pairs && json.pairs.length > 0) {
            // Filter only Polygon pairs
            const polygonPairs = json.pairs.filter(p => p.chainId === 'polygon');
            console.log(`✅ Fetched ${polygonPairs.length} pairs from Polygon\n`);
            resolve(polygonPairs);
          } else {
            reject(new Error('No pairs data in response'));
          }
        } catch (e) {
          console.error('Parse error:', e.message);
          console.error('Response:', data.substring(0, 200));
          reject(e);
        }
      });
    });

    req.on('error', (e) => {
      reject(e);
    });

    req.end();
  });
}

/**
 * Filter and rank pairs
 */
function filterPairs(pairs) {
  console.log('🔍 Filtering pairs...\n');

  // Filter by criteria
  const filtered = pairs.filter(pair => {
    // Must have both tokens
    if (!pair.baseToken || !pair.quoteToken) return false;

    // Must have volume and liquidity data
    if (!pair.volume || !pair.liquidity) return false;

    const volume24h = parseFloat(pair.volume.h24) || 0;
    const liquidityUsd = parseFloat(pair.liquidity.usd) || 0;

    // Apply filters
    if (volume24h < CONFIG.MIN_VOLUME_USD) return false;
    if (volume24h > CONFIG.MAX_VOLUME_USD) return false;
    if (liquidityUsd < CONFIG.MIN_LIQUIDITY_USD) return false;

    // Exclude stablecoin-only pairs (too tight spreads)
    const stablecoins = ['USDC', 'USDT', 'DAI', 'USDD', 'FRAX', 'TUSD', 'BUSD'];
    const baseIsStable = stablecoins.includes(pair.baseToken.symbol);
    const quoteIsStable = stablecoins.includes(pair.quoteToken.symbol);
    if (baseIsStable && quoteIsStable) return false;

    return true;
  });

  console.log(`  ✅ ${filtered.length} pairs match criteria`);

  // Sort by 24h volume (descending)
  const sorted = filtered.sort((a, b) => {
    const volA = parseFloat(a.volume.h24) || 0;
    const volB = parseFloat(b.volume.h24) || 0;
    return volB - volA;
  });

  // Skip top N (too efficient)
  const skipped = sorted.slice(CONFIG.EXCLUDE_TOP_N);
  console.log(`  ⏭️  Skipping top ${CONFIG.EXCLUDE_TOP_N} pairs (too efficient)`);

  // Take next N
  const selected = skipped.slice(0, CONFIG.SELECT_NEXT_N);
  console.log(`  🎯 Selected ${selected.length} pairs for arbitrage\n`);

  return selected;
}

/**
 * Format pair for display
 */
function formatPair(pair, index) {
  const base = pair.baseToken.symbol;
  const quote = pair.quoteToken.symbol;
  const volume = (parseFloat(pair.volume.h24) / 1000000).toFixed(2); // in millions
  const liquidity = (parseFloat(pair.liquidity.usd) / 1000000).toFixed(2);
  const dex = pair.dexId || 'unknown';

  return `  ${index + 1}. ${base}/${quote} | Vol: $${volume}M | Liq: $${liquidity}M | ${dex}`;
}

/**
 * Map token symbols to addresses
 */
function getTokenAddress(symbol, configContent) {
  const regex = new RegExp(`${symbol}:\\s*"(0x[a-fA-F0-9]{40})"`, 'i');
  const match = configContent.match(regex);
  return match ? match[1] : null;
}

/**
 * Update config file with selected pairs
 */
function updateConfig(selectedPairs) {
  console.log('📝 Updating config file...\n');

  const configPath = path.join(__dirname, '..', '..', 'src', 'config.ts');
  let config = fs.readFileSync(configPath, 'utf8');

  // Disable all current pairs
  config = config.replace(/enabled: true/g, 'enabled: false');

  let updatedCount = 0;
  let missingTokens = [];

  selectedPairs.forEach((pair, index) => {
    const base = pair.baseToken.symbol;
    const quote = pair.quoteToken.symbol;

    // Check if tokens exist in config
    const baseAddr = getTokenAddress(base, config);
    const quoteAddr = getTokenAddress(quote, config);

    if (!baseAddr) {
      missingTokens.push(base);
    }
    if (!quoteAddr) {
      missingTokens.push(quote);
    }

    // Try to enable the pair (both directions)
    const pair1 = `${base}/${quote}`;
    const pair2 = `${quote}/${base}`;

    let enabled = false;

    [pair1, pair2].forEach(pairName => {
      const regex = new RegExp(
        `(name: "${pairName.replace('/', '\\/')}"[\\s\\S]{0,250}?enabled: )false`,
        ''
      );

      if (regex.test(config)) {
        config = config.replace(regex, '$1true');
        console.log(`  ✅ Enabled: ${pairName}`);
        updatedCount++;
        enabled = true;
      }
    });

    if (!enabled && baseAddr && quoteAddr) {
      console.log(`  ⚠️  ${pair1} - Pair exists but not in config (can be added)`);
    } else if (!enabled) {
      console.log(`  ❌ ${pair1} - Missing token addresses`);
    }
  });

  fs.writeFileSync(configPath, config);

  console.log(`\n📊 Summary:`);
  console.log(`  ✅ Enabled: ${updatedCount} pairs`);

  if (missingTokens.length > 0) {
    const unique = [...new Set(missingTokens)];
    console.log(`  ⚠️  Missing tokens: ${unique.join(', ')}`);
    console.log(`\n💡 Tip: Add missing token addresses to config.tokens{}`);
  }

  console.log(`\n✅ Config updated successfully!`);
  console.log(`💰 Estimated API usage: ${updatedCount * 10}M compute units/day\n`);
}

/**
 * Display selected pairs
 */
function displayPairs(pairs) {
  console.log('🎯 Selected Pairs (Ranked by Volume):\n');
  pairs.forEach((pair, index) => {
    console.log(formatPair(pair, index));
  });
  console.log('');
}

/**
 * Main execution
 */
async function main() {
  try {
    // Fetch data
    const allPairs = await fetchTopPairs();

    // Filter and select
    const selectedPairs = filterPairs(allPairs);

    // Display results
    displayPairs(selectedPairs);

    // Update config
    updateConfig(selectedPairs);

    console.log('═══════════════════════════════════════════');
    console.log('✨ Next steps:');
    console.log('  1. Run: npm run build');
    console.log('  2. Run: npm run bot');
    console.log('  3. Monitor for arbitrage opportunities!');
    console.log('═══════════════════════════════════════════\n');

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error('\n💡 Fallback: Manually select pairs or try again later\n');
    process.exit(1);
  }
}

// ESM equivalent of require.main === module
const isMainModule = import.meta.url === `file://${process.argv[1]}` || 
                     process.argv[1]?.endsWith('select-dynamic-pairs.js');

if (isMainModule) {
  main();
}

export { fetchTopPairs, filterPairs, main };
