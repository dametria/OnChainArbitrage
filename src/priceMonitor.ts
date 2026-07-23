/**;
/**
 * 📊 Price Monitor
 *
 * Fetches prices from different DEXes and detects arbitrage opportunities.
 */

import { ethers } from "ethers";
import { config, getTokenAddress } from "./config";
import { logger } from "./logger";
import { getLogger } from "./dataLogger";
import { loadTradingPairs } from "./dynamicPairs";

// ============================================================================
// TYPES
// ============================================================================

export interface TokenPair {
  name: string;
  token0: string;
  token1: string;
  token0Address: string;
  token1Address: string;
  enabled: boolean;
}

export interface DexPrice {
  dexName: string;
  price: number;
  liquidity: number;
  timestamp: number;
  feeTier?: number;
}

export interface ArbitrageOpportunity {
  pair: TokenPair;
  buyDex: DexPrice;
  sellDex: DexPrice;
  profitPercent: number;
  profitUsd: number;
  estimatedGasCost: number;
  netProfit: number;
  viable: boolean;
}

// ============================================================================
// ABIs
// ============================================================================

const UNISWAP_V2_ROUTER_ABI = [
  "function getAmountsOut(uint amountIn, address[] memory path) public view returns (uint[] memory amounts)",
  "function factory() external view returns (address)",
];

const UNISWAP_V2_FACTORY_ABI = [
  "function getPair(address tokenA, address tokenB) external view returns (address pair)",
];

const UNISWAP_V2_PAIR_ABI = [
  "function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
  "function token0() external view returns (address)",
];

const ERC20_ABI = [
  "function decimals() external view returns (uint8)",
];

const UNISWAP_V3_QUOTER_ABI = [
  "function quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96) external returns (uint256 amountOut)",
];

const UNISWAP_V3_POOL_ABI = [
  "function liquidity() external view returns (uint128)",
  "function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
];

const UNISWAP_V3_FACTORY_ABI = [
  "function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool)",
];

// ============================================================================
// CONSTANTS
// ============================================================================

const UNISWAP_V3_QUOTER_ADDRESS = "0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6";
const UNISWAP_V3_FACTORY_ADDRESS = "0x1F98431c8aD98523631AE4a59f267346ea31F984";

const V3_FEE_TIERS = [500, 3000, 10000];

// ============================================================================
// CACHE
// ============================================================================

interface CachedReserve {
  reserve0: bigint;
  reserve1: bigint;
  token0: string;
  liquidity: number;
  timestamp: number;
}

const CACHE_TTL_MS = 5000;
const reserveCache = new Map<string, CachedReserve>();

function getCacheKey(dexName: string, token0: string, token1: string): string {
  return `\( {dexName}: \){token0}:${token1}`.toLowerCase();
}

function getCachedReserve(cacheKey: string): CachedReserve | null {
  const cached = reserveCache.get(cacheKey);
  if (!cached) return null;

  if (Date.now() - cached.timestamp > CACHE_TTL_MS) {
    reserveCache.delete(cacheKey);
    return null;
  }
  return cached;
}

function setCachedReserve(cacheKey: string, data: CachedReserve): void {
  reserveCache.set(cacheKey, { ...data, timestamp: Date.now() });
}

// ============================================================================
// USD PRICE HELPERS (the actual fix)
// ============================================================================

const STABLECOINS = new Set(
  [
    config.tokens.USDC?.toLowerCase(),
    config.tokens.USDT?.toLowerCase(),
    config.tokens.DAI?.toLowerCase(),
  ].filter(Boolean) as string[]
);

const APPROX_USD_PRICES: Record<string, number> = {
  [config.tokens.USDC?.toLowerCase() || ""]: 1,
  [config.tokens.USDT?.toLowerCase() || ""]: 1,
  [config.tokens.DAI?.toLowerCase() || ""]: 1,
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
// PRICE MONITOR
// ============================================================================

export class PriceMonitor {
  private provider: ethers.JsonRpcProvider;
  private pairs: TokenPair[];
  private v3QuoterContract: ethers.Contract;
  private v3FactoryContract: ethers.Contract;

  constructor(provider: ethers.JsonRpcProvider) {
    this.provider = provider;
    this.pairs = this.initializePairs();

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

    logger.info("✅ Uniswap V3 Quoter initialized");
  }

  private initializePairs(): TokenPair[] {
    let pairs: any[];
    try {
      pairs = loadTradingPairs();
      logger.info(`[DYNAMIC] Loaded ${pairs.length} pairs from trading-pairs.json`);
    } catch {
      logger.error("[DYNAMIC] Failed to load dynamic pairs, using static config");
      pairs = config.monitoring.watchedPairs.filter((p) => p.enabled);
    }

    return pairs.map((pair) => ({
      ...pair,
      token0Address: pair.token0Address || getTokenAddress(pair.token0),
      token1Address: pair.token1Address || getTokenAddress(pair.token1),
    }));
  }

  // ---------- V2 Liquidity (fixed) ----------
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
      if (cached) return cached.liquidity;

      const router = new ethers.Contract(routerAddress, UNISWAP_V2_ROUTER_ABI, this.provider);
      const factoryAddress = await router.factory();
      const factory = new ethers.Contract(factoryAddress, UNISWAP_V2_FACTORY_ABI, this.provider);
      const pairAddress = await factory.getPair(token0Address, token1Address);

      if (pairAddress === ethers.ZeroAddress) return 0;

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

      // ===== FIXED USD CALCULATION =====
      let estimatedLiquidityUSD = 0;
      const price0 = getTokenUsdPrice(token0Address);
      const price1 = getTokenUsdPrice(token1Address);

      if (isStablecoin(token1Address)) {
        estimatedLiquidityUSD = reserve1Float * 2;
      } else if (isStablecoin(token0Address)) {
        estimatedLiquidityUSD = reserve0Float * 2;
      } else if (price0 > 0 && price1 > 0) {
        estimatedLiquidityUSD = reserve0Float * price0 + reserve1Float * price1;
      } else if (price1 > 0) {
        estimatedLiquidityUSD = reserve1Float * price1 * 2;
      } else if (price0 > 0) {
        estimatedLiquidityUSD = reserve0Float * price0 * 2;
      } else {
        estimatedLiquidityUSD = Math.max(reserve0Float, reserve1Float);
      }

      setCachedReserve(cacheKey, {
        reserve0,
        reserve1,
        token0: token0Pair,
        liquidity: estimatedLiquidityUSD,
        timestamp: Date.now(),
      });

      return estimatedLiquidityUSD;
    } catch (error) {
      logger.debug(`Failed to get V2 reserves: ${error}`);
      return 0;
    }
  }

  // ---------- V3 Liquidity (fixed) ----------
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
      if (cached) return cached.liquidity;

      const poolAddress = await this.v3FactoryContract.getPool(
        token0Address,
        token1Address,
        feeTier
      );
      if (poolAddress === ethers.ZeroAddress) return 0;

      const pool = new ethers.Contract(poolAddress, UNISWAP_V3_POOL_ABI, this.provider);
      const [liquidity, slot0] = await Promise.all([pool.liquidity(), pool.slot0()]);

      if (liquidity <= 0n) return 0;

      const sqrtPriceX96 = slot0[0] as bigint;
      const sqrtPriceScaled = sqrtPriceX96 / 2n ** 48n;
      const sqrtPriceNum = Number(sqrtPriceScaled) / Number(2n ** 48n);
      const priceRatio = sqrtPriceNum * sqrtPriceNum;

      const liquidityStr = liquidity.toString();
      const liquidityNum =
        liquidityStr.length > 15
          ? parseFloat(liquidityStr.slice(0, 15)) * Math.pow(10, liquidityStr.length - 15)
          : Number(liquidity);

      // ===== IMPROVED USD ESTIMATION =====
      let estimatedLiquidityUSD = 0;
      const price0 = getTokenUsdPrice(token0Address);
      const price1 = getTokenUsdPrice(token1Address);

      if (isStablecoin(token1Address)) {
        estimatedLiquidityUSD = (liquidityNum / 1e12) * Math.sqrt(priceRatio || 1);
      } else if (isStablecoin(token0Address)) {
        estimatedLiquidityUSD = (liquidityNum / 1e12) * Math.sqrt(1 / (priceRatio || 1));
      } else if (price0 > 0 && price1 > 0) {
        estimatedLiquidityUSD = (liquidityNum / 1e12) * ((price0 + price1) / 2);
      } else {
        let usdMultiplier = 1;
        const t0 = token0Address.toLowerCase();
        const t1 = token1Address.toLowerCase();
        if (t1 === config.tokens.WETH?.toLowerCase() || t0 === config.tokens.WETH?.toLowerCase()) {
          usdMultiplier = 2400;
        } else if (t1 === config.tokens.WBTC?.toLowerCase() || t0 === config.tokens.WBTC?.toLowerCase()) {
          usdMultiplier = 65000;
        }
        estimatedLiquidityUSD = (liquidityNum / 1e12) * usdMultiplier;
      }

      // Sanity
      if (estimatedLiquidityUSD < 500) estimatedLiquidityUSD = 0;
      if (estimatedLiquidityUSD > 500_000_000) estimatedLiquidityUSD = 100_000_000;

      setCachedReserve(cacheKey, {
        reserve0: 0n,
        reserve1: liquidity,
        token0: token0Address,
        liquidity: estimatedLiquidityUSD,
        timestamp: Date.now(),
      });

      return estimatedLiquidityUSD;
    } catch (error) {
      logger.debug(`[V3] Error getting liquidity: ${error}`);
      return 0;
    }
  }

  // ---------- V3 Price ----------
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
        } catch {
          // pool does not exist for this fee tier
        }
      }

      if (bestPrice > 0) {
        return { price: bestPrice, liquidity: bestLiquidity, feeTier: bestFeeTier };
      }
      return null;
    } catch {
      return null;
    }
  }

  // ---------- Main price fetcher ----------
  private async getPriceFromDex(
    dexName: string,
    routerAddress: string,
    token0Address: string,
    token1Address: string
  ): Promise<DexPrice> {
    try {
      // ----- Uniswap V3 -----
      if (dexName.toLowerCase().includes("uniswap") || dexName.toLowerCase() === "uniswapv3") {
        const token0 = new ethers.Contract(token0Address, ERC20_ABI, this.provider);
        const token1 = new ethers.Contract(token1Address, ERC20_ABI, this.provider);

        let decimals0: number, decimals1: number;
        try {
          decimals0 = await token0.decimals();
          decimals1 = await token1.decimals();
        } catch {
          return { dexName, price: 0, liquidity: 0, timestamp: Date.now() };
        }

        const v3Result = await this.getPriceFromV3(token0Address, token1Address, decimals0, decimals1);

        if (v3Result && v3Result.price > 0) {
          return {
            dexName,
            price: v3Result.price,
            liquidity: v3Result.liquidity,
            feeTier: v3Result.feeTier,
            timestamp: Date.now(),
          };
        }
        return { dexName, price: 0, liquidity: 0, timestamp: Date.now() };
      }

      // ----- V2 (QuickSwap / SushiSwap) -----
      const router = new ethers.Contract(routerAddress, UNISWAP_V2_ROUTER_ABI, this.provider);
      const token0 = new ethers.Contract(token0Address, ERC20_ABI, this.provider);
      const token1 = new ethers.Contract(token1Address, ERC20_ABI, this.provider);

      let decimals0: number, decimals1: number;
      try {
        decimals0 = await token0.decimals();
        decimals1 = await token1.decimals();
      } catch {
        return { dexName, price: 0, liquidity: 0, timestamp: Date.now() };
      }

      const amountIn = ethers.parseUnits("1", decimals0);
      const amounts = await router.getAmountsOut(amountIn, [token0Address, token1Address]);
      const price = parseFloat(ethers.formatUnits(amounts[1], decimals1));

      if (price <= 0 || price > 1000 || price < 0.0001) {
        return { dexName, price: 0, liquidity: 0, timestamp: Date.now() };
      }

      const realLiquidity = await this.getRealLiquidity(
        routerAddress,
        token0Address,
        token1Address,
        decimals0,
        decimals1
      );

      return {
        dexName,
        price,
        liquidity: realLiquidity,
        timestamp: Date.now(),
      };
    } catch {
      return { dexName, price: 0, liquidity: 0, timestamp: Date.now() };
    }
  }

  async getPricesForPair(pair: TokenPair): Promise<DexPrice[]> {
    const prices = await Promise.all([
      this.getPriceFromDex("quickswap", config.dexes.quickswap, pair.token0Address, pair.token1Address),
      this.getPriceFromDex("sushiswap", config.dexes.sushiswap, pair.token0Address, pair.token1Address),
      this.getPriceFromDex("uniswapv3", config.dexes.uniswapv3, pair.token0Address, pair.token1Address),
    ]);
    return prices.filter((p) => p.price > 0);
  }

  async findArbitrageOpportunity(pair: TokenPair): Promise<ArbitrageOpportunity | null> {
    try {
      const prices = await this.getPricesForPair(pair);
      if (prices.length < 2) return null;

      const buyPrice = prices.reduce((min, p) => (p.price < min.price ? p : min));
      const sellPrice = prices.reduce((max, p) => (p.price > max.price ? p : max));

      logger.priceCheck(pair.name, buyPrice.price, sellPrice.price);

      const profitPercent = ((sellPrice.price - buyPrice.price) / buyPrice.price) * 100;

      if (buyPrice.dexName === sellPrice.dexName || profitPercent <= 0) return null;

      // Reject unrealistic spreads
      if (profitPercent > 2.5) {
        logger.debug(`[FILTER] Rejecting ${pair.name}: ${profitPercent.toFixed(2)}% is unrealistic`);
        return null;
      }

      const tradeSize = 1000;
      const profitUsd = (tradeSize * profitPercent) / 100;

      const gasLimit = 300000n;
      const feeData = await this.provider.getFeeData();
      const gasCostWei = gasLimit * (feeData.gasPrice || 0n);
      const gasCostNative = parseFloat(ethers.formatEther(gasCostWei));
      const nativePriceUsd = config.network.name === "polygon" ? 0.4 : 2000;
      const estimatedGasCost = gasCostNative * nativePriceUsd;

      const netProfit = profitUsd - estimatedGasCost;
      const minProfitPercent = config.trading.minProfitBps / 100;

      const viable =
        profitPercent >= minProfitPercent &&
        netProfit > 0 &&
        (feeData.gasPrice || 0n) <= ethers.parseUnits(config.trading.maxGasPrice.toString(), "gwei");

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
          profitPercent,
          gasPrice: feeData.gasPrice?.toString() || "0",
          gasCostUSD: estimatedGasCost,
          flashLoanFee: (tradeSize * 0.0005).toFixed(6),
          flashLoanFeeUSD: tradeSize * 0.0005,
          netProfit: netProfit.toFixed(6),
          netProfitUSD: netProfit,
          netProfitPercent: (netProfit / tradeSize) * 100,
          executed: false,
          executionStatus: "simulated",
          blockNumber,
          network: config.network?.name || "polygon",
        });
      }

      return opportunity;
    } catch (error) {
      logger.error(`Error finding arbitrage for ${pair.name}`, error);
      return null;
    }
  }

  async scanForOpportunities(): Promise<ArbitrageOpportunity[]> {
    const results = await Promise.all(this.pairs.map((p) => this.findArbitrageOpportunity(p)));
    return results.filter((o): o is ArbitrageOpportunity => o !== null && o.viable);
  }

  getPairs(): TokenPair[] {
    return this.pairs;
  }

  addPair(pair: TokenPair): void {
    this.pairs.push(pair);
    logger.info(`Added pair: ${pair.name}`);
  }

  removePair(pairName: string): void {
    this.pairs = this.pairs.filter((p) => p.name !== pairName);
    logger.info(`Removed pair: ${pairName}`);
  }
}

export default PriceMonitor;/**
 * 📊 Price Monitor
 *
 * Fetches prices from different DEXes and detects arbitrage opportunities.
 */

import { ethers } from "ethers";
import { config, getTokenAddress } from "./config";
import { logger } from "./logger";
import { getLogger } from "./dataLogger";
import { loadTradingPairs } from "./dynamicPairs";

// ============================================================================
// TYPES
// ============================================================================

export interface TokenPair {
  name: string;
  token0: string;
  token1: string;
  token0Address: string;
  token1Address: string;
  enabled: boolean;
}

export interface DexPrice {
  dexName: string;
  price: number;
  liquidity: number;
  timestamp: number;
  feeTier?: number;
}

export interface ArbitrageOpportunity {
  pair: TokenPair;
  buyDex: DexPrice;
  sellDex: DexPrice;
  profitPercent: number;
  profitUsd: number;
  estimatedGasCost: number;
  netProfit: number;
  viable: boolean;
}

// ============================================================================
// ABIs
// ============================================================================

const UNISWAP_V2_ROUTER_ABI = [
  "function getAmountsOut(uint amountIn, address[] memory path) public view returns (uint[] memory amounts)",
  "function factory() external view returns (address)",
];

const UNISWAP_V2_FACTORY_ABI = [
  "function getPair(address tokenA, address tokenB) external view returns (address pair)",
];

const UNISWAP_V2_PAIR_ABI = [
  "function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
  "function token0() external view returns (address)",
];

const ERC20_ABI = [
  "function decimals() external view returns (uint8)",
];

const UNISWAP_V3_QUOTER_ABI = [
  "function quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96) external returns (uint256 amountOut)",
];

const UNISWAP_V3_POOL_ABI = [
  "function liquidity() external view returns (uint128)",
  "function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
];

const UNISWAP_V3_FACTORY_ABI = [
  "function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool)",
];

// ============================================================================
// CONSTANTS
// ============================================================================

const UNISWAP_V3_QUOTER_ADDRESS = "0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6";
const UNISWAP_V3_FACTORY_ADDRESS = "0x1F98431c8aD98523631AE4a59f267346ea31F984";

const V3_FEE_TIERS = [500, 3000, 10000];

// ============================================================================
// CACHE
// ============================================================================

interface CachedReserve {
  reserve0: bigint;
  reserve1: bigint;
  token0: string;
  liquidity: number;
  timestamp: number;
}

const CACHE_TTL_MS = 5000;
const reserveCache = new Map<string, CachedReserve>();

function getCacheKey(dexName: string, token0: string, token1: string): string {
  return `\( {dexName}: \){token0}:${token1}`.toLowerCase();
}

function getCachedReserve(cacheKey: string): CachedReserve | null {
  const cached = reserveCache.get(cacheKey);
  if (!cached) return null;

  if (Date.now() - cached.timestamp > CACHE_TTL_MS) {
    reserveCache.delete(cacheKey);
    return null;
  }
  return cached;
}

function setCachedReserve(cacheKey: string, data: CachedReserve): void {
  reserveCache.set(cacheKey, { ...data, timestamp: Date.now() });
}

// ============================================================================
// USD PRICE HELPERS (the actual fix)
// ============================================================================

const STABLECOINS = new Set(
  [
    config.tokens.USDC?.toLowerCase(),
    config.tokens.USDT?.toLowerCase(),
    config.tokens.DAI?.toLowerCase(),
  ].filter(Boolean) as string[]
);

const APPROX_USD_PRICES: Record<string, number> = {
  [config.tokens.USDC?.toLowerCase() || ""]: 1,
  [config.tokens.USDT?.toLowerCase() || ""]: 1,
  [config.tokens.DAI?.toLowerCase() || ""]: 1,
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
// PRICE MONITOR
// ============================================================================

export class PriceMonitor {
  private provider: ethers.JsonRpcProvider;
  private pairs: TokenPair[];
  private v3QuoterContract: ethers.Contract;
  private v3FactoryContract: ethers.Contract;

  constructor(provider: ethers.JsonRpcProvider) {
    this.provider = provider;
    this.pairs = this.initializePairs();

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

    logger.info("✅ Uniswap V3 Quoter initialized");
  }

  private initializePairs(): TokenPair[] {
    let pairs: any[];
    try {
      pairs = loadTradingPairs();
      logger.info(`[DYNAMIC] Loaded ${pairs.length} pairs from trading-pairs.json`);
    } catch {
      logger.error("[DYNAMIC] Failed to load dynamic pairs, using static config");
      pairs = config.monitoring.watchedPairs.filter((p) => p.enabled);
    }

    return pairs.map((pair) => ({
      ...pair,
      token0Address: pair.token0Address || getTokenAddress(pair.token0),
      token1Address: pair.token1Address || getTokenAddress(pair.token1),
    }));
  }

  // ---------- V2 Liquidity (fixed) ----------
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
      if (cached) return cached.liquidity;

      const router = new ethers.Contract(routerAddress, UNISWAP_V2_ROUTER_ABI, this.provider);
      const factoryAddress = await router.factory();
      const factory = new ethers.Contract(factoryAddress, UNISWAP_V2_FACTORY_ABI, this.provider);
      const pairAddress = await factory.getPair(token0Address, token1Address);

      if (pairAddress === ethers.ZeroAddress) return 0;

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

      // ===== FIXED USD CALCULATION =====
      let estimatedLiquidityUSD = 0;
      const price0 = getTokenUsdPrice(token0Address);
      const price1 = getTokenUsdPrice(token1Address);

      if (isStablecoin(token1Address)) {
        estimatedLiquidityUSD = reserve1Float * 2;
      } else if (isStablecoin(token0Address)) {
        estimatedLiquidityUSD = reserve0Float * 2;
      } else if (price0 > 0 && price1 > 0) {
        estimatedLiquidityUSD = reserve0Float * price0 + reserve1Float * price1;
      } else if (price1 > 0) {
        estimatedLiquidityUSD = reserve1Float * price1 * 2;
      } else if (price0 > 0) {
        estimatedLiquidityUSD = reserve0Float * price0 * 2;
      } else {
        estimatedLiquidityUSD = Math.max(reserve0Float, reserve1Float);
      }

      setCachedReserve(cacheKey, {
        reserve0,
        reserve1,
        token0: token0Pair,
        liquidity: estimatedLiquidityUSD,
        timestamp: Date.now(),
      });

      return estimatedLiquidityUSD;
    } catch (error) {
      logger.debug(`Failed to get V2 reserves: ${error}`);
      return 0;
    }
  }

  // ---------- V3 Liquidity (fixed) ----------
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
      if (cached) return cached.liquidity;

      const poolAddress = await this.v3FactoryContract.getPool(
        token0Address,
        token1Address,
        feeTier
      );
      if (poolAddress === ethers.ZeroAddress) return 0;

      const pool = new ethers.Contract(poolAddress, UNISWAP_V3_POOL_ABI, this.provider);
      const [liquidity, slot0] = await Promise.all([pool.liquidity(), pool.slot0()]);

      if (liquidity <= 0n) return 0;

      const sqrtPriceX96 = slot0[0] as bigint;
      const sqrtPriceScaled = sqrtPriceX96 / 2n ** 48n;
      const sqrtPriceNum = Number(sqrtPriceScaled) / Number(2n ** 48n);
      const priceRatio = sqrtPriceNum * sqrtPriceNum;

      const liquidityStr = liquidity.toString();
      const liquidityNum =
        liquidityStr.length > 15
          ? parseFloat(liquidityStr.slice(0, 15)) * Math.pow(10, liquidityStr.length - 15)
          : Number(liquidity);

      // ===== IMPROVED USD ESTIMATION =====
      let estimatedLiquidityUSD = 0;
      const price0 = getTokenUsdPrice(token0Address);
      const price1 = getTokenUsdPrice(token1Address);

      if (isStablecoin(token1Address)) {
        estimatedLiquidityUSD = (liquidityNum / 1e12) * Math.sqrt(priceRatio || 1);
      } else if (isStablecoin(token0Address)) {
        estimatedLiquidityUSD = (liquidityNum / 1e12) * Math.sqrt(1 / (priceRatio || 1));
      } else if (price0 > 0 && price1 > 0) {
        estimatedLiquidityUSD = (liquidityNum / 1e12) * ((price0 + price1) / 2);
      } else {
        let usdMultiplier = 1;
        const t0 = token0Address.toLowerCase();
        const t1 = token1Address.toLowerCase();
        if (t1 === config.tokens.WETH?.toLowerCase() || t0 === config.tokens.WETH?.toLowerCase()) {
          usdMultiplier = 2400;
        } else if (t1 === config.tokens.WBTC?.toLowerCase() || t0 === config.tokens.WBTC?.toLowerCase()) {
          usdMultiplier = 65000;
        }
        estimatedLiquidityUSD = (liquidityNum / 1e12) * usdMultiplier;
      }

      // Sanity
      if (estimatedLiquidityUSD < 500) estimatedLiquidityUSD = 0;
      if (estimatedLiquidityUSD > 500_000_000) estimatedLiquidityUSD = 100_000_000;

      setCachedReserve(cacheKey, {
        reserve0: 0n,
        reserve1: liquidity,
        token0: token0Address,
        liquidity: estimatedLiquidityUSD,
        timestamp: Date.now(),
      });

      return estimatedLiquidityUSD;
    } catch (error) {
      logger.debug(`[V3] Error getting liquidity: ${error}`);
      return 0;
    }
  }

  // ---------- V3 Price ----------
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
        } catch {
          // pool does not exist for this fee tier
        }
      }

      if (bestPrice > 0) {
        return { price: bestPrice, liquidity: bestLiquidity, feeTier: bestFeeTier };
      }
      return null;
    } catch {
      return null;
    }
  }

  // ---------- Main price fetcher ----------
  private async getPriceFromDex(
    dexName: string,
    routerAddress: string,
    token0Address: string,
    token1Address: string
  ): Promise<DexPrice> {
    try {
      // ----- Uniswap V3 -----
      if (dexName.toLowerCase().includes("uniswap") || dexName.toLowerCase() === "uniswapv3") {
        const token0 = new ethers.Contract(token0Address, ERC20_ABI, this.provider);
        const token1 = new ethers.Contract(token1Address, ERC20_ABI, this.provider);

        let decimals0: number, decimals1: number;
        try {
          decimals0 = await token0.decimals();
          decimals1 = await token1.decimals();
        } catch {
          return { dexName, price: 0, liquidity: 0, timestamp: Date.now() };
        }

        const v3Result = await this.getPriceFromV3(token0Address, token1Address, decimals0, decimals1);

        if (v3Result && v3Result.price > 0) {
          return {
            dexName,
            price: v3Result.price,
            liquidity: v3Result.liquidity,
            feeTier: v3Result.feeTier,
            timestamp: Date.now(),
          };
        }
        return { dexName, price: 0, liquidity: 0, timestamp: Date.now() };
      }

      // ----- V2 (QuickSwap / SushiSwap) -----
      const router = new ethers.Contract(routerAddress, UNISWAP_V2_ROUTER_ABI, this.provider);
      const token0 = new ethers.Contract(token0Address, ERC20_ABI, this.provider);
      const token1 = new ethers.Contract(token1Address, ERC20_ABI, this.provider);

      let decimals0: number, decimals1: number;
      try {
        decimals0 = await token0.decimals();
        decimals1 = await token1.decimals();
      } catch {
        return { dexName, price: 0, liquidity: 0, timestamp: Date.now() };
      }

      const amountIn = ethers.parseUnits("1", decimals0);
      const amounts = await router.getAmountsOut(amountIn, [token0Address, token1Address]);
      const price = parseFloat(ethers.formatUnits(amounts[1], decimals1));

      if (price <= 0 || price > 1000 || price < 0.0001) {
        return { dexName, price: 0, liquidity: 0, timestamp: Date.now() };
      }

      const realLiquidity = await this.getRealLiquidity(
        routerAddress,
        token0Address,
        token1Address,
        decimals0,
        decimals1
      );

      return {
        dexName,
        price,
        liquidity: realLiquidity,
        timestamp: Date.now(),
      };
    } catch {
      return { dexName, price: 0, liquidity: 0, timestamp: Date.now() };
    }
  }

  async getPricesForPair(pair: TokenPair): Promise<DexPrice[]> {
    const prices = await Promise.all([
      this.getPriceFromDex("quickswap", config.dexes.quickswap, pair.token0Address, pair.token1Address),
      this.getPriceFromDex("sushiswap", config.dexes.sushiswap, pair.token0Address, pair.token1Address),
      this.getPriceFromDex("uniswapv3", config.dexes.uniswapv3, pair.token0Address, pair.token1Address),
    ]);
    return prices.filter((p) => p.price > 0);
  }

  async findArbitrageOpportunity(pair: TokenPair): Promise<ArbitrageOpportunity | null> {
    try {
      const prices = await this.getPricesForPair(pair);
      if (prices.length < 2) return null;

      const buyPrice = prices.reduce((min, p) => (p.price < min.price ? p : min));
      const sellPrice = prices.reduce((max, p) => (p.price > max.price ? p : max));

      logger.priceCheck(pair.name, buyPrice.price, sellPrice.price);

      const profitPercent = ((sellPrice.price - buyPrice.price) / buyPrice.price) * 100;

      if (buyPrice.dexName === sellPrice.dexName || profitPercent <= 0) return null;

      // Reject unrealistic spreads
      if (profitPercent > 2.5) {
        logger.debug(`[FILTER] Rejecting ${pair.name}: ${profitPercent.toFixed(2)}% is unrealistic`);
        return null;
      }

      const tradeSize = 1000;
      const profitUsd = (tradeSize * profitPercent) / 100;

      const gasLimit = 300000n;
      const feeData = await this.provider.getFeeData();
      const gasCostWei = gasLimit * (feeData.gasPrice || 0n);
      const gasCostNative = parseFloat(ethers.formatEther(gasCostWei));
      const nativePriceUsd = config.network.name === "polygon" ? 0.4 : 2000;
      const estimatedGasCost = gasCostNative * nativePriceUsd;

      const netProfit = profitUsd - estimatedGasCost;
      const minProfitPercent = config.trading.minProfitBps / 100;

      const viable =
        profitPercent >= minProfitPercent &&
        netProfit > 0 &&
        (feeData.gasPrice || 0n) <= ethers.parseUnits(config.trading.maxGasPrice.toString(), "gwei");

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
          profitPercent,
          gasPrice: feeData.gasPrice?.toString() || "0",
          gasCostUSD: estimatedGasCost,
          flashLoanFee: (tradeSize * 0.0005).toFixed(6),
          flashLoanFeeUSD: tradeSize * 0.0005,
          netProfit: netProfit.toFixed(6),
          netProfitUSD: netProfit,
          netProfitPercent: (netProfit / tradeSize) * 100,
          executed: false,
          executionStatus: "simulated",
          blockNumber,
          network: config.network?.name || "polygon",
        });
      }

      return opportunity;
    } catch (error) {
      logger.error(`Error finding arbitrage for ${pair.name}`, error);
      return null;
    }
  }

  async scanForOpportunities(): Promise<ArbitrageOpportunity[]> {
    const results = await Promise.all(this.pairs.map((p) => this.findArbitrageOpportunity(p)));
    return results.filter((o): o is ArbitrageOpportunity => o !== null && o.viable);
  }

  getPairs(): TokenPair[] {
    return this.pairs;
  }

  addPair(pair: TokenPair): void {
    this.pairs.push(pair);
    logger.info(`Added pair: ${pair.name}`);
  }

  removePair(pairName: string): void {
    this.pairs = this.pairs.filter((p) => p.name !== pairName);
    logger.info(`Removed pair: ${pairName}`);
  }
}

export default PriceMonitor;
