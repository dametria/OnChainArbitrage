/**
 * 🔀 DEX Router Manager
 *
 * Maps DEX names to their actual router addresses.
 * Chain-aware where possible via multichainConfig / config.network.
 */

import { config } from "./config";
import { getChainConfig } from "./multichainConfig";

// ============================================================================
// NATIVE TOKEN USD PRICE (rough, for gas cost estimates)
// ============================================================================

const NATIVE_TOKEN_USD: Record<number, number> = {
  137: 0.45,   // Polygon (MATIC/POL)
  56: 580,     // BSC (BNB)
  8453: 3200,  // Base (ETH)
  42161: 3200, // Arbitrum (ETH)
  10: 3200,    // Optimism (ETH)
  43114: 35,   // Avalanche (AVAX)
  42220: 0.7,  // Celo
};

function getNativeTokenUsdPrice(chainId?: number): number {
  const id = chainId ?? config.network.chainId;
  return NATIVE_TOKEN_USD[id] ?? 1.0; // safe conservative default
}

// ============================================================================
// DEX ROUTER MAPPING (legacy / Polygon-focused names still supported)
// ============================================================================

/**
 * Map DEX names to their router addresses.
 * Prefer values from the active chain config when available.
 */
// Safe access: config.dexes is a union of chain-specific shapes
const _dexes = (config.dexes ?? {}) as Record<string, string | undefined>;

export const DEX_ROUTERS: Record<string, string> = {
  // QuickSwap / Pancake / BaseSwap aliases
  QuickSwap: _dexes.quickswap ?? _dexes.pancakeswap ?? _dexes.baseswap ?? "",
  Quickswap: _dexes.quickswap ?? _dexes.pancakeswap ?? _dexes.baseswap ?? "",
  quickswap: _dexes.quickswap ?? _dexes.pancakeswap ?? _dexes.baseswap ?? "",

  // SushiSwap
  SushiSwap: _dexes.sushiswap ?? "",
  Sushiswap: _dexes.sushiswap ?? "",
  sushiswap: _dexes.sushiswap ?? "",
  SUSHI: _dexes.sushiswap ?? "",

  // Uniswap V3
  UniswapV3: _dexes.uniswapv3 ?? _dexes.uniswapV3 ?? "",
  Uniswapv3: _dexes.uniswapv3 ?? _dexes.uniswapV3 ?? "",
  uniswapv3: _dexes.uniswapv3 ?? _dexes.uniswapV3 ?? "",
  UNI: _dexes.uniswapv3 ?? _dexes.uniswapV3 ?? "",
  Uniswap: _dexes.uniswapv3 ?? _dexes.uniswapV3 ?? "",
  uniswap: _dexes.uniswapv3 ?? _dexes.uniswapV3 ?? "",

  // Dfyn
  Dfyn: _dexes.dfyn ?? "",
  dfyn: _dexes.dfyn ?? "",
  DFYN: _dexes.dfyn ?? "",

  // ApeSwap
  ApeSwap: _dexes.apeswap ?? "",
  Apeswap: _dexes.apeswap ?? "",
  apeswap: _dexes.apeswap ?? "",
  APE: _dexes.apeswap ?? "",

  // Balancer
  Balancer: _dexes.balancer ?? "",
  balancer: _dexes.balancer ?? "",
  BAL: _dexes.balancer ?? "",

  // BSC extras
  PancakeSwap: _dexes.pancakeswap ?? "",
  pancakeswap: _dexes.pancakeswap ?? "",
  BiSwap: _dexes.biswap ?? "",
  biswap: _dexes.biswap ?? "",
  BakerySwap: _dexes.bakeryswap ?? "",
  bakeryswap: _dexes.bakeryswap ?? "",
  MDEX: _dexes.mdex ?? "",
  mdex: _dexes.mdex ?? "",

  // Base extras
  BaseSwap: _dexes.baseswap ?? "",
  baseswap: _dexes.baseswap ?? "",
  SwapBased: _dexes.swapbased ?? "",
  swapbased: _dexes.swapbased ?? "",
  Aerodrome: _dexes.aerodrome ?? "",
  aerodrome: _dexes.aerodrome ?? "",
};

/**
 * Get router address for a DEX name.
 * Falls back to the first available router from the current chain config,
 * then to any hard-coded QuickSwap entry.
 */
export function getDexRouter(dexName: string): string {
  // 1. Try explicit mapping
  const mapped = DEX_ROUTERS[dexName];
  if (mapped) return mapped;

  // 2. Try current chain config (multichain)
  const chainConfig = getChainConfig(config.network.chainId);
  if (chainConfig?.dexes) {
    const key = dexName.toLowerCase();
    const entry = chainConfig.dexes[key];
    if (entry?.router) return entry.router;

    // fuzzy match by name
    for (const dex of Object.values(chainConfig.dexes)) {
      if (dex.name.toLowerCase() === key || dex.name.toLowerCase().includes(key)) {
        return dex.router;
      }
    }

    // last resort: first DEX on the chain
    const first = Object.values(chainConfig.dexes)[0];
    if (first?.router) {
      console.warn(
        `[WARNING] DEX "${dexName}" not found. Falling back to ${first.name} on chain ${config.network.chainId}`
      );
      return first.router;
    }
  }

  // 3. Legacy fallback
  console.warn(
    `[WARNING] DEX "${dexName}" not found in router mapping and no chain config available.`
  );
  return _dexes.quickswap ?? _dexes.pancakeswap ?? _dexes.baseswap ?? "0x0000000000000000000000000000000000000000";
}

/**
 * Check if a DEX uses Uniswap V2 compatible interface
 */
export function isUniswapV2Compatible(dexName: string): boolean {
  const v2Compatible = [
    "QuickSwap", "Quickswap", "quickswap",
    "SushiSwap", "Sushiswap", "sushiswap", "SUSHI",
    "Dfyn", "dfyn", "DFYN",
    "ApeSwap", "Apeswap", "apeswap", "APE",
    "PancakeSwap", "pancakeswap", "Pancake",
    "BaseSwap", "baseswap",
  ];
  return v2Compatible.includes(dexName);
}

/**
 * Get DEX type for specialized handling
 */
export function getDexType(
  dexName: string
): "uniswapV2" | "curve" | "balancer" | "uniswapV3" {
  const normalized = dexName.toLowerCase();

  if (normalized.includes("curve")) return "curve";
  if (normalized.includes("balancer")) return "balancer";
  if (normalized.includes("uniswap") && !normalized.includes("v2")) {
    return "uniswapV3";
  }
  return "uniswapV2";
}

/**
 * Estimate swap fee for a DEX (in basis points)
 */
export function getDexFee(dexName: string, v3FeeTier?: number): number {
  if (v3FeeTier !== undefined && dexName.toLowerCase().includes("uniswap")) {
    return v3FeeTier / 100; // 500 -> 5 bps, etc.
  }

  const chainConfig = getChainConfig(config.network.chainId);
  if (chainConfig?.dexes) {
    const dex = chainConfig.dexes[dexName.toLowerCase()];
    if (dex?.fee) return dex.fee;
  }

  const dexType = getDexType(dexName);
  switch (dexType) {
    case "uniswapV2":
      return 30;
    case "uniswapV3":
      return 5;
    case "curve":
      return 4;
    case "balancer":
      return 10;
    default:
      return 30;
  }
}

/**
 * Get estimated gas cost for a trade on this DEX (in USD)
 */
export function getEstimatedGasCost(dexName: string, gasPrice: bigint): number {
  const dexType = getDexType(dexName);

  let gasUnits: number;
  switch (dexType) {
    case "uniswapV2":
      gasUnits = 400000;
      break;
    case "uniswapV3":
      gasUnits = 600000;
      break;
    case "curve":
      gasUnits = 350000;
      break;
    case "balancer":
      gasUnits = 700000;
      break;
    default:
      gasUnits = 500000;
  }

  const totalGasUnits = BigInt(gasUnits + 100000); // + flash-loan overhead
  const gasCostWei = totalGasUnits * gasPrice;
  const gasCostNative = Number(gasCostWei) / 1e18;
  const nativePriceUsd = getNativeTokenUsdPrice();
  return gasCostNative * nativePriceUsd;
}

/**
 * Check if a DEX is acceptable for trading based on gas costs
 */
export function isDexAcceptable(
  dexName: string,
  currentGasPrice: bigint,
  maxGasCostUsd: number = 10.0
): { acceptable: boolean; reason?: string; estimatedCost?: number } {
  const estimatedGasCost = getEstimatedGasCost(dexName, currentGasPrice);

  if (estimatedGasCost > maxGasCostUsd) {
    return {
      acceptable: false,
      reason: `Gas cost ($${estimatedGasCost.toFixed(2)}) exceeds maximum ($${maxGasCostUsd})`,
      estimatedCost: estimatedGasCost,
    };
  }

  const dexType = getDexType(dexName);
  if (dexType === "balancer" && estimatedGasCost > maxGasCostUsd * 0.8) {
    return {
      acceptable: false,
      reason: `Balancer gas cost ($${estimatedGasCost.toFixed(2)}) too high for profitable arbitrage`,
      estimatedCost: estimatedGasCost,
    };
  }

  if (dexType === "uniswapV3" && estimatedGasCost > maxGasCostUsd * 0.7) {
    return {
      acceptable: false,
      reason: `Uniswap V3 gas cost ($${estimatedGasCost.toFixed(2)}) too high`,
      estimatedCost: estimatedGasCost,
    };
  }

  return {
    acceptable: true,
    estimatedCost: estimatedGasCost,
  };
}

/**
 * Recommended DEXes (chain-aware where possible)
 */
export function getRecommendedDexes(): string[] {
  const chainConfig = getChainConfig(config.network.chainId);
  if (chainConfig?.dexes) {
    return Object.values(chainConfig.dexes).map((d) => d.name);
  }
  // Legacy Polygon defaults
  return ["ApeSwap", "QuickSwap", "Sushiswap"];
}

/**
 * Check if a DEX pair is efficient for trading
 */
export function isDexPairEfficient(
  buyDexName: string,
  sellDexName: string,
  currentGasPrice: bigint
): { efficient: boolean; reason?: string; totalGasCost?: number } {
  const maxGasPerDex = 5.0;

  const buyDexCheck = isDexAcceptable(buyDexName, currentGasPrice, maxGasPerDex);
  if (!buyDexCheck.acceptable) {
    return {
      efficient: false,
      reason: `Buy DEX (${buyDexName}): ${buyDexCheck.reason}`,
      totalGasCost: buyDexCheck.estimatedCost || 0,
    };
  }

  const sellDexCheck = isDexAcceptable(sellDexName, currentGasPrice, maxGasPerDex);
  if (!sellDexCheck.acceptable) {
    return {
      efficient: false,
      reason: `Sell DEX (${sellDexName}): ${sellDexCheck.reason}`,
      totalGasCost: sellDexCheck.estimatedCost || 0,
    };
  }

  const totalGasCost =
    (buyDexCheck.estimatedCost || 0) + (sellDexCheck.estimatedCost || 0);

  if (totalGasCost > 10.0) {
    return {
      efficient: false,
      reason: `Total gas cost ($${totalGasCost.toFixed(2)}) exceeds $10 limit`,
      totalGasCost,
    };
  }

  return {
    efficient: true,
    totalGasCost,
  };
}
