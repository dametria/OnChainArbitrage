import { ethers } from 'ethers';
import logger from './logger';
import { config } from './config';

const ROUTER_V2_ABI = [
  'function getAmountsOut(uint amountIn, address[] memory path) view returns (uint[] memory amounts)'
];

// Uniswap V3 Quoter V2 - This is the correct contract for simulating V3 swaps
// ABI (minimal for quoteExactInputSingle)
const QUOTER_V2_ABI = [
  'function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96)) external returns (uint256 amountOut, uint160 sqrtPriceX96After, uint160[3])'
];

// Execution slippage buffer (accounts for price movement between detection and execution)
const getExecutionSlippageBps = () => config?.trading?.executionSlippageBuffer || 20;

export type SimDexType = 'v2' | 'v3';

export interface SimulateArbitrageOptions {
  provider: ethers.Provider;
  buyRouter: string;
  sellRouter: string;
  amountIn: bigint;
  /** Preferred names used by tradeExecutor */
  tokenIn?: string;
  tokenOut?: string;
  /** Legacy names */
  token0?: string;
  token1?: string;
  flashLoanFeeBps?: number;
  buyDexType?: SimDexType | string;
  sellDexType?: SimDexType | string;
  buyFeeTier?: number;
  sellFeeTier?: number;
  buyFee?: number;
  sellFee?: number;
  /** Optional USD price of the borrow token for netProfitUsd */
  tokenPriceUsd?: number;
}

function normalizeDexType(t?: string): SimDexType {
  if (!t) return 'v2';
  const n = t.toLowerCase();
  if (n.includes('v3') || n === 'uniswapv3' || n === 'uniswap') return 'v3';
  return 'v2';
}

/**
 * Simulates a V2 swap using router's getAmountsOut
 */
export async function simulateV2Swap(
  provider: ethers.Provider,
  router: string,
  amountIn: bigint,
  path: string[]
): Promise<bigint> {
  if (amountIn == null) {
    throw new Error('simulateV2Swap: amountIn is null/undefined');
  }
  if (!router) {
    throw new Error('simulateV2Swap: router is null/undefined');
  }
  try {
    const routerContract = new ethers.Contract(router, ROUTER_V2_ABI, provider);
    const amounts = await routerContract.getAmountsOut(amountIn, path);
    return amounts[amounts.length - 1];
  } catch (error) {
    logger.error(`Failed to simulate V2 swap on ${router}: ${error}`);
    throw error;
  }
}

/**
 * Simulates a V3 swap using Quoter V2's quoteExactInputSingle
 */
export async function simulateV3Swap(
  provider: ethers.Provider,
  _quoter: string,
  tokenIn: string,
  tokenOut: string,
  fee: number,
  amountIn: bigint
): Promise<bigint> {
  if (amountIn == null) {
    throw new Error('simulateV3Swap: amountIn is null/undefined');
  }

  // Resolve quoter address: prefer explicit param, then runtime config
  const quoterAddr = _quoter || (config.network && (config.network as any).uniswapQuoter) || '';

  if (!quoterAddr) {
    logger.warning('V3 quoter not configured for this chain — using conservative fallback estimate');
    // Conservative fallback: assume 0.5% price impact (multiply by 0.995)
    const estimatedOut = (amountIn * 995n) / 1000n;
    return estimatedOut;
  }

  try {
    const quoterContract = new ethers.Contract(quoterAddr, QUOTER_V2_ABI, provider);

    const quoteParams = {
      tokenIn,
      tokenOut,
      amountIn,
      fee,
      sqrtPriceLimitX96: 0,
    } as any;

    // Some providers/ABIs expose a static call helper — attempt the expected call
    let result: any;
    try {
      // Try the standard call first
      if (typeof quoterContract.quoteExactInputSingle === 'function') {
        // Prefer callStatic if available
        if (quoterContract.callStatic && typeof quoterContract.callStatic.quoteExactInputSingle === 'function') {
          result = await quoterContract.callStatic.quoteExactInputSingle(quoteParams);
        } else {
          result = await quoterContract.quoteExactInputSingle(quoteParams);
        }
      } else if (quoterContract.quoteExactInputSingle.staticCall) {
        // Legacy helper
        result = await quoterContract.quoteExactInputSingle.staticCall(quoteParams);
      } else {
        throw new Error('Quoter contract does not expose quoteExactInputSingle');
      }
    } catch (innerErr) {
      // Some quoter ABIs expect positional args instead of a single struct
      try {
        result = await quoterContract.callStatic.quoteExactInputSingle(tokenIn, tokenOut, fee, amountIn, 0);
      } catch (posErr) {
        throw innerErr || posErr;
      }
    }

    const amountOut = Array.isArray(result) ? result[0] : result;

    logger.debug(
      `V3 simulation: ${ethers.formatEther(amountIn)} → ${ethers.formatEther(amountOut)} (fee: ${fee / 100} bps)`
    );

    return BigInt(amountOut.toString());
  } catch (error: any) {
    logger.warning(`V3 simulation failed: ${error?.message || error}`);
    const estimatedOut = (amountIn * 995n) / 1000n;
    logger.warning(`Using fallback estimate: ${ethers.formatEther(estimatedOut)}`);
    return estimatedOut;
  }
}

/**
 * Simulates a complete arbitrage route (buy on DEX1, sell on DEX2)
 */
export async function simulateArbitrageRoute(
  provider: ethers.Provider,
  buyRouter: string,
  sellRouter: string,
  amountIn: bigint,
  token0: string,
  token1: string,
  buyDexType: SimDexType = 'v2',
  sellDexType: SimDexType = 'v2',
  buyFee?: number,
  sellFee?: number
): Promise<{
  finalAmount: bigint;
  profit: bigint;
  profitPercent: number;
  profitable: boolean;
  buyOutput: bigint;
  priceImpactBps: number;
}> {
  try {
    if (amountIn == null) {
      throw new Error('simulateArbitrageRoute: amountIn is null/undefined');
    }
    if (!token0 || !token1) {
      throw new Error('simulateArbitrageRoute: token0/token1 missing');
    }

    logger.info(`🔍 Simulating arbitrage: ${ethers.formatEther(amountIn)} tokens`);
    logger.info(
      `  Buy: ${buyDexType === 'v3' ? `V3 (${buyFee ? buyFee / 100 : '?'} bps)` : 'V2'} | Sell: ${
        sellDexType === 'v3' ? `V3 (${sellFee ? sellFee / 100 : '?'} bps)` : 'V2'
      }`
    );

    // Step 1: Simulate BUY swap (token0 -> token1)
    let buyOutput: bigint;
    if (buyDexType === 'v3' && buyFee) {
      buyOutput = await simulateV3Swap(provider, buyRouter || '', token0, token1, buyFee, amountIn);
    } else {
      const buyPath = [token0, token1];
      buyOutput = await simulateV2Swap(provider, buyRouter, amountIn, buyPath);
    }

    logger.info(`  Buy simulation: ${ethers.formatEther(amountIn)} → ${ethers.formatEther(buyOutput)}`);

    // Step 2: Simulate SELL swap (token1 -> token0)
    let finalAmount: bigint;
    if (sellDexType === 'v3' && sellFee) {
      finalAmount = await simulateV3Swap(provider, sellRouter || '', token1, token0, sellFee, buyOutput);
    } else {
      const sellPath = [token1, token0];
      finalAmount = await simulateV2Swap(provider, sellRouter, buyOutput, sellPath);
    }

    logger.info(`  Sell simulation: ${ethers.formatEther(buyOutput)} → ${ethers.formatEther(finalAmount)}`);

    const profit = finalAmount - amountIn;
    const profitPercent = (Number(profit) * 100) / Number(amountIn);
    const profitable = profit > 0n;

    const expectedOutput = amountIn;
    const priceImpactBps = Math.abs(
      ((Number(expectedOutput) - Number(finalAmount)) / Number(expectedOutput)) * 10000
    );

    logger.info(
      `  Result: ${profitable ? '✅ PROFIT' : '❌ LOSS'} ${ethers.formatEther(profit)} (${profitPercent.toFixed(4)}%)`
    );
    logger.info(`  Price impact: ${priceImpactBps.toFixed(2)} bps`);

    return {
      finalAmount,
      profit,
      profitPercent,
      profitable,
      buyOutput,
      priceImpactBps,
    };
  } catch (error) {
    logger.error(`Failed to simulate arbitrage route: ${error}`);
    throw error;
  }
}

function isOptionsObject(arg: unknown): arg is SimulateArbitrageOptions {
  return (
    typeof arg === 'object' &&
    arg !== null &&
    'provider' in arg &&
    'amountIn' in arg
  );
}

/**
 * Simulates arbitrage and accounts for costs (flash loan fee, execution slippage).
 * Gas cost is intentionally excluded from the net-profit equation.
 *
 * Supports BOTH:
 *  - options object (preferred, used by tradeExecutor)
 *  - legacy positional arguments
 */
export async function simulateArbitrageWithCosts(
  providerOrOpts: ethers.Provider | SimulateArbitrageOptions,
  buyRouter?: string,
  sellRouter?: string,
  amountIn?: bigint,
  token0?: string,
  token1?: string,
  flashLoanFeeBps: number = 5,
  _estimatedGasUnits: bigint = 500000n, // kept for signature compatibility; ignored in cost equation
  buyDexType: SimDexType | string = 'v2',
  sellDexType: SimDexType | string = 'v2',
  buyFee?: number,
  sellFee?: number
): Promise<{
  finalAmount: bigint;
  grossProfit: bigint;
  flashLoanFee: bigint;
  gasCost: bigint;
  netProfit: bigint;
  netProfitPercent: number;
  netProfitUsd: number;
  profitable: boolean;
  reason?: string;
  simulation: Awaited<ReturnType<typeof simulateArbitrageRoute>>;
}> {
  let provider: ethers.Provider;
  let _buyRouter: string;
  let _sellRouter: string;
  let _amountIn: bigint;
  let _token0: string;
  let _token1: string;
  let _flashLoanFeeBps: number;
  let _buyDexType: SimDexType;
  let _sellDexType: SimDexType;
  let _buyFee: number | undefined;
  let _sellFee: number | undefined;
  let tokenPriceUsd = 1;

  if (isOptionsObject(providerOrOpts)) {
    const o = providerOrOpts;
    provider = o.provider;
    _buyRouter = o.buyRouter;
    _sellRouter = o.sellRouter;
    _amountIn = o.amountIn;
    _token0 = o.tokenIn ?? o.token0 ?? '';
    _token1 = o.tokenOut ?? o.token1 ?? '';
    _flashLoanFeeBps = o.flashLoanFeeBps ?? config.trading?.flashLoanFeeBps ?? 5;
    _buyDexType = normalizeDexType(o.buyDexType);
    _sellDexType = normalizeDexType(o.sellDexType);
    _buyFee = o.buyFeeTier ?? o.buyFee;
    _sellFee = o.sellFeeTier ?? o.sellFee;
    tokenPriceUsd = o.tokenPriceUsd ?? 1;
  } else {
    provider = providerOrOpts;
    _buyRouter = buyRouter!;
    _sellRouter = sellRouter!;
    _amountIn = amountIn!;
    _token0 = token0!;
    _token1 = token1!;
    _flashLoanFeeBps = flashLoanFeeBps;
    _buyDexType = normalizeDexType(String(buyDexType));
    _sellDexType = normalizeDexType(String(sellDexType));
    _buyFee = buyFee;
    _sellFee = sellFee;
  }

  // Hard guards — these are the exact source of the BigNumberish null error
  if (_amountIn == null) {
    throw new Error('simulateArbitrageWithCosts: amountIn is null/undefined');
  }
  if (!_buyRouter || !_sellRouter) {
    throw new Error('simulateArbitrageWithCosts: buyRouter/sellRouter missing');
  }
  if (!_token0 || !_token1) {
    throw new Error('simulateArbitrageWithCosts: tokenIn/tokenOut (token0/token1) missing');
  }

  const simulation = await simulateArbitrageRoute(
    provider,
    _buyRouter,
    _sellRouter,
    _amountIn,
    _token0,
    _token1,
    _buyDexType,
    _sellDexType,
    _buyFee,
    _sellFee
  );

  const flashLoanFee = (_amountIn * BigInt(_flashLoanFeeBps)) / 10000n;

  // Gas is excluded from the cost equation (estimated/actual gas amount is not a variable here)
  const gasCost = 0n;

  const executionSlippageBps = getExecutionSlippageBps();
  const executionSlippageCost = (_amountIn * BigInt(executionSlippageBps)) / 10000n;

  const grossProfit = simulation.profit;
  const totalCosts = flashLoanFee + executionSlippageCost;
  const netProfit = grossProfit - totalCosts;
  const netProfitPercent = (Number(netProfit) * 100) / Number(_amountIn);
  const profitable = netProfit > 0n;

  // Rough USD conversion (token amount * price). Caller can pass tokenPriceUsd.
  const netProfitToken = Number(ethers.formatEther(netProfit));
  const netProfitUsd = netProfitToken * tokenPriceUsd;

  let reason: string | undefined;
  if (!profitable) {
    if (grossProfit <= 0n) {
      reason = `Gross swap profit negative (${ethers.formatEther(grossProfit)} tokens)`;
    } else {
      reason = `Net after fees/slippage negative (net=${ethers.formatEther(netProfit)}, costs=${ethers.formatEther(totalCosts)})`;
    }
  }

  logger.info(`💰 Cost breakdown:`);
  logger.info(`  Gross profit: ${ethers.formatEther(grossProfit)}`);
  logger.info(`  Flash loan fee: ${ethers.formatEther(flashLoanFee)} (${_flashLoanFeeBps} bps)`);
  logger.info(`  Gas cost: excluded from equation`);
  logger.info(
    `  Execution slippage buffer: ${ethers.formatEther(executionSlippageCost)} (${executionSlippageBps} bps)`
  );
  logger.info(`  Total costs: ${ethers.formatEther(totalCosts)}`);
  logger.info(`  Net profit: ${ethers.formatEther(netProfit)} (${netProfitPercent.toFixed(4)}%) ≈ $${netProfitUsd.toFixed(4)}`);
  logger.info(`  Status: ${profitable ? '✅ PROFITABLE' : '❌ UNPROFITABLE'}`);

  return {
    finalAmount: simulation.finalAmount,
    grossProfit,
    flashLoanFee,
    gasCost,
    netProfit,
    netProfitPercent,
    netProfitUsd,
    profitable,
    reason,
    simulation,
  };
}
