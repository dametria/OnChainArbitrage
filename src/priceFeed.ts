/**
 * 💱 On-chain Price Feed
 *
 * Fetches approximate USD prices by quoting against a stablecoin (USDC/USDT)
 * via a Uniswap-V2-compatible router on the active chain.
 *
 * Falls back to a small static map only when the on-chain quote fails.
 */

import { ethers } from "ethers";
import { config, getTokenAddress, getQuoteStableSymbol, getNativeTokenSymbol } from "./config";
import { getDexRouter } from "./dexRouter";

const UNISWAP_V2_ROUTER_ABI = [
  "function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)",
];

// Minimal ERC20 decimals reader
const ERC20_ABI = ["function decimals() view returns (uint8)"];

// Short-lived in-memory cache (symbol -> { price, ts })
const cache = new Map<string, { price: number; ts: number }>();
const CACHE_TTL_MS = 30_000; // 30s

const STABLECOINS = new Set([
  "USDC",
  "USDT",
  "DAI",
  "BUSD",
  "USDbC",
  "FRAX",
  "MAI",
  "TUSD",
]);

/** Static fallback prices (used only when on-chain quote fails) */
const FALLBACK_USD: Record<string, number> = {
  WETH: 3200,
  ETH: 3200,
  WMATIC: 0.45,
  MATIC: 0.45,
  POL: 0.45,
  WBNB: 580,
  BNB: 580,
  WBTC: 65000,
  BTCB: 65000,
  BTC: 65000,
  LINK: 14,
  AAVE: 90,
  UNI: 8,
  CAKE: 2,
};

async function getDecimals(
  provider: ethers.Provider,
  token: string
): Promise<number> {
  try {
    const c = new ethers.Contract(token, ERC20_ABI, provider);
    return Number(await c.decimals());
  } catch {
    return 18;
  }
}

/**
 * Quote tokenIn -> stablecoin on a V2 router and return USD price of 1 tokenIn.
 */
async function quoteViaRouter(
  provider: ethers.Provider,
  tokenIn: string,
  stable: string,
  routerAddress: string
): Promise<number | null> {
  try {
    if (tokenIn.toLowerCase() === stable.toLowerCase()) return 1.0;

    const router = new ethers.Contract(
      routerAddress,
      UNISWAP_V2_ROUTER_ABI,
      provider
    );

    const decimalsIn = await getDecimals(provider, tokenIn);
    const amountIn = ethers.parseUnits("1", decimalsIn);

    const amounts: bigint[] = await router.getAmountsOut(amountIn, [
      tokenIn,
      stable,
    ]);

    const amountOut = amounts[amounts.length - 1];
    const decimalsStable = await getDecimals(provider, stable);
    const price = Number(ethers.formatUnits(amountOut, decimalsStable));

    if (!Number.isFinite(price) || price <= 0) return null;
    return price;
  } catch {
    return null;
  }
}

/**
 * Get USD price for a token symbol on the active chain.
 * Uses on-chain V2 quote against the chain's preferred stablecoin.
 */
export async function getTokenPriceUsd(
  provider: ethers.Provider,
  symbol: string
): Promise<number> {
  const upper = symbol.toUpperCase();

  // Stables are $1
  if (STABLECOINS.has(upper)) return 1.0;

  // Cache
  const cached = cache.get(upper);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.price;
  }

  let price: number | null = null;

  try {
    const tokenAddress = getTokenAddress(upper);
    const stableSymbol = getQuoteStableSymbol();
    const stableAddress = getTokenAddress(stableSymbol);

    // Prefer primary V2 router for the chain
    const routerCandidates = [
      (config.dexes as any)?.uniswapV2Router,
      (config.dexes as any)?.quickswap,
      (config.dexes as any)?.pancakeswap,
      (config.dexes as any)?.baseswap,
      (config.dexes as any)?.sushiswap,
    ].filter(Boolean) as string[];

    for (const router of routerCandidates) {
      price = await quoteViaRouter(
        provider,
        tokenAddress,
        stableAddress,
        router
      );
      if (price !== null) break;
    }
  } catch {
    // fall through to static
  }

  if (price === null || !Number.isFinite(price) || price <= 0) {
    price = FALLBACK_USD[upper] ?? 1.0;
  }

  cache.set(upper, { price, ts: Date.now() });
  return price;
}

/**
 * USD price of the chain's native gas token.
 */
export async function getNativeTokenPriceUsd(
  provider: ethers.Provider
): Promise<number> {
  return getTokenPriceUsd(provider, getNativeTokenSymbol());
}

/**
 * Convenience: price of token0 for an opportunity (used by trade sizing).
 */
export async function estimateTokenPriceUsd(
  provider: ethers.Provider,
  tokenSymbol: string
): Promise<number> {
  return getTokenPriceUsd(provider, tokenSymbol);
}
