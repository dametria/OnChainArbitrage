/**
 * 🔄 Dynamic Trading Pairs Loader
 * 
 * Loads trading pairs from external JSON file instead of hardcoded config
 * Allows dynamic updates without rebuilding the bot
 */

import * as fs from 'fs';
import * as path from 'path';
import { config } from './config';

export interface TradingPair {
  name: string;
  token0: string;
  token1: string;
  enabled: boolean;
  token0Address?: string;
  token1Address?: string;
  verifiedSpread?: number;
  reason?: string;
}

export interface TradingPairsConfig {
  lastUpdated: string;
  updateFrequency: string;
  source: string;
  criteria: {
    excludeTop15: boolean;
    maxSpread: number;
    minLiquidity: number;
    verifiedDEXes: string[];
  };
  pairs: TradingPair[];
  excludedPairs: Array<{
    name: string;
    reason: string;
  }>;
}

const PAIRS_FILE_PATH = path.join(__dirname, '..', 'data', 'pairs', 'trading-pairs.json');

/**
 * Load trading pairs from JSON file
 */
/** Resolve network name from either legacy config.network or ChainConfig */
function getNetworkName(): string {
  const cfg = config as any;
  return (cfg.network?.name || cfg.name || process.env.NETWORK || "polygon").toLowerCase();
}

function getTokensForNetwork(network: string): Record<string, string> {
  const cfg = config as any;
  if (network === "bsc") return cfg.tokensBSC || cfg.tokens || {};
  if (network === "base") return cfg.tokensBase || cfg.tokens || {};
  return cfg.tokens || {};
}

function getWatchedPairs(network: string): any[] {
  const mon = (config as any).monitoring || {};
  if (network === "bsc") return mon.watchedPairsBSC || mon.watchedPairs || [];
  if (network === "base") return mon.watchedPairsBase || mon.watchedPairs || [];
  return mon.watchedPairs || [];
}

export function loadTradingPairs(): TradingPair[] {
  try {
    // Check if file exists
    if (!fs.existsSync(PAIRS_FILE_PATH)) {
      console.warn(`[DYNAMIC PAIRS] File not found: ${PAIRS_FILE_PATH}`);
      console.warn('[DYNAMIC PAIRS] Falling back to static config pairs');
      
      const network = getNetworkName();
      const tokens = getTokensForNetwork(network);
      const pairs = getWatchedPairs(network);
      
      const fallbackPairs = pairs.map((pair: any) => ({
        ...pair,
        token0Address: tokens[pair.token0],
        token1Address: tokens[pair.token1],
      })).filter((p: any) => p.enabled && p.token0Address && p.token1Address) as TradingPair[];
      
      console.log(`[DYNAMIC PAIRS] Fallback enabled pairs (${network}): ${fallbackPairs.length}`);
      return fallbackPairs;
    }

    // Read and parse JSON
    const fileContent = fs.readFileSync(PAIRS_FILE_PATH, 'utf8');
    const pairsConfig: TradingPairsConfig = JSON.parse(fileContent);

    console.log(`[DYNAMIC PAIRS] ✅ Loaded from: ${PAIRS_FILE_PATH}`);
    console.log(`[DYNAMIC PAIRS] Last updated: ${pairsConfig.lastUpdated}`);
    console.log(`[DYNAMIC PAIRS] Update frequency: ${pairsConfig.updateFrequency}`);
    console.log(`[DYNAMIC PAIRS] Source: ${pairsConfig.source}`);

    const network = getNetworkName();
    const tokens = getTokensForNetwork(network);
    
    const enhancedPairs = pairsConfig.pairs.map(pair => ({
      ...pair,
      token0Address: tokens[pair.token0],
      token1Address: tokens[pair.token1],
    }));

    // Filter only enabled pairs
    const enabledPairs = enhancedPairs.filter(p => p.enabled);
    
    console.log(`[DYNAMIC PAIRS] Total pairs: ${pairsConfig.pairs.length}`);
    console.log(`[DYNAMIC PAIRS] Enabled pairs: ${enabledPairs.length}`);
    console.log(`[DYNAMIC PAIRS] Excluded pairs: ${pairsConfig.excludedPairs.length}`);
    
    // Validate that all pairs have token addresses
    const missingAddresses = enabledPairs.filter(
      p => !p.token0Address || !p.token1Address
    );
    
    if (missingAddresses.length > 0) {
      console.error('[DYNAMIC PAIRS] ⚠️ Missing token addresses for:');
      missingAddresses.forEach(p => {
        console.error(`  - ${p.name}: ${p.token0} = ${p.token0Address}, ${p.token1} = ${p.token1Address}`);
      });
    }

    return enabledPairs.filter(p => p.token0Address && p.token1Address);

  } catch (error: any) {
    console.error('[DYNAMIC PAIRS] ❌ Error loading pairs file:', error.message);
    console.error('[DYNAMIC PAIRS] Falling back to static config pairs');
    
    const network = getNetworkName();
    const tokens = getTokensForNetwork(network);
    const pairs = getWatchedPairs(network);
    
    const fallbackPairs = pairs.map((pair: any) => ({
      ...pair,
      token0Address: tokens[pair.token0],
      token1Address: tokens[pair.token1],
    })).filter((p: any) => p.enabled && p.token0Address && p.token1Address) as TradingPair[];
    
    console.log(`[DYNAMIC PAIRS] Fallback enabled pairs (${network}): ${fallbackPairs.length}`);
    return fallbackPairs;
  }
}

/**
 * Reload trading pairs (useful for hot-reloading without restart)
 */
export function reloadTradingPairs(): TradingPair[] {
  console.log('[DYNAMIC PAIRS] 🔄 Reloading trading pairs...');
  return loadTradingPairs();
}

/**
 * Get last update time
 */
export function getLastUpdateTime(): string | null {
  try {
    if (!fs.existsSync(PAIRS_FILE_PATH)) return null;
    
    const fileContent = fs.readFileSync(PAIRS_FILE_PATH, 'utf8');
    const pairsConfig: TradingPairsConfig = JSON.parse(fileContent);
    
    return pairsConfig.lastUpdated;
  } catch {
    return null;
  }
}

/**
 * Check if pairs file needs update (older than 24 hours)
 */
export function needsUpdate(): boolean {
  const lastUpdate = getLastUpdateTime();
  if (!lastUpdate) return true;
  
  const lastUpdateDate = new Date(lastUpdate);
  const now = new Date();
  const hoursSinceUpdate = (now.getTime() - lastUpdateDate.getTime()) / (1000 * 60 * 60);
  
  return hoursSinceUpdate >= 24;
}

/**
 * Watch pairs file for changes and auto-reload
 */
export function watchPairsFile(callback: (pairs: TradingPair[]) => void): void {
  console.log('[DYNAMIC PAIRS] 👀 Watching pairs file for changes...');
  
  fs.watch(PAIRS_FILE_PATH, (eventType) => {
    if (eventType === 'change') {
      console.log('[DYNAMIC PAIRS] 📝 File changed, reloading...');
      const pairs = reloadTradingPairs();
      callback(pairs);
    }
  });
}

export default {
  loadTradingPairs,
  reloadTradingPairs,
  getLastUpdateTime,
  needsUpdate,
  watchPairsFile,
};
