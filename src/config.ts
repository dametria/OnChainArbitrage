/**
 * 🔧 Main Configuration Entry Point
 *
 * Selects the correct chain-specific config based on NETWORK env var
 * and merges it with shared settings.
 */

import * as dotenv from "dotenv";
dotenv.config();

import { polyConfig } from "./config/polyConfig";
import { bscConfig } from "./config/bscConfig";
import { baseConfig } from "./config/baseConfig";

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
    minProfitBps: parseInt(process.env.MIN_PROFIT_BPS || "20", 10),
    maxGasPrice: 500, // Gwei
    maxTradeSize: parseInt(process.env.MAX_TRADE_SIZE_USD || "1000", 10),
    minTradeSize: parseInt(process.env.MIN_TRADE_SIZE_USD || "200", 10),
    slippageTolerance: parseInt(process.env.SLIPPAGE_TOLERANCE_BPS || "150", 10),
    flashLoanFeeBps: 5, // 0.05%
    minPoolLiquidity: parseInt(process.env.MIN_POOL_LIQUIDITY || "1000", 10),
    executionSlippageBuffer: parseInt(
      process.env.EXECUTION_SLIPPAGE_BPS || "20",
      10
    ),
  },

  safety: {
    maxConcurrentTrades: 1,
    maxDailyLoss: 50, // USD
    emergencyGasPriceStop: 1000, // Gwei
    minWalletBalance: 0.01,
  },

  notifications: {
    enabled: process.env.ENABLE_NOTIFICATIONS === "true",
    telegram: {
      botToken: process.env.TELEGRAM_BOT_TOKEN || "",
      chatId: process.env.TELEGRAM_CHAT_ID || "",
    },
  },

  // Chain-specific (network, contracts, tokens, dexes, monitoring)
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

  if (!config.wallet.privateKey) {
    errors.push("Missing PRIVATE_KEY in .env file");
  }

  if (!config.contracts?.flashLoanArbitrage) {
    errors.push(
      `Missing FlashLoanArbitrage contract address for ${config.network?.name}`
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
  const entry = Object.entries(config.tokens).find(
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

export default config;
