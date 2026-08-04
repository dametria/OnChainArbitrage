/**
 * 🔧 Main Configuration Entry Point
 *
 * Selects the correct chain-specific config based on NETWORK env var
 * and merges it with shared settings.
 */

import * as dotenv from "dotenv";
dotenv.config();

import { polyConfig } from "./chainConfigs/polyConfig";
import { bscConfig } from "./chainConfigs/bscConfig";
import { baseConfig } from "./chainConfigs/baseConfig";

export { polyConfig, bscConfig, baseConfig };

export type SupportedChain = "polygon" | "bsc" | "base";


const networkName = (process.env.NETWORK || "polygon") as SupportedChain;

const chainConfigs = {
  polygon: polyConfig,
  bsc: bscConfig,
  base: baseConfig,
} as const;

const selectedChain = chainConfigs[networkName];

if (!selectedChain) {
  throw new Error(
    `Unsupported NETWORK="${networkName}". Supported values: polygon | bsc | base`
  );
}

// ============================================================================
// FINAL CONFIG
// ============================================================================

export const config = {
  // Shared across all chains
  wallet: {
    privateKey: process.env.PRIVATE_KEY || "",
  },

  trading: {
    minProfitBps: parseInt(process.env.MIN_PROFIT_BPS || "15", 10),
    maxGasPrice: parseInt(process.env.MAX_GAS_PRICE || "500", 10), // Gwei
    maxTradeSize: parseInt(process.env.MAX_TRADE_SIZE_USD || "10000", 10),
    minTradeSize: parseInt(process.env.MIN_TRADE_SIZE_USD || "50", 10),
    slippageTolerance: parseInt(process.env.SLIPPAGE_TOLERANCE_BPS || "150", 10),
    flashLoanFeeBps: 5, // 0.05%
    minPoolLiquidity: parseInt(process.env.MIN_POOL_LIQUIDITY || "250", 10),
    executionSlippageBuffer: parseInt(
      process.env.EXECUTION_SLIPPAGE_BPS || "20",
      10
    ),
  },
  
  monitoring: { 
    dryRun: process.env.ENABLE_DRY_RUN !== "false",
   },

  safety: {
    maxConcurrentTrades: 1,
    maxDailyLoss: parseFloat(process.env.MAX_DAILY_LOSS || "50"), // USD
    emergencyGasPriceStop: parseInt(
      process.env.EMERGENCY_GAS_PRICE_STOP || "1000",
      10
    ), // Gwei
    minWalletBalance: parseFloat(process.env.MIN_WALLET_BALANCE || "0.01"),
  },

  notifications: {
    enabled: process.env.ENABLE_NOTIFICATIONS === "true",
    telegram: {
      botToken: process.env.TELEGRAM_BOT_TOKEN || "",
      chatId: process.env.TELEGRAM_CHAT_ID || "",
    },
  },

  // Chain-specific (network, contracts, tokens, dexes, monitoring, nativeTokenSymbol, quoteStableSymbol)
  ...selectedChain,
};

// ============================================================================
// VALIDATION
// ============================================================================

export function validateConfig(): void {
  const errors: string[] = [];

  if (!config.network?.rpcUrl) {
    errors.push(`Missing RPC URL for network "${config.network?.name}"`);
  }

  if (!config.wallet.privateKey || config.wallet.privateKey.length < 64) {
    errors.push("Missing or invalid PRIVATE_KEY in .env file");
  }

  // Contract address is REQUIRED and must not silently default to another chain
  if (
    !config.contracts?.flashLoanArbitrage ||
    config.contracts.flashLoanArbitrage ===
      "0x0000000000000000000000000000000000000000"
  ) {
    const envHint =
      networkName === "polygon"
        ? "POLYGON_CONTRACT_ADDRESS or CONTRACT_ADDRESS"
        : networkName === "bsc"
          ? "BSC_CONTRACT_ADDRESS"
          : "BASE_CONTRACT_ADDRESS";
    errors.push(
      `Missing FlashLoanArbitrage contract address for ${config.network?.name}. Set ${envHint} in .env`
    );
  }

  // Aave provider is required on chains that use Aave flash loans
  if (
    (networkName === "polygon" || networkName === "base") &&
    !config.contracts?.aavePoolAddressProvider
  ) {
    errors.push(
      `Missing aavePoolAddressProvider for ${config.network?.name}`
    );
  }

  if (config.trading.minProfitBps < 3) {
    errors.push("minProfitBps too low – must be at least 3 bps (0.03%)");
  }

  if (config.trading.maxTradeSize < config.trading.minTradeSize) {
    errors.push("maxTradeSize must be greater than minTradeSize");
  }

  if (errors.length > 0) {
    console.error("❌ Configuration Errors:");
    errors.forEach((e) => console.error(`  - ${e}`));
    throw new Error("Invalid configuration. Please check your .env file.");
  }

  console.log(
    `✅ Configuration validated successfully (${config.network.name} – chainId ${config.network.chainId})`
  );
  console.log(
    `   Contract: ${config.contracts.flashLoanArbitrage}`
  );
  console.log(
    `   Aave Provider: ${config.contracts.aavePoolAddressProvider || "(none)"}`
  );
}

// ============================================================================
// HELPERS
// ============================================================================

export function getTokenAddress(symbol: string): string {
  const tokens = config.tokens as Record<string, string>;
  const address = tokens[symbol];
  if (!address) {
    throw new Error(
      `Token "${symbol}" not found in ${config.network.name} configuration`
    );
  }
  return address;
}

export function getTokenSymbol(address: string): string {
  const entry = Object.entries(config.tokens as Record<string, string>).find(
    ([, addr]) => addr.toLowerCase() === address.toLowerCase()
  );
  return entry ? entry[0] : "UNKNOWN";
}

export function bpsToDecimal(bps: number): number {
  return bps / 10000;
}

export function decimalToBps(decimal: number): number {
  return Math.round(decimal * 10000);
}

/** Native token symbol for the active chain (e.g. WMATIC, WBNB, WETH) */
export function getNativeTokenSymbol(): string {
  return (config as any).nativeTokenSymbol || "WETH";
}

/** Preferred stablecoin symbol for USD quotes on the active chain */
export function getQuoteStableSymbol(): string {
  return (config as any).quoteStableSymbol || "USDC";
}

export default config;
