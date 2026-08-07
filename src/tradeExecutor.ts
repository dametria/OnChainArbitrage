/**
 * ⚡ Trade Executor
 *
 * This module executes arbitrage trades by calling your FlashLoanArbitrage contract.
 * It handles transaction building, gas estimation, and error handling.
 *
 * Balance checks go through the injected provider.
 * When that provider is a CachedProvider, eth_getBalance is called
 * ONLY at bot init + bot stop – never during the trading loop.
 */

import { getFeeData } from "./gas";
import { ethers } from "ethers";
import { config } from "./config";
import { logger } from "./logger";
import { ArbitrageOpportunity } from "./priceMonitor";
import {
  getDexRouter,
  getDexType,
  getDexFee,
  isDexPairEfficient,
} from "./dexRouter";
import { simulateArbitrageWithCosts } from "./swapSimulator";

// ============================================================================
// FLASH LOAN ARBITRAGE CONTRACT ABI
// ============================================================================

const FLASH_LOAN_ARBITRAGE_ABI = [
  "function executeArbitrage(address token, uint256 amount, bytes calldata params) external",
  "function getStats() external view returns (uint256 totalProfit, uint256 totalTrades, bool isPaused)",
  "function authorizedExecutors(address executor) external view returns (bool)",
  "event ArbitrageExecuted(address indexed token, uint256 amount, uint256 profit, uint256 timestamp)",
  "event FlashLoanInitiated(address indexed token, uint256 amount, uint256 fee)",
];

// ============================================================================
// TYPES
// ============================================================================

export interface TradeResult {
  success: boolean;
  txHash?: string;
  profit?: number;
  error?: string;
  gasUsed?: bigint;
  gasCost?: number;
  effectiveGasPrice?: bigint;
  reason?:
    | "simulation_unprofitable"
    | "simulation_error"
    | "high_gas_cost"
    | "on_chain_revert"
    | "pool_too_small"
    | "unknown";
}

export interface ContractStats {
  totalProfit: bigint;
  totalTrades: bigint;
  isPaused: boolean;
}

// ============================================================================
// TRADE EXECUTOR CLASS
// ============================================================================

export class TradeExecutor {
  private provider: ethers.JsonRpcProvider;
  private wallet: ethers.Wallet;
  private contract: ethers.Contract;
  private dryRun: boolean;

  constructor(provider: ethers.JsonRpcProvider, wallet: ethers.Wallet) {
    this.provider = provider;
    this.wallet = wallet;
    this.dryRun = config.monitoring.dryRun;

    // Connect to deployed FlashLoanArbitrage contract
    this.contract = new ethers.Contract(
      config.contracts.flashLoanArbitrage,
      FLASH_LOAN_ARBITRAGE_ABI,
      wallet
    );

    logger.info(
      `Trade Executor initialized ${this.dryRun ? "(DRY RUN MODE)" : "(LIVE MODE)"}`
    );
  }

  // ─────────────────────────────────────────────
  // Balance helpers – use the injected provider
  // (CachedProvider → local value after init, zero RPC)
  // ─────────────────────────────────────────────

  /**
   * Get wallet balance in ETH (string).
   * After bot.init() this returns the LOCAL tracked value – zero RPC calls.
   */
  async getBalance(): Promise<string> {
    const balanceWei = await this.provider.getBalance(this.wallet.address);
    return ethers.formatEther(balanceWei);
  }

  /**
   * Check if wallet has enough native token for gas.
   * Uses the local balance from CachedProvider – no RPC after init.
   */
  async hasSufficientBalance(): Promise<boolean> {
    const balanceWei = await this.provider.getBalance(this.wallet.address);
    const minBalance = ethers.parseEther(
      config.safety.minWalletBalance.toString()
    );
    return balanceWei >= minBalance;
  }

  /**
   * Check whether this wallet is an authorized executor on the contract.
   */
  async isAuthorized(): Promise<boolean> {
    try {
      return await this.contract.authorizedExecutors(this.wallet.address);
    } catch (error) {
      logger.error("Failed to check authorization", error);
      return false;
    }
  }

  /**
   * Fetch on-chain contract statistics.
   */
  async getContractStats(): Promise<ContractStats> {
    try {
      const [totalProfit, totalTrades, isPaused] = await this.contract.getStats();
      return { totalProfit, totalTrades, isPaused };
    } catch (error) {
      logger.error("Failed to get contract stats", error);
      return { totalProfit: 0n, totalTrades: 0n, isPaused: false };
    }
  }

  // ─────────────────────────────────────────────
  // Parameter encoding
  // ─────────────────────────────────────────────

  /**
   * Encode parameters for the flash loan
   *
   * The contract expects:
   * - address dexRouter1: First DEX router address
   * - address dexRouter2: Second DEX router address
   * - address[] path1: Token swap path on DEX 1
   * - address[] path2: Token swap path on DEX 2
   * - uint256 minProfitBps: Minimum profit in basis points
   * - uint24 feeTier1 / feeTier2 (V3 support)
   */
  private encodeArbitrageParams(opportunity: ArbitrageOpportunity): string {
    const { pair, buyDex, sellDex } = opportunity;

    // Use actual DEX router addresses based on DEX name
    const dexRouter1 = getDexRouter(buyDex.dexName);
    const dexRouter2 = getDexRouter(sellDex.dexName);

    logger.info(`🔀 Buy DEX: ${buyDex.dexName} → Router: ${dexRouter1}`);
    logger.info(`🔀 Sell DEX: ${sellDex.dexName} → Router: ${dexRouter2}`);

    if (dexRouter1 === dexRouter2) {
      logger.warning(
        `[WARNING] Both DEXes resolve to same router! This will lose money!`
      );
      logger.warning(`   Buy: \( {buyDex.dexName} ( \){dexRouter1})`);
      logger.warning(`   Sell: \( {sellDex.dexName} ( \){dexRouter2})`);
    }

    // Trading paths
    const path1 = [pair.token0Address, pair.token1Address];
    const path2 = [pair.token1Address, pair.token0Address];

    const minProfitBps = config.trading.minProfitBps;
    const feeTier1 = buyDex.feeTier || 0;
    const feeTier2 = sellDex.feeTier || 0;

    logger.debug(`[PARAMS] feeTier1=\( {feeTier1}, feeTier2= \){feeTier2}`);

    const abiCoder = new ethers.AbiCoder();
    return abiCoder.encode(
      [
        "address",
        "address",
        "address[]",
        "address[]",
        "uint256",
        "uint24",
        "uint24",
      ],
      [dexRouter1, dexRouter2, path1, path2, minProfitBps, feeTier1, feeTier2]
    );
  }

  // ─────────────────────────────────────────────
  // Flash-loan amount calculation
  // ─────────────────────────────────────────────

  /**
   * Calculate optimal flash loan amount based on REAL liquidity
   */
  private calculateFlashLoanAmount(
    opportunity: ArbitrageOpportunity
  ): bigint {
    const buyDexLiquidity = opportunity.buyDex.liquidity || 0;
    const sellDexLiquidity = opportunity.sellDex.liquidity || 0;
    const limitingLiquidity = Math.min(buyDexLiquidity, sellDexLiquidity);

    logger.debug(`[LIQUIDITY CHECK]`);
    logger.debug(
      `  Buy DEX (${opportunity.buyDex.dexName}): \[ {buyDexLiquidity.toFixed(0)}`
    );
    logger.debug(
      `  Sell DEX (${opportunity.sellDex.dexName}): \]{sellDexLiquidity.toFixed(0)}`
    );
    logger.debug(`  Limiting liquidity: \[ {limitingLiquidity.toFixed(0)}`);

    const minLiquidity = config.trading.minPoolLiquidity || 1000;
    if (limitingLiquidity < minLiquidity) {
      logger.warning(
        `⚠️ Pool too small! \]{limitingLiquidity.toFixed(0)} < \[ {minLiquidity} minimum liquidity`
      );
      throw new Error(
        `Pool too small: \]{limitingLiquidity.toFixed(0)} < \[ {minLiquidity} minimum`
      );
    }

    let liquidityPercentage = 0.2;
    const isV3LowFeeTier =
      opportunity.buyDex.feeTier === 500 ||
      opportunity.sellDex.feeTier === 500;

    if (limitingLiquidity < 1000) {
      liquidityPercentage = 0.5;
      logger.debug(
        `  💎 Small pool ( \]{limitingLiquidity.toFixed(0)}) - using 50% of liquidity`
      );
    } else if (limitingLiquidity < 5000) {
      liquidityPercentage = 0.7;
      logger.debug(
        `  📊 Medium pool (\[ {limitingLiquidity.toFixed(0)}) - using 70% of liquidity`
      );
    } else if (limitingLiquidity < 10000) {
      liquidityPercentage = 0.8;
      logger.debug(
        `  💰 Large pool ( \]{limitingLiquidity.toFixed(0)}) - using 80% of liquidity`
      );
    } else {
      liquidityPercentage = 0.9;
      logger.debug(
        `  🏦 Very large pool (\[ {limitingLiquidity.toFixed(0)}) - using 90% of liquidity`
      );
    }

    if (isV3LowFeeTier && limitingLiquidity >= 5000) {
      liquidityPercentage = Math.min(liquidityPercentage, 0.15);
      logger.debug(`  ⚡ V3 0.05% tier: Capped at 15%`);
    }

    const maxSafeTradeSize = limitingLiquidity * liquidityPercentage;

    let configMaxSize = config.trading.maxTradeSize;
    const configMinSize = config.trading.minTradeSize;

    if (limitingLiquidity < 1000) {
      const smallPoolMaxSize = Math.min(limitingLiquidity * 0.5, 2000);
      configMaxSize = Math.min(configMaxSize, smallPoolMaxSize);
      logger.debug(
        `  🎯 Small pool: Capped at \]{smallPoolMaxSize.toFixed(0)}`
      );
    } else if (limitingLiquidity < 5000) {
      const mediumPoolMaxSize = Math.min(limitingLiquidity * 0.7, 5000);
      configMaxSize = Math.min(configMaxSize, mediumPoolMaxSize);
      logger.debug(
        `  🎯 Medium pool: Capped at \[ {mediumPoolMaxSize.toFixed(0)}`
      );
    } else if (isV3LowFeeTier) {
      configMaxSize = Math.min(configMaxSize, 5000);
      logger.debug(`  🎯 V3 0.05% tier: Capped at $5000`);
    }

    let effectiveMinSize = configMinSize;
    if (limitingLiquidity < 1000) {
      effectiveMinSize = Math.min(configMinSize, limitingLiquidity * 0.25);
    }

    if (maxSafeTradeSize < effectiveMinSize) {
      const percentUsed = liquidityPercentage * 100;
      logger.warning(
        `⚠️ Pool too small! ${percentUsed}% of \]{limitingLiquidity.toFixed(0)} = \[ {maxSafeTradeSize.toFixed(0)} < min \]{effectiveMinSize.toFixed(0)}`
      );
      throw new Error(
        `Pool too small: Safe trade size \[ {maxSafeTradeSize.toFixed(0)} < min \]{effectiveMinSize.toFixed(0)}`
      );
    }

    let tradeSize = Math.min(maxSafeTradeSize, configMaxSize);
    tradeSize = Math.max(tradeSize, effectiveMinSize);

    logger.info(
      `[TRADE SIZE] \[ {tradeSize.toFixed(2)} (${((tradeSize / limitingLiquidity) * 100).toFixed(1)}% of \]{limitingLiquidity.toFixed(0)} pool)`
    );

    // Convert USD size → token amount
let tokenPrice = 1.0;
const token0Symbol = opportunity.pair.token0.toUpperCase();
const token1Symbol = opportunity.pair.token1.toUpperCase();
const stablecoins = [
      "USDC",
      "USDT",
      "DAI",
      "MAI",
      "FRAX",
      "TUSD",
      "BUSD",
    ];

const isStablecoin0 = stablecoins.includes(token0Symbol);
const isStablecoin1 = stablecoins.includes(token1Symbol);

if (!isStablecoin0 && !isStablecoin1) {
  // Neither side is a stable – use a rough price for the asset we care about
  tokenPrice = this.estimateToken0PriceUsd(opportunity);
  logger.debug(`  💱 Using non-stable token price: \[ {tokenPrice}`);
} else {
  logger.debug(
    `  💱 Using stablecoin price: $1.00 (\( {token0Symbol}/ \){token1Symbol})`
  );
}

const tokenAmount = tradeSize / tokenPrice;
logger.debug(
  `  🔢 Token amount: \( {tokenAmount.toFixed(2)} tokens ( \){tradeSize.toFixed(2)} / \]{tokenPrice})`
);

return ethers.parseEther(tokenAmount.toString());
      /** Rough USD price of the flash-loaned (token0) asset – network-agnostic */
private estimateToken0PriceUsd(opportunity: ArbitrageOpportunity): number {
    const token0Symbol = opportunity.pair.token0.toUpperCase();
    const stablecoins = ["USDC", "USDT", "DAI", "MAI", "FRAX", "TUSD", "BUSD"];
    if (stablecoins.includes(token0Symbol)) return 1.0;

  // Common natives / wrapped natives (rough, update periodically)
  const priceMap: Record<string, number> = {
    // Polygon / POL
    WMATIC: 0.4,
    MATIC: 0.4,
    POL: 0.4,

    // Ethereum
    WETH: 2000,
    ETH: 2000,

    // Bitcoin
    WBTC: 60000,
    BTC: 60000,

    // BNB Chain
    WBNB: 600,
    BNB: 600,

    // Base / Optimism / Arbitrum style (still ETH)
    // already covered by WETH/ETH

    // Avalanche
    WAVAX: 30,
    AVAX: 30,

    // Fantom
    WFTM: 0.5,
    FTM: 0.5,
  };

  if (priceMap[symbol] !== undefined) {
    return priceMap[symbol];
  }

  // Unknown token – conservative fallback + warning
  logger.warn(
    `  ⚠️ Unknown token symbol "${symbol}" – falling back to $1.00 for size calculation`
  );
  return 1.0;
}

  // ─────────────────────────────────────────────
  // Profitability pre-check (rough, off-chain)
  // ─────────────────────────────────────────────

  private async validateProfitability(
    opportunity: ArbitrageOpportunity,
    flashLoanAmount: bigint
  ): Promise<{ profitable: boolean; reason?: string; estimatedProfit?: number }> {
    try {
      const buyDexFee = getDexFee(opportunity.buyDex.dexName);
      const sellDexFee = getDexFee(opportunity.sellDex.dexName);
      const flashLoanFee = config.trading.flashLoanFeeBps;
      const totalFeeBps = buyDexFee + sellDexFee + flashLoanFee;

      logger.debug(
        `[FEE BREAKDOWN] Buy: \( {opportunity.buyDex.dexName} ( \){buyDexFee} bps) + Sell: \( {opportunity.sellDex.dexName} ( \){sellDexFee} bps) + Flash Loan (${flashLoanFee} bps) = Total: ${totalFeeBps} bps`
      );

      const spreadBps = opportunity.profitPercent * 100;

      const feeData = await this.provider.getFeeData(); // cached
      const gasEstimate = 500000n;
      const gasCostWei = gasEstimate * (feeData.gasPrice || 0n);
      const gasCostEth = parseFloat(ethers.formatEther(gasCostWei));
      const maticPrice = 0.5;
      const gasCostUsd = gasCostEth * maticPrice;

      const flashLoanAmountEth = parseFloat(
        ethers.formatEther(flashLoanAmount)
      );
      const tradeSizeUsd = flashLoanAmountEth * 2000;

      const netProfitBps = spreadBps - totalFeeBps;
      const grossProfitUsd = (netProfitBps / 10000) * tradeSizeUsd;
      const netProfitUsd = grossProfitUsd - gasCostUsd;

      logger.debug("[ANALYSIS] Profitability Analysis:", {
        spread: `${spreadBps} bps`,
        dexFees: `${buyDexFee + sellDexFee} bps`,
        flashLoanFee: `${flashLoanFee} bps`,
        totalFees: `${totalFeeBps} bps`,
        netProfitBps: `${netProfitBps} bps`,
        gasCost: ` \]{gasCostUsd.toFixed(2)}`,
        grossProfit: `\[ {grossProfitUsd.toFixed(2)}`,
        netProfit: ` \]{netProfitUsd.toFixed(2)}`,
      });

      if (netProfitBps <= 0) {
        return {
          profitable: false,
          reason: `Spread (\( {spreadBps} bps) < Fees ( \){totalFeeBps} bps). Would lose ${Math.abs(netProfitBps)} bps`,
        };
      }

      if (netProfitUsd <= 0) {
        return {
          profitable: false,
          reason: `Gas cost (\[ {gasCostUsd.toFixed(2)}) > Gross profit ( \]{grossProfitUsd.toFixed(2)})`,
        };
      }

      const MIN_NET_PROFIT_USD = 0.25;
      if (netProfitUsd < MIN_NET_PROFIT_USD) {
        return {
          profitable: false,
          reason: `Net profit (\[ {netProfitUsd.toFixed(2)}) < \]{MIN_NET_PROFIT_USD.toFixed(2)} minimum threshold`,
        };
      }

      return { profitable: true, estimatedProfit: netProfitUsd };
    } catch (error) {
      logger.error("Error validating profitability:", error);
      return { profitable: false, reason: "Error calculating profitability" };
    }
  }

  // ─────────────────────────────────────────────
  // Main execution entry point
  // ─────────────────────────────────────────────

  /**
   * Execute arbitrage trade
   *
   * FLOW:
   * 1. Encode trading parameters
   * 2. Calculate flash loan amount
   * 3. Build transaction
   * 4. Estimate gas / on-chain simulation
   * 5. Execute (or dry-run)
   * 6. Wait for confirmation
   * 7. Return result with gasUsed so CachedProvider can keep local balance accurate
   */
  async executeTrade(
    opportunity: ArbitrageOpportunity
  ): Promise<TradeResult> {
    try {
      logger.trade("START");
      logger.info(
        `Executing arbitrage: ${opportunity.pair.name} | Buy: ${opportunity.buyDex.dexName} | Sell: ${opportunity.sellDex.dexName}`
      );

      // Check if contract is paused
      const stats = await this.getContractStats();
      if (stats.isPaused) {
        throw new Error("Contract is paused");
      }

      // DEX-pair gas efficiency check
      const currentFeeData = await this.provider.getFeeData(); // cached
      const currentGasPrice = currentFeeData.gasPrice || 0n;

      const dexPairCheck = isDexPairEfficient(
        opportunity.buyDex.dexName,
        opportunity.sellDex.dexName,
        currentGasPrice
      );

      if (!dexPairCheck.efficient) {
        logger.warning(`[REJECTED] DEX pair rejected: ${dexPairCheck.reason}`);
        logger.warning(
          `   Estimated total gas: \[ {dexPairCheck.totalGasCost?.toFixed(2) || "N/A"}`
        );
        return {
          success: false,
          error: `High gas cost DEX pair: ${dexPairCheck.reason}`,
          reason: "high_gas_cost",
        };
      }

      logger.info(
        `[OK] DEX pair efficient! Estimated gas cost: \]{dexPairCheck.totalGasCost?.toFixed(2)}`
      );

      // Encode parameters
      const params = this.encodeArbitrageParams(opportunity);

      // Calculate flash loan amount (may throw pool_too_small)
      let flashLoanAmount: bigint;
      try {
        flashLoanAmount = this.calculateFlashLoanAmount(opportunity);
      } catch (err: any) {
        if (err.message?.includes("Pool too small")) {
          return {
            success: false,
            error: err.message,
            reason: "pool_too_small",
          };
        }
        throw err;
      }

      // Guard: never pass null/undefined amount into simulation or the contract
      if (flashLoanAmount == null || flashLoanAmount <= 0n) {
        return {
          success: false,
          error: `Invalid flash loan amount: ${flashLoanAmount}`,
          reason: "simulation_error",
        };
      }

      const tokenPriceUsd = this.estimateToken0PriceUsd(opportunity);
      const flashLoanAmountFormatted = ethers.formatEther(flashLoanAmount);
      const tradeSizeUSD =
        parseFloat(flashLoanAmountFormatted) * tokenPriceUsd;

      logger.info(`💰 [TRADE SIZE DETAILS]`);
      logger.info(
        `   Amount: ${parseFloat(flashLoanAmountFormatted).toFixed(2)} tokens`
      );
      logger.info(`   Value: \[ {tradeSizeUSD.toFixed(2)} USD`);
      logger.info(`   Pair: ${opportunity.pair.name}`);
      logger.info(
        `   Buy on: \( {opportunity.buyDex.dexName} ( \){
          opportunity.buyDex.feeTier
            ? opportunity.buyDex.feeTier / 100 + " bps"
            : "V2"
        })`
      );
      logger.info(
        `   Sell on: \( {opportunity.sellDex.dexName} ( \){
          opportunity.sellDex.feeTier
            ? opportunity.sellDex.feeTier / 100 + " bps"
            : "V2"
        })`
      );

      // ── On-chain simulation (the only profitability truth) ──
      logger.info(
        `🔍 [ON-CHAIN SIMULATION] Simulating swaps to predict real slippage...`
      );

      try {
        const buyRouter = getDexRouter(opportunity.buyDex.dexName);
        const sellRouter = getDexRouter(opportunity.sellDex.dexName);
        const buyDexType = getDexType(opportunity.buyDex.dexName);
        const sellDexType = getDexType(opportunity.sellDex.dexName);

        if (!buyRouter || !sellRouter) {
          return {
            success: false,
            error: `Missing router: buy=\( {buyRouter} sell= \){sellRouter}`,
            reason: "simulation_error",
          };
        }

        const tokenIn = opportunity.pair.token0Address;
        const tokenOut = opportunity.pair.token1Address;
        if (!tokenIn || !tokenOut) {
          return {
            success: false,
            error: `Missing token addresses: tokenIn=\( {tokenIn} tokenOut= \){tokenOut}`,
            reason: "simulation_error",
          };
        }

        const simulation = await simulateArbitrageWithCosts({
          provider: this.provider,
          tokenIn,
          tokenOut,
          amountIn: flashLoanAmount,
          buyRouter,
          sellRouter,
          buyDexType,
          sellDexType,
          buyFeeTier: opportunity.buyDex.feeTier || 0,
          sellFeeTier: opportunity.sellDex.feeTier || 0,
          flashLoanFeeBps: config.trading.flashLoanFeeBps,
          estimatedGasUnits: 500000n,
          tokenPriceUsd,
        });

        if (!simulation.profitable) {
          logger.debug(
            `[FILTERED] Simulation unprofitable: ${simulation.reason || "unknown"}`
          );
          return {
            success: false,
            error: simulation.reason || "Simulation unprofitable",
            reason: "simulation_unprofitable",
          };
        }

        logger.info(
          `[OK] Simulation profitable – estimated net: \]{(simulation.netProfitUsd || 0).toFixed(2)}`
        );
      } catch (simError: any) {
        logger.error("On-chain simulation failed:", simError?.message || simError);
        return {
          success: false,
          error: simError?.message || "Simulation error",
          reason: "simulation_error",
        };
      }

      // ── Dry-run vs live ──
      if (this.dryRun) {
        logger.info("[DRY RUN] Would execute trade – skipping broadcast");
        return {
          success: true,
          profit: opportunity.netProfit,
          gasCost: opportunity.estimatedGasCost,
          // no real gasUsed in dry-run
        };
      }

      // ── Build & send transaction ──
      const tokenAddress = opportunity.pair.token0Address;

      // Robust chain-agnostic fee data
      let maxFeePerGas: bigint;
      let maxPriorityFeePerGas: bigint;
      try {
        const fees = await getFeeData(this.provider);
        maxFeePerGas = fees.maxFeePerGas!;
        maxPriorityFeePerGas = fees.maxPriorityFeePerGas!;
      } catch {
        const feeData = await this.provider.getFeeData();
        maxFeePerGas = feeData.maxFeePerGas || feeData.gasPrice || 0n;
        maxPriorityFeePerGas = feeData.maxPriorityFeePerGas || 0n;
      }

      const txRequest = await this.contract.executeArbitrage.populateTransaction(
        tokenAddress,
        flashLoanAmount,
        params
      );

      // Estimate gas with a safety buffer
      let gasLimit: bigint;
      try {
        const estimated = await this.wallet.estimateGas(txRequest);
        gasLimit = (estimated * 120n) / 100n; // +20 %
      } catch (estErr: any) {
        logger.warning(
          `Gas estimation failed, using fallback 600k: ${estErr?.message}`
        );
        gasLimit = 600000n;
      }

      const tx = await this.wallet.sendTransaction({
        ...txRequest,
        gasLimit,
        maxFeePerGas,
        maxPriorityFeePerGas,
      });

      logger.info(`Transaction sent: ${tx.hash}`);
      const receipt = await tx.wait();

      if (!receipt || receipt.status !== 1) {
        return {
          success: false,
          txHash: tx.hash,
          error: "Transaction reverted on-chain",
          reason: "on_chain_revert",
          gasUsed: receipt?.gasUsed,
          effectiveGasPrice: receipt?.gasPrice ?? maxFeePerGas,
        };
      }

      // Parse profit from ArbitrageExecuted event if present
      let profitUsd = opportunity.netProfit;
      try {
        for (const log of receipt.logs) {
          try {
            const parsed = this.contract.interface.parseLog(log);
            if (parsed && parsed.name === "ArbitrageExecuted") {
              const profitWei = parsed.args.profit as bigint;
              const profitEth = parseFloat(ethers.formatEther(profitWei));
              profitUsd = profitEth * tokenPriceUsd;
              break;
            }
          } catch {
            // not our event
          }
        }
      } catch {
        // keep opportunity.netProfit
      }

      const effectiveGasPrice =
        receipt.gasPrice ?? maxFeePerGas;
      const gasCostEth = parseFloat(
        ethers.formatEther(receipt.gasUsed * effectiveGasPrice)
      );
      const maticPrice = 0.5;
      const gasCostUsd = gasCostEth * maticPrice;

      logger.success(
        `Trade confirmed | gasUsed=${receipt.gasUsed.toString()} | profit≈$${profitUsd.toFixed(2)}`
      );

      return {
        success: true,
        txHash: receipt.hash,
        profit: profitUsd,
        gasUsed: receipt.gasUsed,
        gasCost: gasCostUsd,
        effectiveGasPrice,
      };
    } catch (error: any) {
      const msg = error?.message || String(error);

      // Classify common failure reasons
      let reason: TradeResult["reason"] = "unknown";
      if (msg.includes("Pool too small")) reason = "pool_too_small";
      else if (msg.toLowerCase().includes("revert")) reason = "on_chain_revert";
      else if (msg.toLowerCase().includes("gas")) reason = "high_gas_cost";

      logger.error("Trade execution failed:", msg);
      return {
        success: false,
        error: msg,
        reason,
      };
    }
  }
}