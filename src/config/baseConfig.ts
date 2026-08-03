/**
 * Base (Chain ID 8453) Configuration
 */

export const baseConfig = {
  network: {
    name: "base" as const,
    chainId: 8453,
    rpcUrl:
      process.env.BASE_RPC_URL ||
      process.env.RPC_URL ||
      "https://mainnet.base.org",
    rpcWssUrl:
      process.env.BASE_WSS_URL ||
      process.env.RPC_WSS_URL ||
      "",
  },

  contracts: {
    flashLoanArbitrage: process.env.BASE_CONTRACT_ADDRESS || "",
    // Official Aave V3 PoolAddressesProvider on Base
    aavePoolAddressProvider: "0xe20fCBdBfFC4Dd138cE8b2E6FBb6CB49777ad64D",
  },

  nativeTokenSymbol: "WETH",
  quoteStableSymbol: "USDC",

  tokens: {
    WETH: "0x4200000000000000000000000000000000000006",
    USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    DAI: "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb",
    USDT: "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2",
    WBTC: "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c",
    BSWAP: "0x78a087d713Be963Bf307b18F2Ff8122EF9A63ae9",
    TOSHI: "0xAC1Bd2486aAf3B5C0fc3Fd868558b082a531B2B4",
    UNI: "0xc3De830EA07524a0761646a6a4e4be0e114a3C83",
    LINK: "0x88Fb150BDc53A65fe94Dea0c9BA0a6dAf8C6e196",
    AAVE: "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5",
    SUSHI: "0x7D49a065D17d6d4a55dc13649901fdBB98B2AFBA",
  },

  dexes: {
    uniswapV2Router: "0x327Df1E6de05895d2ab08513aaDD9313Fe505d86",
    baseswap: "0x327Df1E6de05895d2ab08513aaDD9313Fe505d86",
    sushiswap: "0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506",
    swapbased: "0xaaa3b1F1bd7BCc97fD1917c18ADE665C5D31F066",
    aerodrome: "0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43",
  },

  monitoring: {
    priceCheckInterval: 15000,
    debugMode: process.env.ENABLE_DEBUG === "true",
    dryRun: process.env.ENABLE_DRY_RUN !== "false",

    watchedPairs: [
      { name: "WBTC/WETH", token0: "WBTC", token1: "WETH", enabled: true },
      { name: "WBTC/USDC", token0: "WBTC", token1: "USDC", enabled: true },
      { name: "LINK/WETH", token0: "LINK", token1: "WETH", enabled: true },
      { name: "LINK/USDC", token0: "LINK", token1: "USDC", enabled: true },
      { name: "AAVE/WETH", token0: "AAVE", token1: "WETH", enabled: true },
      { name: "UNI/WETH", token0: "UNI", token1: "WETH", enabled: true },
      { name: "UNI/USDC", token0: "UNI", token1: "USDC", enabled: true },
      { name: "SUSHI/WETH", token0: "SUSHI", token1: "WETH", enabled: true },
    ],
  },
};
