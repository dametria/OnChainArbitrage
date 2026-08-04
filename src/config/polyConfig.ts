/**
 * Polygon (Chain ID 137) Configuration
 */

export const polyConfig = {
  network: {
    name: "polygon" as const,
    chainId: 137,
    rpcUrl:
      process.env.POLYGON_RPC_URL || "https://polygon-mainnet.infura.io/v3/0943af620e824e12a62823f73eacc3f5",
      process.env.RPC_URL || "https://polygon-mainnet.infura.io/v3/0943af620e824e12a62823f73eacc3f5",
    rpcWssUrl:
      process.env.POLYGON_WSS_URL || "wss://polygon-mainnet.infura.io/ws/v3/0943af620e824e12a62823f73eacc3f5",
      process.env.RPC_WSS_URL || "wss://polygon-mainnet.infura.io/ws/v3/0943af620e824e12a62823f73eacc3f5",
  },

  contracts: {
    // Prefer explicit per-chain env; fall back to generic CONTRACT_ADDRESS only on Polygon
    flashLoanArbitrage:
      process.env.POLYGON_CONTRACT_ADDRESS ||"0xF5DE7efa7D2eEc0907bE81FB7Ed4d36aDf1FdC06",
      process.env.CONTRACT_ADDRESS ||
      "0xF5DE7efa7D2eEc0907bE81FB7Ed4d36aDf1FdC06",
    // Official Aave V3 PoolAddressesProvider on Polygon
    aavePoolAddressProvider:"0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb",
  },

  // Native token symbol used for gas cost conversion
  nativeTokenSymbol: "WMATIC",

  // Preferred stablecoin for price quotes
  quoteStableSymbol: "USDC",

  tokens: {
    // === TIER 1: NATIVE & MAJOR STABLECOINS ===
    WMATIC: "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270",
    WETH: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619",
    USDC: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
    USDT: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F",
    DAI: "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063",
    WBTC: "0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6",

    // === TIER 2: MAJOR DEFI TOKENS ===
    LINK: "0x53E0bca35eC356BD5ddDFebbD1Fc0fD03FaBad39",
    AAVE: "0xD6DF932A45C0f255f85145f286eA0b292B21C90B",
    UNI: "0xb33EaAd8d922B1083446DC23f610c2567fB5180f",
    CRV: "0x172370d5Cd63279eFa6d502DAB29171933a610AF",
    SUSHI: "0x0b3F868E0BE5597D5DB7fEB59E1CADBb0fdDa50a",
    BAL: "0x9a71012B13CA4d3D0Cdc72A177DF3ef03b0E76A3",
    COMP: "0x8505b9d2254A7Ae468c0E9dd10Ccea3A837aef5c",
    MKR: "0x6f7C932e7684666C9fd1d44527765433e01fF61d",
    SNX: "0x50B728D8D964fd00C2d0AAD81718b71311feF68a",
    YFI: "0xDA537104D6A5edd53c6fBba9A898708E465260b6",

    // === TIER 3: LAYER 2 & SCALING ===
    MATIC: "0x0000000000000000000000000000000000001010",
    POL: "0x455e53CBB86018Ac2B8092FdCd39d8444aFFC3F6",
    SAND: "0xBbba073C31bF03b8ACf7c28EF0738DeCF3695683",
    MANA: "0xA1c57f48F0Deb89f569dFbE6E2B7f46D33606fD4",
    GHST: "0x385Eeac5cB85A38A9a07A70c73e0a3271CfB54A7",

    // === Additional commonly used ===
    FRAX: "0x45c32fA6DF82ead1e2EF74d17b76547EDdFaFF89",
    MAI: "0xa3Fa99A148fA48D14Ed51d610C367C61876997F1",
    QUICK: "0x831753DD7087CaC61aB5644b308642cc1c33Dc13",
  },

  dexes: {
    uniswapV2Router: "0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff",
    quickswap: "0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff",
    sushiswap: "0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506",
    uniswapv3: "0xE592427A0AEce92De3Edee1F18E0157C05861564",
    uniswapV3: "0xE592427A0AEce92De3Edee1F18E0157C05861564",
    apeswap: "0xC0788A3aD43d79aa53B09c2EaCc313A787d1d607",
    dfyn: "0xA102072A4C07F06EC3B4900FDC4C7B80b6c57429",
    polycat: "0x94930a328162957FF1dd48900aF67B5439336cBD",
    jetswap: "0x5C6EC38fb0e2609672BDf628B1fD605A523E5923",
    curve: "0x445FE580eF8d70FF569aB36e80c647af338db351",
    balancer: "0xBA12222222228d8Ba445958a75a0704d566BF2C8",
  },

  monitoring: {
    priceCheckInterval: 15000,
    debugMode: process.env.ENABLE_DEBUG === "true",
    dryRun: process.env.ENABLE_DRY_RUN !== "false",

    watchedPairs: [
      { name: "WBTC/WMATIC", token0: "WBTC", token1: "WMATIC", enabled: true },
      { name: "WBTC/WETH", token0: "WBTC", token1: "WETH", enabled: true },
      { name: "DAI/WMATIC", token0: "DAI", token1: "WMATIC", enabled: true },
      { name: "DAI/WETH", token0: "DAI", token1: "WETH", enabled: true },
      { name: "LINK/WMATIC", token0: "LINK", token1: "WMATIC", enabled: true },
      { name: "LINK/WETH", token0: "LINK", token1: "WETH", enabled: true },
      { name: "AAVE/WMATIC", token0: "AAVE", token1: "WMATIC", enabled: true },
      { name: "AAVE/WETH", token0: "AAVE", token1: "WETH", enabled: true },
      { name: "UNI/WETH", token0: "UNI", token1: "WETH", enabled: true },
      { name: "CRV/WMATIC", token0: "CRV", token1: "WMATIC", enabled: true },
      { name: "CRV/WETH", token0: "CRV", token1: "WETH", enabled: true },
      { name: "SUSHI/WMATIC", token0: "SUSHI", token1: "WMATIC", enabled: true },
      { name: "SUSHI/WETH", token0: "SUSHI", token1: "WETH", enabled: true },
      { name: "BAL/WMATIC", token0: "BAL", token1: "WMATIC", enabled: true },
      { name: "BAL/WETH", token0: "BAL", token1: "WETH", enabled: true },
      { name: "WETH/WBTC", token0: "WETH", token1: "WBTC", enabled: true },
      { name: "WMATIC/LINK", token0: "WMATIC", token1: "LINK", enabled: true },
      { name: "WMATIC/AAVE", token0: "WMATIC", token1: "AAVE", enabled: true },
    ],
  },
};
