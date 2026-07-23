/**
 * 📊 Price Monitor
 * 
 * This module fetches prices from different DEXes and detects arbitrage opportunities.
 * It simulates checking multiple DEXes by adding price variations.
 * 
 * In production, you would connect to actual DEX APIs or use libraries like:
 * - @uniswap/sdk
 * - @sushiswap/sdk
 * - Direct smart contract calls
 */

import { ethers } from "ethers";
import { config, getTokenAddress } from "./config";
import { logger } from "./logger";
import { getLogger } from "./dataLogger";
import { loadTradingPairs, watchPairsFile, type TradingPair as DynamicPair } from "./dynamicPairs";

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

export interface TokenPair {
  name: string;
  token0: string; // Symbol (e.g., "WETH")
  token1: string; // Symbol (e.g., "USDC")
  token0Address: string;
  token1Address: string;
  enabled: boolean;
}

export interface DexPrice {
  dexName: string;
  price: number; // Price of token0 in terms of token1
  liquidity: number; // Available liquidity in USD
  timestamp: number;
  feeTier?: number; // V3 fee tier (500, 3000, 10000) - optional for V2 DEXes
}

export interface ArbitrageOpportunity {
  pair: TokenPair;
  buyDex: DexPrice; // Where to buy (lower price)
  sellDex: DexPrice; // Where to sell (higher price)
  profitPercent: number; // Profit percentage
  profitUsd: number; // Estimated profit in USD
  estimatedGasCost: number; // Estimated gas cost in USD
  netProfit: number; // Profit - gas costs
  viable: boolean; // Is this opportunity profitable after costs?
}

// ============================================================================
// UNISWAP V2 ROUTER ABI (Minimal - just what we need)
// ============================================================================

const UNISWAP_V2_ROUTER_ABI = [
  "function getAmountsOut(uint amountIn, address[] memory path) public view returns (uint[] memory amounts)",
  "function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)",
  "function factory() external view returns (address)",
];

// ============================================================================
// FACTORY ABI (for getting pair address)
// ============================================================================

const UNISWAP_V2_FACTORY_ABI = [
  "function getPair(address tokenA, address tokenB) external view returns (address pair)",
];

// ============================================================================
// PAIR ABI (for getting reserves)
// ============================================================================

const UNISWAP_V2_PAIR_ABI = [
  "function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
  "function token0() external view returns (address)",
  "function token1() external view returns (address)",
];

// ============================================================================
// ERC20 ABI (Minimal)
// ============================================================================

const ERC20_ABI = [
  "function balanceOf(address account) external view returns (uint256)",
  "function decimals() external view returns (uint8)",
  "function symbol() external view returns (string)",
  "function approve(address spender, uint256 amount) external returns (bool)",
];

// ============================================================================
// UNISWAP V3 QUOTER ABI (For price quotes)
// ============================================================================

const UNISWAP_V3_QUOTER_ABI = [
  "function quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96) external returns (uint256 amountOut)",
];

// Uniswap V3 Quoter contract address on Polygon
const UNISWAP_V3_QUOTER_ADDRESS = "0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6";

// V3 Fee tiers (in hundredths of a bip, so 500 = 0.05%)
const V3_FEE_TIERS = [
  500,   // 0.05% - Stablecoins and very correlated pairs
  3000,  // 0.3%  - Most pairs (same as V2)
  10000, // 1%    - Exotic pairs
];

// ============================================================================
// RESERVE CACHE (Minimize RPC calls)
// ============================================================================

interface CachedReserve {
  reserve0: bigint;
  reserve1: bigint;
  token0: string;
  liquidity: number;
  timestamp: number;
}

// Cache TTL: 5 seconds (reserves don't change that often)
const CACHE_TTL_MS = 5000;
const reserveCache = new Map<string, CachedReserve>();

function getCacheKey(dexName: string, token0: string, token1: string): string {
  return `\( {dexName}: \){token0}:${token1}`.toLowerCase();
}

function getCachedReserve(cacheKey: string): CachedReserve | null {
  const cached = reserveCache.get(cacheKey);
  if (!cached) return null;
  
  const age = Date.now() - cached.timestamp;
  if (age > CACHE_TTL_MS) {
    reserveCache.delete(cacheKey);
    return null;
  }
  
  return cached;
}

function setCachedReserve(cacheKey: string, data: CachedReserve): void {
  reserveCache.set(cacheKey, { ...data, timestamp: Date.now() });
}

// Performance monitoring
let cacheHits = 0;
let cacheMisses = 0;
setInterval(() => {
  if (cacheHits + cacheMisses > 0) {
    const hitRate = ((cacheHits / (cacheHits + cacheMisses)) * 100).toFixed(1);
    logger.debug(`[CACHE] Hit rate: \( {hitRate}% ( \){cacheHits} hits, ${cacheMisses} misses)`);
    cacheHits = 0;
    cacheMisses = 0;
  }
}, 60000); // Log every minute

// ============================================================================
// USD PRICE HELPERS (Accurate liquidity calculation)
// ============================================================================

const STABLECOINS = new Set(
  [
    config.tokens.USDC?.toLowerCase(),
    config.tokens.USDT?.toLowerCase(),
    config.tokens.DAI?.toLowerCase(),
  ].filter(Boolean) as string[]
);

const APPROX_USD_PRICES: Record<string, number> = {
  // Stablecoins
  [config.tokens.USDC?.toLowerCase() || ""]: 1,
  [config.tokens.USDT?.toLowerCase() || ""]: 1,
  [config.tokens.DAI?.toLowerCase() || ""]: 1,

  // Major assets (update these periodically)
  [config.tokens.WETH?.toLowerCase() || ""]: 2400,
  [config.tokens.WBTC?.toLowerCase() || ""]: 65000,
  [config.tokens.WMATIC?.toLowerCase() || ""]: 0.40,
};

function getTokenUsdPrice(tokenAddress: string): number {
  return APPROX_USD_PRICES[tokenAddress.toLowerCase()] || 0;
}

function isStablecoin(tokenAddress: string): boolean {
  return STABLECOINS.has(tokenAddress.toLowerCase());
}

// ============================================================================
// UNISWAP V3 POOL ABI (For liquidity checking)
// ============================================================================

const UNISWAP_V3_POOL_ABI = [
  "function liquidity() external view returns (uint128)",
  "function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
  "function token0() external view returns (address)",
  "function token1() external view returns (address)",
];

// ============================================================================
// UNISWAP V3 FACTORY ABI (For getting pool address)
// ============================================================================

const UNISWAP_V3_FACTORY_ABI = [
  "function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool)",
];

// Uniswap V3 Factory on Polygon
const UNISWAP_V3_FACTORY_ADDRESS = "0x1F98431c8aD98523631AE4a59f267346ea31F984";

// ============================================================================
// PRICE MONITOR CLASS
// ============================================================================

export class PriceMonitor {
  private provider: ethers.JsonRpcProvider;
  private pairs: TokenPair[];
  private routerContract: ethers.Contract;
  private v3QuoterContract: ethers.Contract;
  private v3FactoryContract: ethers.Contract;

  constructor(provider: ethers.JsonRpcProvider) {
    this.provider = provider;
    this.pairs = this.initializePairs();
    this.routerContract = new ethers.Contract(
      config.dexes.uniswapV2Router,
      UNISWAP_V2_ROUTER_ABI,
      provider
    );
    
    // Initialize Uniswap V3 contracts
    this.v3QuoterContract = new ethers.Contract(
      UNISWAP_V3_QUOTER_ADDRESS,
      UNISWAP_V3_QUOTER_ABI,
      provider
    );
    
    this.v3FactoryContract = new ethers.Contract(
      UNISWAP_V3_FACTORY_ADDRESS,
      UNISWAP_V3_FACTORY_ABI,
      provider
    );
    
    logger.info("✅ Uniswap V3 Quoter initialized for better price discovery");
  }

  /**
   * Initialize trading pairs from dynamic JSON file (or fallback to config)
   */
  private initializePairs(): TokenPair[] {
    // Try to load from dynamic JSON first
    let pairs: any[];
    try {
      pairs = loadTradingPairs();
      logger.info(`[DYNAMIC] ✅ Loaded ${pairs.length} pairs from trading-pairs.json`);
    } catch (error) {
      logger.error('[DYNAMIC] Failed to load dynamic pairs, using static config');
      pairs = config.monitoring.watchedPairs.filter((pair) => pair.enabled);
    }

    return pairs.map((pair) => ({
      ...pair,
      token0Address: pair.token0Address || getTokenAddress(pair.token0),
      token1Address: pair.token1Address || getTokenAddress(pair.token1),
    }));
  }

  /**
   * Get real liquidity reserves from a DEX pair (V2)
   * Correctly converts both reserves to USD using real prices
   */
  private async getRealLiquidity(
    routerAddress: string,
    token0Address: string,
    token1Address: string,
    decimals0: number,
    decimals1: number
  ): Promise<number> {
    try {
      const cacheKey = getCacheKey(routerAddress, token0Address, token1Address);
      const cached = getCachedReserve(cacheKey);

      if (cached) {
        cacheHits++;
        return cached.liquidity;
      }

      cacheMisses++;

      // Get factory → pair → reserves
      const router = new ethers.Contract(routerAddress, UNISWAP_V2_ROUTER_ABI, this.provider);
      const factoryAddress = await router.factory();
      const factory = new ethers.Contract(factoryAddress, UNISWAP_V2_FACTORY_ABI, this.provider);
      const pairAddress = await factory.getPair(token0Address, token1Address);

      if (pairAddress === ethers.ZeroAddress) {
        return 0;
      }

      const pair = new ethers.Contract(pairAddress, UNISWAP_V2_PAIR_ABI, this.provider);
      const reserves = await pair.getReserves();
      const token0Pair = await pair.token0();

      let reserve0: bigint, reserve1: bigint;
      if (token0Pair.toLowerCase() === token0Address.toLowerCase()) {
        reserve0 = reserves.reserve0;
        reserve1 = reserves.reserve1;
      } else {
        reserve0 = reserves.reserve1;
        reserve1 = reserves.reserve0;
      }

      const reserve0Float = parseFloat(ethers.formatUnits(reserve0, decimals0));
      const reserve1Float = parseFloat(ethers.formatUnits(reserve1, decimals1));

      // ========== IMPROVED USD CALCULATION ==========
      let estimatedLiquidityUSD = 0;

      const price0 = getTokenUsdPrice(token0Address);
      const price1 = getTokenUsdPrice(token1Address);

      if (isStablecoin(token1Address)) {
        // token1 is stable → use 2 × reserve1 (standard approximation)
        estimatedLiquidityUSD = reserve1Float * 2;
      } else if (isStablecoin(token0Address)) {
        // token0 is stable
        estimatedLiquidityUSD = reserve0Float * 2;
      } else if (price0 > 0 && price1 > 0) {
        // Both sides have known prices → value both
        estimatedLiquidityUSD = (reserve0Float * price0) + (reserve1Float * price1);
      } else if (price1 > 0) {
        estimatedLiquidityUSD = reserve1Float * price1 * 2;
      } else if (price0 > 0) {
        estimatedLiquidityUSD = reserve0Float * price0 * 2;
      } else {
        // Last resort fallback
        estimatedLiquidityUSD = Math.max(reserve0Float, reserve1Float);
      }

      // Cache it
      setCachedReserve(cacheKey, {
        reserve0,
        reserve1,
        token0: token0Pair,
        liquidity: estimatedLiquidityUSD,
        timestamp: Date.now(),
      });

      logger.debug(
        `[LIQUIDITY V2] \( {token0Address.slice(0, 6)}.../ \){token1Address.slice(0, 6)}... → \[ {estimatedLiquidityUSD.toFixed(0)}`
      );

      return estimatedLiquidityUSD;
    } catch (error) {
      logger.debug(`Failed to get reserves: ${error}`);
      return 0;
    }
  }

  /**
   * Get liquidity from Uniswap V3 pool (Improved)
   */
  private async getV3Liquidity(
    token0Address: string,
    token1Address: string,
    feeTier: number,
    decimals0: number,
    decimals1: number
  ): Promise<number> {
    try {
      const cacheKey = getCacheKey(`v3_${feeTier}`, token0Address, token1Address);
      const cached = getCachedReserve(cacheKey);

      if (cached) {
        cacheHits++;
        return cached.liquidity;
      }

      cacheMisses++;

      // Get pool address for this fee tier
      const poolAddress = await this.v3FactoryContract.getPool(
        token0Address,
        token1Address,
        feeTier
      );

      if (poolAddress === ethers.ZeroAddress) {
        return 0;
      }

      const pool = new ethers.Contract(poolAddress, UNISWAP_V3_POOL_ABI, this.provider);
      const [liquidity, slot0] = await Promise.all([
        pool.liquidity(),
        pool.slot0()
      ]);

      if (liquidity <= 0n) {
        return 0;
      }

      // Calculate price from sqrtPriceX96
      const sqrtPriceX96 = slot0[0] as bigint;
      const sqrtPriceScaled = sqrtPriceX96 / (2n ** 48n);
      const sqrtPriceNum = Number(sqrtPriceScaled) / Number(2n ** 48n);
      const priceRatio = sqrtPriceNum * sqrtPriceNum;

      // Safe conversion of liquidity
      const liquidityStr = liquidity.toString();
      const liquidityNum = liquidityStr.length > 15 
        ? parseFloat(liquidityStr.slice(0, 15)) * Math.pow(10, liquidityStr.length - 15)
        : Number(liquidity);

      // ========== IMPROVED USD ESTIMATION ==========
      const price0 = getTokenUsdPrice(token0Address);
      const price1 = getTokenUsdPrice(token1Address);

      let estimatedLiquidityUSD = 0;

      // Prefer stablecoin side when possible
      if (isStablecoin(token1Address) && price1 > 0) {
        // Rough but effective: use a scaled version of L
        estimatedLiquidityUSD = (liquidityNum / 1e12) * Math.sqrt(priceRatio || 1);
      } else if (isStablecoin(token0Address) && price0 > 0) {
        estimatedLiquidityUSD = (liquidityNum / 1e12) * Math.sqrt(1 / (priceRatio || 1));
      } else if (price0 > 0 && price1 > 0) {
        // Both sides known – blend
        estimatedLiquidityUSD = (liquidityNum / 1e12) * ((price0 + price1) / 2);
      } else {
        // Fallback using known multipliers
        let usdMultiplier = 1;
        if (token1Address.toLowerCase() === config.tokens.WETH?.toLowerCase()) {
          usdMultiplier = 2400;
        } else if (token1Address.toLowerCase() === config.tokens.WBTC?.toLowerCase()) {
          usdMultiplier = 65000;
        } else if (token0Address.toLowerCase() === config.tokens.WETH?.toLowerCase()) {
          usdMultiplier = 2400;
        } else if (token0Address.toLowerCase() === config.tokens.WBTC?.toLowerCase()) {
          usdMultiplier = 65000;
        }

        estimatedLiquidityUSD = (liquidityNum / 1e12) * usdMultiplier;
      }

      // Sanity bounds
      if (estimatedLiquidityUSD < 500) {
        estimatedLiquidityUSD = 0; // Treat as no meaningful liquidity
      }
      if (estimatedLiquidityUSD > 500_000_000) {
        estimatedLiquidityUSD = 100_000_000; // Cap extreme outliers
      }

      logger.debug(
        `[LIQUIDITY V3] \( {poolAddress.slice(0, 8)}... fee= \){feeTier} → \]{estimatedLiquidityUSD.toFixed(0)}`
      );

      // Cache
      setCachedReserve(cacheKey, {
        reserve0: 0n,
        reserve1: liquidity,
        token0: token0Address,
        liquidity: estimatedLiquidityUSD,
        timestamp: Date.now()
      });

      return estimatedLiquidityUSD;
    } catch (error) {
      logger.debug(`[V3] Error getting liquidity: ${error}`);
      return 0;
    }
  }

  /**
   * Get price from Uniswap V3 using Quoter
   */
  private async getPriceFromV3(
    token0Address: string,
    token1Address: string,
    decimals0: number,
    decimals1: number
  ): Promise<{ price: number; liquidity: number; feeTier: number } | null> {
    try {
      const amountIn = ethers.parseUnits("1", decimals0);
      
      let bestPrice = 0;
      let bestLiquidity = 0;
      let bestFeeTier = 3000;
      
      for (const feeTier of V3_FEE_TIERS) {
        try {
          const amountOut = await this.v3QuoterContract.quoteExactInputSingle.staticCall(
            token0Address,
            token1Address,
            feeTier,
            amountIn,
            0
          );
          
          const price = parseFloat(ethers.formatUnits(amountOut, decimals1));
          
          const liquidity = await this.getV3Liquidity(
            token0Address,
            token1Address,
            feeTier,
            decimals0,
            decimals1
          );
          
          if (price > bestPrice && liquidity > 0) {
            bestPrice = price;
            bestLiquidity = liquidity;
            bestFeeTier = feeTier;
          }
          
          logger.debug(`[V3] Fee tier \( {feeTier / 10000}%: price= \){price.toFixed(6)}, liquidity=\[ {liquidity.toFixed(0)}`);
        } catch (error) {
          logger.debug(`[V3] No pool for fee tier ${feeTier / 10000}%`);
        }
      }
      
      if (bestPrice > 0) {
        logger.debug(`[V3] ✅ Best: \( {bestFeeTier / 10000}% tier with price= \){bestPrice.toFixed(6)}, liquidity= \]{bestLiquidity.toFixed(0)}`);
        return {
          price: bestPrice,
          liquidity: bestLiquidity,
          feeTier: bestFeeTier
        };
      }
      
      return null;
    } catch (error) {
      logger.debug(`[V3] Error getting price: ${error}`);
      return null;
    }
  }

  /**
   * Get price from a DEX using Uniswap V2 formula OR V3 Quoter
   */
  private async getPriceFromDex(
    dexName: string,
    routerAddress: string,
    token0Address: string,
    token1Address: string
  ): Promise<DexPrice> {
    try {
      // ===========================================================================
      // DETECT UNISWAP V3 AND USE QUOTER
      // ===========================================================================
      
      if (dexName.toLowerCase().includes("uniswap") || dexName.toLowerCase() === "uniswapv3") {
        logger.debug(`[V3] Detected Uniswap V3, using Quoter for ${dexName}`);
        
        const token0 = new ethers.Contract(token0Address, ERC20_ABI, this.provider);
        const token1 = new ethers.Contract(token1Address, ERC20_ABI, this.provider);
        
        let decimals0: number;
        let decimals1: number;
        
        try {
          decimals0 = await token0.decimals();
          decimals1 = await token1.decimals();
        } catch (e) {
          return {
            dexName,
            price: 0,
            liquidity: 0,
            timestamp: Date.now(),
          };
        }
        
        const v3Result = await this.getPriceFromV3(
          token0Address,
          token1Address,
          decimals0,
          decimals1
        );
        
        if (v3Result && v3Result.price > 0) {
          logger.debug(`[V3] ✅ \( {dexName}: price= \){v3Result.price.toFixed(6)}, fee=${v3Result.feeTier / 10000}%, liquidity=$${v3Result.liquidity.toFixed(0)}`);
          
          return {
            dexName: `${dexName}`,
            price: v3Result.price,
            liquidity: v3Result.liquidity,
            feeTier: v3Result.feeTier,
            timestamp: Date.now(),
          };
        } else {
          logger.debug(`[V3] No pools found for ${dexName}`);
          return {
            dexName,
            price: 0,
            liquidity: 0,
            timestamp: Date.now(),
          };
        }
      }
      
      // ===========================================================================
      // UNISWAP V2 LOGIC (QuickSwap, SushiSwap, etc.)
      // ===========================================================================
      
      const router = new ethers.Contract(
        routerAddress,
        UNISWAP_V2_ROUTER_ABI,
        this.provider
      );

      const token0 = new ethers.Contract(token0Address, ERC20_ABI, this.provider);
      const token1 = new ethers.Contract(token1Address, ERC20_ABI, this.provider);
      
      let decimals0: number;
      let decimals1: number;
      
      try {
        decimals0 = await token0.decimals();
      } catch (e) {
        return {
          dexName,
          price: 0,
          liquidity: 0,
          timestamp: Date.now(),
        };
      }
      
      try {
        decimals1 = await token1.decimals();
      } catch (e) {
        return {
          dexName,
          price: 0,
          liquidity: 0,
          timestamp: Date.now(),
        };
      }

      const amountIn = ethers.parseUnits("1", decimals0);
      const path = [token0Address, token1Address];

      const amounts = await router.getAmountsOut(amountIn, path);
      const amountOut = amounts[1];
      const price = parseFloat(ethers.formatUnits(amountOut, decimals1));

      // Validate price is reasonable
      if (price <= 0 || price > 1000) {
        return {
          dexName,
          price: 0,
          liquidity: 0,
          timestamp: Date.now(),
        };
      }

      if (price < 0.0001) {
        return {
          dexName,
          price: 0,
          liquidity: 0,
          timestamp: Date.now(),
        };
      }

      // ✅ GET REAL LIQUIDITY FROM RESERVES (now accurate)
      const realLiquidity = await this.getRealLiquidity(
        routerAddress,
        token0Address,
        token1Address,
        decimals0,
        decimals1
      );

      return {
        dexName,
        price: price,
        liquidity: realLiquidity,
        timestamp: Date.now(),
      };
    } catch (error) {
      return {
        dexName,
        price: 0,
        liquidity: 0,
        timestamp: Date.now(),
      };
    }
  }

  /**
   * Get prices from all DEXes for a token pair
   */
  async getPricesForPair(pair: TokenPair): Promise<DexPrice[]> {
    logger.debug(`Fetching prices for ${pair.name}...`);

    const prices = await Promise.all([
      this.getPriceFromDex(
        "quickswap",
        config.dexes.quickswap,
        pair.token0Address,
        pair.token1Address
      ),
      this.getPriceFromDex(
        "sushiswap",
        config.dexes.sushiswap,
        pair.token0Address,
        pair.token1Address
      ),
      this.getPriceFromDex(
        "uniswapv3",
        config.dexes.uniswapv3,
        pair.token0Address,
        pair.token1Address
      ),
    ]);

    return prices.filter((p) => p.price > 0);
  }

  /**
   * Find arbitrage opportunities by comparing prices
   */
  async findArbitrageOpportunity(
    pair: TokenPair
  ): Promise<ArbitrageOpportunity | null> {
    try {
      const prices = await this.getPricesForPair(pair);

      if (prices.length < 2) {
        logger.debug(`Not enough price data for ${pair.name}`);
        return null;
      }

      const buyPrice = prices.reduce((min, p) =>
        p.price < min.price ? p : min
      );
      const sellPrice = prices.reduce((max, p) =>
        p.price > max.price ? p : max
      );

      logger.priceCheck(pair.name, buyPrice.price, sellPrice.price);

      const profitPercent = ((sellPrice.price - buyPrice.price) / buyPrice.price) * 100;

      if (buyPrice.dexName === sellPrice.dexName || profitPercent <= 0) {
        return null;
      }

      // Reject unrealistic profit percentages
      const MAX_REALISTIC_PROFIT = 2.5; 
      
      if (profitPercent > MAX_REALISTIC_PROFIT) {
        logger.debug(
          `[FILTER] Rejecting ${pair.name}: ${profitPercent.toFixed(2)}% profit is unrealistic (likely fake pool)`
        );
        return null;
      }

      const tradeSize = 1000;
      const profitUsd = (tradeSize * profitPercent) / 100;

      const gasLimit = 300000n;
      const gasPrice = await this.provider.getFeeData();
      const gasCostWei = gasLimit * (gasPrice.gasPrice || 0n);
      const gasCostNative = parseFloat(ethers.formatEther(gasCostWei));
      
      const nativePriceUsd = config.network.name === 'polygon' ? 0.40 :
                             config.network.name === 'bsc' ? 600 :
                             config.network.name === 'base' ? 2000 :
                             2000;
      const estimatedGasCost = gasCostNative * nativePriceUsd;

      const netProfit = profitUsd - estimatedGasCost;

      const minProfitPercent = config.trading.minProfitBps / 100;
      const viable =
        profitPercent >= minProfitPercent &&
        netProfit > 0 &&
        gasPrice.gasPrice! <= ethers.parseUnits(config.trading.maxGasPrice.toString(), "gwei");

      const opportunity: ArbitrageOpportunity = {
        pair,
        buyDex: buyPrice,
        sellDex: sellPrice,
        profitPercent,
        profitUsd,
        estimatedGasCost,
        netProfit,
        viable,
      };

      if (viable) {
        const dataLogger = getLogger();
        const blockNumber = await this.provider.getBlockNumber();
        
        dataLogger.logOpportunity({
          pair: pair.name,
          token0: pair.token0,
          token1: pair.token1,
          dex1: buyPrice.dexName,
          dex2: sellPrice.dexName,
          price1: buyPrice.price.toFixed(6),
          price2: sellPrice.price.toFixed(6),
          spreadPercent: profitPercent,
          tradeAmount: tradeSize.toString(),
          tradeAmountUSD: tradeSize,
          expectedProfit: profitUsd.toFixed(6),
          expectedProfitUSD: profitUsd,
          profitPercent: profitPercent,
          gasPrice: gasPrice.gasPrice?.toString() || "0",
          gasCostUSD: estimatedGasCost,
          flashLoanFee: (tradeSize * 0.0005).toFixed(6),
          flashLoanFeeUSD: tradeSize * 0.0005,
          netProfit: netProfit.toFixed(6),
          netProfitUSD: netProfit,
          netProfitPercent: (netProfit / tradeSize) * 100,
          executed: false,
          executionStatus: "simulated",
          blockNumber: blockNumber,
          network: config.network?.name || "polygon",
        });
      }

      return opportunity;
    } catch (error) {
      logger.error(`Error finding arbitrage for ${pair.name}`, error);
      return null;
    }
  }

  /**
   * Scan all pairs for arbitrage opportunities
   */
  async scanForOpportunities(): Promise<ArbitrageOpportunity[]> {
    logger.debug("Scanning for arbitrage opportunities...");

    const opportunities = await Promise.all(
      this.pairs.map((pair) => this.findArbitrageOpportunity(pair))
    );

    return opportunities.filter(
      (opp): opp is ArbitrageOpportunity => opp !== null && opp.viable
    );
  }

  /**
   * Get all monitored pairs
   */
  getPairs(): TokenPair[] {
    return this.pairs;
  }

  /**
   * Add a new pair to monitor
   */
  addPair(pair: TokenPair): void {
    this.pairs.push(pair);
    logger.info(`Added new pair to monitor: ${pair.name}`);
  }

  /**
   * Remove a pair from monitoring
   */
  removePair(pairName: string): void {
    this.pairs = this.pairs.filter((p) => p.name !== pairName);
    logger.info(`Removed pair from monitoring: ${pairName}`);
  }
}

export default PriceMonitor;
