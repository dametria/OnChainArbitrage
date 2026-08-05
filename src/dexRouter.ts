/* eslint-disable @typescript-eslint/no-var-requires */
import { config } from "./config";
import { getChainConfig } from "./multichainConfig";

/**
 * 🔀 DEX Router Manager (updated to prefer runtime config)
 *
 * This file now prefers values from the runtime `config` (selected chain)
 * rather than reading directly from the global MULTICHAIN_CONFIG.
 */

// Safe access: config.dexes is typed as a Record<string, any>
const _dexes = (config.dexes ?? {}) as Record<string, any>;

export const DEX_ROUTERS: Record<string, string> = {
  QuickSwap: _dexes.quickswap?.router ?? _dexes.pancakeswap?.router ?? _dexes.baseswap?.router ?? "",
  Quickswap: _dexes.quickswap?.router ?? _dexes.pancakeswap?.router ?? _dexes.baseswap?.router ?? "",
  quickswap: _dexes.quickswap?.router ?? _dexes.pancakeswap?.router ?? _dexes.baseswap?.router ?? "",

  SushiSwap: _dexes.sushiswap?.router ?? "",
  Sushiswap: _dexes.sushiswap?.router ?? "",
  sushiswap: _dexes.sushiswap?.router ?? "",
  SUSHI: _dexes.sushiswap?.router ?? "",

  UniswapV3: _dexes.uniswapv3?.router ?? _dexes.uniswapV3?.router ?? "",
  Uniswapv3: _dexes.uniswapv3?.router ?? _dexes.uniswapV3?.router ?? "",
  uniswapv3: _dexes.uniswapv3?.router ?? _dexes.uniswapV3?.router ?? "",
  UNI: _dexes.uniswapv3?.router ?? _dexes.uniswapV3?.router ?? "",
  Uniswap: _dexes.uniswapv3?.router ?? _dexes.uniswapV3?.router ?? "",
  uniswap: _dexes.uniswapv3?.router ?? _dexes.uniswapV3?.router ?? "",

  Dfyn: _dexes.dfyn?.router ?? "",
  dfyn: _dexes.dfyn?.router ?? "",
  DFYN: _dexes.dfyn?.router ?? "",

  ApeSwap: _dexes.apeswap?.router ?? "",
  Apeswap: _dexes.apeswap?.router ?? "",
  apeswap: _dexes.apeswap?.router ?? "",
  APE: _dexes.apeswap?.router ?? "",

  Balancer: _dexes.balancer?.router ?? "",
  balancer: _dexes.balancer?.router ?? "",
  BAL: _dexes.balancer?.router ?? "",

  PancakeSwap: _dexes.pancakeswap?.router ?? "",
  pancakeswap: _dexes.pancakeswap?.router ?? "",
  BiSwap: _dexes.biswap?.router ?? "",
  biswap: _dexes.biswap?.router ?? "",
  BakerySwap: _dexes.bakeryswap?.router ?? "",
  bakeryswap: _dexes.bakeryswap?.router ?? "",
  MDEX: _dexes.mdex?.router ?? "",
  mdex: _dexes.mdex?.router ?? "",

  BaseSwap: _dexes.baseswap?.router ?? "",
  baseswap: _dexes.baseswap?.router ?? "",
  SwapBased: _dexes.swapbased?.router ?? "",
  swapbased: _dexes.swapbased?.router ?? "",
  Aerodrome: _dexes.aerodrome?.router ?? "",
  aerodrome: _dexes.aerodrome?.router ?? "",
};

export function getDexRouter(dexName: string): string {
  const mapped = DEX_ROUTERS[dexName];
  if (mapped) return mapped;

  const key = dexName.toLowerCase();
  const dexEntry = (_dexes ?? {})[key];
  if (dexEntry && dexEntry.router) return dexEntry.router;

  // fallback: try multichainConfig for more exhaustive search
  const chainConfig = getChainConfig(config.network.chainId);
  if (chainConfig?.dexes) {
    const entry = chainConfig.dexes[key];
    if (entry?.router) return entry.router;
    for (const dex of Object.values(chainConfig.dexes)) {
      if (dex.name.toLowerCase() === key || dex.name.toLowerCase().includes(key)) {
        return dex.router;
      }
    }
    const first = Object.values(chainConfig.dexes)[0];
    if (first?.router) return first.router;
  }

  console.warn(`[DEX] Router for "${dexName}" not found; returning empty address`);
  return "0x0000000000000000000000000000000000000000";
}

export function getDexFee(dexName: string, v3FeeTier?: number): number {
  if (v3FeeTier !== undefined && dexName.toLowerCase().includes("uniswap")) {
    return v3FeeTier / 100;
  }

  const key = dexName.toLowerCase();
  const dexEntry = (_dexes ?? {})[key];
  if (dexEntry && dexEntry.fee) return dexEntry.fee;

  const chainConfig = getChainConfig(config.network.chainId);
  if (chainConfig?.dexes && chainConfig.dexes[key]?.fee) {
    return chainConfig.dexes[key].fee;
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
