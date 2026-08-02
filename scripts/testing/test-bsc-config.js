/**
 * 🧪 BSC Configuration Test (HTTP-based)
 * 
 * Tests BSC chain configuration and pool availability
 * Uses HTTP instead of WebSocket (more reliable for free BSC endpoints)
 */

const { ethers } = require('ethers');
require('dotenv').config();

// Override NETWORK environment variable to BSC
process.env.NETWORK = 'bsc';

const config = require('../src/config').config;

// Uniswap V2 Pair ABI
const PAIR_ABI = [
  'function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
  'function token0() external view returns (address)',
  'function token1() external view returns (address)',
];

// Uniswap V2 Factory ABI
const FACTORY_ABI = [
  'function getPair(address tokenA, address tokenB) external view returns (address pair)',
];

// BSC DEXes with factory addresses
const DEXES = [
  { 
    name: 'PancakeSwap', 
    router: config.dexesBSC.pancakeswap,
    factory: '0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73',
    volume: '$400M+',
  },
  { 
    name: 'ApeSwap', 
    router: config.dexesBSC.apeswap,
    factory: '0x0841BD0B734E4F5853f0dD8d7Ea041c241fb0Da6',
    volume: '$15M+',
  },
  { 
    name: 'BiSwap', 
    router: config.dexesBSC.biswap,
    factory: '0x858E3312ed3A876947EA49d572A7C42DE08af7EE',
    volume: '$10M+',
  },
  { 
    name: 'BakerySwap', 
    router: config.dexesBSC.bakeryswap,
    factory: '0x01bF7C66c6BD861915CdaaE475042d3c4BaE16A7',
    volume: '$5M+',
  },
  { 
    name: 'MDEX', 
    router: config.dexesBSC.mdex,
    factory: '0x3CD1C46068dAEa5Ebb0d3f55F6915B10648062B8',
    volume: '$3M+',
  },
];

// BSC Pairs from config
const PAIRS = config.monitoring.watchedPairsBSC;

async function testBSCConfiguration() {
  console.log('\n✅ BSC Configuration Test');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Setup HTTP provider
  const bscRpcUrl = config.network.rpcUrl;
  console.log(`📡 Connecting to BSC via HTTP: ${bscRpcUrl}\n`);

  try {
    const provider = new ethers.JsonRpcProvider(bscRpcUrl);

    // Test connection
    const network = await provider.getNetwork();
    const blockNumber = await provider.getBlockNumber();
    
    console.log('✅ Connected to BSC!\n');
    console.log(`📊 Network Information:`);
    console.log(`   Chain ID: ${network.chainId} (Expected: 56)`);
    console.log(`   Chain Name: ${network.name}`);
    console.log(`   Current Block: ${blockNumber}`);
    
    if (network.chainId !== 56n) {
      console.error(`\n❌ Wrong chain! Expected BSC (56), got ${network.chainId}`);
      process.exit(1);
    }
    
    console.log('\n✅ Confirmed BSC mainnet (Chain ID: 56)');

    // Test token addresses
    console.log('\n\n📋 BSC Token Configuration:');
    console.log('═══════════════════════════════════════════════════════════════\n');
    
    const tokenCount = Object.keys(config.tokensBSC).length;
    console.log(`Total tokens configured: ${tokenCount}\n`);
    
    let tokensDisplayed = 0;
    for (const [symbol, address] of Object.entries(config.tokensBSC)) {
      if (tokensDisplayed < 10) {
        console.log(`   ${symbol}: ${address}`);
        tokensDisplayed++;
      }
    }
    if (tokenCount > 10) {
      console.log(`   ... and ${tokenCount - 10} more tokens`);
    }

    // Test DEX configuration
    console.log('\n\n🏦 BSC DEX Configuration:');
    console.log('═══════════════════════════════════════════════════════════════\n');
    
    console.log(`Total DEXes configured: ${DEXES.length}\n`);
    
    for (const dex of DEXES) {
      console.log(`✅ ${dex.name}`);
      console.log(`   Router: ${dex.router}`);
      console.log(`   Factory: ${dex.factory}`);
      console.log(`   Daily Volume: ${dex.volume}\n`);
    }

    // Test trading pairs
    console.log('\n📊 BSC Trading Pairs:');
    console.log('═══════════════════════════════════════════════════════════════\n');
    
    const enabledPairs = PAIRS.filter(p => p.enabled);
    console.log(`Total pairs configured: ${PAIRS.length}`);
    console.log(`Enabled pairs: ${enabledPairs.length}\n`);
    
    console.log('Enabled Pairs:');
    enabledPairs.forEach((pair, i) => {
      console.log(`   ${i + 1}. ${pair.name}`);
    });

    // Test pool availability
    console.log('\n\n🔍 Testing Pool Availability (Sample):');
    console.log('═══════════════════════════════════════════════════════════════\n');

    const poolsFound = {};
    let totalChecked = 0;
    let totalFound = 0;

    // Test first 5 pairs across all DEXes
    const samplePairs = enabledPairs.slice(0, 5);
    
    for (const pair of samplePairs) {
      const token0Address = config.tokensBSC[pair.token0];
      const token1Address = config.tokensBSC[pair.token1];

      if (!token0Address || !token1Address) {
        console.warn(`⚠️  Skipping ${pair.name} - missing token addresses`);
        continue;
      }

      console.log(`\n📊 ${pair.name}:`);
      poolsFound[pair.name] = 0;

      for (const dex of DEXES) {
        try {
          const factory = new ethers.Contract(dex.factory, FACTORY_ABI, provider);
          const pairAddress = await factory.getPair(token0Address, token1Address);

          totalChecked++;

          if (pairAddress === ethers.ZeroAddress) {
            console.log(`   ❌ ${dex.name}: No pool`);
            continue;
          }

          // Verify pool has liquidity
          const pairContract = new ethers.Contract(pairAddress, PAIR_ABI, provider);
          const reserves = await pairContract.getReserves();

          if (reserves.reserve0 > 0n && reserves.reserve1 > 0n) {
            const reserve0Formatted = ethers.formatUnits(reserves.reserve0, 18);
            const reserve1Formatted = ethers.formatUnits(reserves.reserve1, 18);
            console.log(`   ✅ ${dex.name}: Found (Reserves: ${parseFloat(reserve0Formatted).toFixed(2)} / ${parseFloat(reserve1Formatted).toFixed(2)})`);
            poolsFound[pair.name]++;
            totalFound++;
          } else {
            console.log(`   ⚠️  ${dex.name}: Pool exists but no liquidity`);
          }
        } catch (error) {
          console.log(`   ❌ ${dex.name}: Error - ${error.message.slice(0, 50)}`);
        }
      }
    }

    // Summary
    console.log('\n\n📈 Summary:');
    console.log('═══════════════════════════════════════════════════════════════\n');
    console.log(`✅ Configuration Valid: BSC Chain ID 56`);
    console.log(`✅ DEXes Configured: ${DEXES.length} (PancakeSwap, ApeSwap, BiSwap, BakerySwap, MDEX)`);
    console.log(`✅ Tokens Configured: ${tokenCount}`);
    console.log(`✅ Trading Pairs: ${enabledPairs.length} enabled`);
    console.log(`\n📊 Sample Pool Test (${samplePairs.length} pairs × ${DEXES.length} DEXes):`);
    console.log(`   Pools Checked: ${totalChecked}`);
    console.log(`   Pools Found: ${totalFound}`);
    console.log(`   Coverage: ${((totalFound / totalChecked) * 100).toFixed(1)}%`);
    
    console.log('\n💡 Pool Distribution:');
    for (const [pairName, count] of Object.entries(poolsFound)) {
      console.log(`   ${pairName}: ${count}/${DEXES.length} DEXes`);
    }

    // Estimate total pools
    const estimatedTotal = Math.round((totalFound / totalChecked) * enabledPairs.length * DEXES.length);
    console.log(`\n🎯 Estimated Total Pools: ${estimatedTotal} (${enabledPairs.length} pairs × ${DEXES.length} DEXes × ${((totalFound / totalChecked) * 100).toFixed(0)}% coverage)`);
    console.log(`\n✅ BSC Configuration Test Complete!`);
    console.log('═══════════════════════════════════════════════════════════════\n');

  } catch (error) {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
  }
}

// Run test
testBSCConfiguration().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
