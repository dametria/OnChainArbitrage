/**
 * 🔄 Dynamic Trading Pairs Loader
 *
 * Loads trading pairs from external JSON file instead of hardcoded config.
 * Falls back to the static watchedPairs from the correct chain config
 * (polyConfig / bscConfig / baseConfig).
 */

import * as fs from "fs";
import * as path from "path";
import { polyConfig } from "./config/polyConfig";
import { bscConfig } from "./config/bscConfig";
import { baseConfig } from "./config/baseConfig";

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

const PAIRS_FILE_PATH = path.join("..", "data", "pairs", "trading-pairs.json");

type SupportedChain = "polygon" | "bsc" | "base";

/**
 * Select the correct chain config based on NETWORK env var
 */
function getChainConfig() {
  const network = (process.env.NETWORK || "polygon") as SupportedChain;

  switch (network) {
    case "bsc":
      return { network: "bsc" as const, config: bscConfig };
    case "base":
      return { network: "base" as const, config: baseConfig };
    case "polygon":
    default:
      return { network: "polygon" as const, config: polyConfig };
  }
}

/**
 * Build fallback pairs from the correct chain-specific config
 * (polyConfig.tokens + polyConfig.monitoring.watchedPairs, etc.)
 */
function getFallbackPairs(): TradingPair[] {
  const { network, config: chainConfig } = getChainConfig();

  const tokens = chainConfig.tokens as Record<string, string>;
  const pairs = chainConfig.monitoring?.watchedPairs || [];

  const fallbackPairs = pairs
    .map((pair) => ({
      ...pair,
      token0Address: tokens[pair.token0],
      token1Address: tokens[pair.token1],
    }))
    .filter(
      (p) => p.enabled && p.token0Address && p.token1Address
    ) as TradingPair[];

  console.log(
    `[DYNAMIC PAIRS] Fallback enabled pairs (${network}): ${fallbackPairs.length}`
  );

  return fallbackPairs;
}

/**
 * Load trading pairs from JSON file
 */
export function loadTradingPairs(): TradingPair[] {
  try {
    if (!fs.existsSync(PAIRS_FILE_PATH)) {
      console.warn(`[DYNAMIC PAIRS] File not found: ${PAIRS_FILE_PATH}`);
      console.warn("[DYNAMIC PAIRS] Falling back to static config pairs");
      return getFallbackPairs();
    }

    // Read and parse JSON
    const fileContent = fs.readFileSync(PAIRS_FILE_PATH, "utf8");
    const pairsConfig: TradingPairsConfig = JSON.parse(fileContent);

    console.log(`[DYNAMIC PAIRS] ✅ Loaded from: ${PAIRS_FILE_PATH}`);
    console.log(`[DYNAMIC PAIRS] Last updated: ${pairsConfig.lastUpdated}`);
    console.log(
      `[DYNAMIC PAIRS] Update frequency: ${pairsConfig.updateFrequency}`
    );
    console.log(`[DYNAMIC PAIRS] Source: ${pairsConfig.source}`);

    // Map token symbols → addresses using the correct chain config
    const { network, config: chainConfig } = getChainConfig();
    const tokens = chainConfig.tokens as Record<string, string>;

    const enhancedPairs = pairsConfig.pairs.map((pair) => ({
      ...pair,
      token0Address: tokens[pair.token0],
      token1Address: tokens[pair.token1],
    }));

    // Keep only enabled pairs that have both addresses
    const enabledPairs = enhancedPairs.filter(
      (p) => p.enabled && p.token0Address && p.token1Address
    );

    console.log(`[DYNAMIC PAIRS] Total pairs: ${pairsConfig.pairs.length}`);
    console.log(`[DYNAMIC PAIRS] Enabled pairs: ${enabledPairs.length}`);
    console.log(
      `[DYNAMIC PAIRS] Excluded pairs: ${pairsConfig.excludedPairs.length}`
    );
    console.log(`[DYNAMIC PAIRS] Using token map from: ${network}`);

    // Warn about any missing addresses
    const missingAddresses = enhancedPairs.filter(
      (p) => p.enabled && (!p.token0Address || !p.token1Address)
    );

    if (missingAddresses.length > 0) {
      console.error("[DYNAMIC PAIRS] ⚠️ Missing token addresses for:");
      missingAddresses.forEach((p) => {
        console.error(
          `  - ${p.name}: ${p.token0} = ${p.token0Address}, ${p.token1} = ${p.token1Address}`
        );
      });
    }

    return enabledPairs;
  } catch (error: any) {
    console.error(
      "[DYNAMIC PAIRS] ❌ Error loading pairs file:",
      error.message
    );
    console.error("[DYNAMIC PAIRS] Falling back to static config pairs");
    return getFallbackPairs();
  }
}

/**
 * Reload trading pairs (useful for hot-reloading without restart)
 */
export function reloadTradingPairs(): TradingPair[] {
  console.log("[DYNAMIC PAIRS] 🔄 Reloading trading pairs...");
  return loadTradingPairs();
}

/**
 * Get last update time
 */
export function getLastUpdateTime(): string | null {
  try {
    if (!fs.existsSync(PAIRS_FILE_PATH)) return null;

    const fileContent = fs.readFileSync(PAIRS_FILE_PATH, "utf8");
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
  const hoursSinceUpdate =
    (now.getTime() - lastUpdateDate.getTime()) / (1000 * 60 * 60);

  return hoursSinceUpdate >= 24;
}

/**
 * Watch pairs file for changes and auto-reload
 */
export function watchPairsFile(
  callback: (pairs: TradingPair[]) => void
): void {
  console.log("[DYNAMIC PAIRS] 👀 Watching pairs file for changes...");

  fs.watch(PAIRS_FILE_PATH, (eventType) => {
    if (eventType === "change") {
      console.log("[DYNAMIC PAIRS] 📝 File changed, reloading...");
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
