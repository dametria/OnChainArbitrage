/**
 * BSC (Chain ID 56) Configuration
 */

export const bscConfig = {
  network: {
    name: "bsc" as const,
    chainId: 56,
    rpcUrl:
      process.env.BSC_RPC_URL ||
      "https://bsc-mainnet.infura.io/v3/d90f2773b8cd47b6a14d98c0d0b6df24",
  },

  contracts: {
    flashLoanArbitrage: process.env.BSC_CONTRACT_ADDRESS || "0x7A6224E5DbC1b76c57a3acA0317FEA336A62341e",
    aavePoolAddressProvider: "0xff75B6da14FfbbfD355Daf7a2731456b3562Ba6D", // update if using Aave on BSC
  },

  tokens: {
    WBNB: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
    WETH: "0x2170Ed0880ac9A755fd29B2688956BD959F933F8",
    BTCB: "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c",
    USDC: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
    USDT: "0x55d398326f99059fF775485246999027B3197955",
    BUSD: "0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56",
    DAI: "0x1AF3F329e8BE154074D8769D1FFa4eE058B1DBc3",
    CAKE: "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82",
    BANANA: "0x603c7f932ED1fc6575303D8Fb018fDCBb0f39a95",
    UNI: "0xBf5140A22578168FD562DCcF235E5D43A02ce9B1",
    LINK: "0xF8A0BF9cF54Bb92F17374d9e9A321E6a111a51bD",
    AAVE: "0xfb6115445Bff7b52FeB98650C87f44907E58f802",
    SUSHI: "0x947950BcC74888a40Ffa2593C5798F11Fc9124C4",
    AXS: "0x715D400F88C167884bbCc41C5FeA407ed4D2f8A0",
    MBOX: "0x3203c9E46cA618C8C1cE5dC67e7e9D75f5da2377",
    GALA: "0x7dDEE176F665cD201F93eEDE625770E2fD911990",
    ADA: "0x3EE2200Efb3400fAbB9AacF31297cBdD1d435D47",
    DOT: "0x7083609fCE4d1d8Dc0C979AAb8c869Ea2C873402",
    MATIC: "0xCC42724C6683B7E57334c4E856f4c9965ED682bD",
    AVAX: "0x1CE0c2827e2eF14D5C4f29a091d735A204794041",
    FTM: "0xAD29AbB318791D579433D831ed122aFeAf29dcfe",
    XVS: "0xcF6BB5389c92Bdda8a3747Ddb454cB7a64626C63",
    ALPACA: "0x8F0528cE5eF7B51152A59745bEfDD91D97091d2F",
  },

  dexes: {
    uniswapV2Router: "0x10ED43C718714eb63d5aA57B78B54704E256024E",
    pancakeswap: "0x10ED43C718714eb63d5aA57B78B54704E256024E",
    apeswap: "0xcF0feBd3f17CEf5b47b0cD257aCf6025c5BFf3b7",
    biswap: "0x3a6d8cA21D1CF76F653A67577FA0D27453350D8",
    bakeryswap: "0xCDe540d7eAFE93aC5fE6233Bee57E1270D3E330F",
    mdex: "0x7DAe51BD3E3376B8c7c4900E9107f12Be3AF1bA8",
  },

  monitoring: {
    priceCheckInterval: 15000,
    debugMode: process.env.ENABLE_DEBUG === "true",
    dryRun: process.env.ENABLE_DRY_RUN !== "false",

    watchedPairs: [
      // Most pairs currently disabled per original strategy
      { name: "WBNB/USDT", token0: "WBNB", token1: "USDT", enabled: false },
      { name: "WBNB/BUSD", token0: "WBNB", token1: "BUSD", enabled: false },
      { name: "WBNB/USDC", token0: "WBNB", token1: "USDC", enabled: false },
      { name: "WBNB/WETH", token0: "WBNB", token1: "WETH", enabled: true },
      { name: "WBNB/BTCB", token0: "WBNB", token1: "BTCB", enabled: true },
      { name: "WETH/USDT", token0: "WETH", token1: "USDT", enabled: false },
      { name: "WETH/BUSD", token0: "WETH", token1: "BUSD", enabled: false },
      { name: "BTCB/USDT", token0: "BTCB", token1: "USDT", enabled: false },
      { name: "BTCB/BUSD", token0: "BTCB", token1: "BUSD", enabled: false },
      { name: "CAKE/WBNB", token0: "CAKE", token1: "WBNB", enabled: true },
      { name: "CAKE/USDT", token0: "CAKE", token1: "USDT", enabled: false },
      { name: "BANANA/WBNB", token0: "BANANA", token1: "WBNB", enabled: true },
      { name: "UNI/WBNB", token0: "UNI", token1: "WBNB", enabled: true },
      { name: "LINK/WBNB", token0: "LINK", token1: "WBNB", enabled: true },
      { name: "AAVE/WBNB", token0: "AAVE", token1: "WBNB", enabled: true },
      { name: "AXS/WBNB", token0: "AXS", token1: "WBNB", enabled: true },
      { name: "GALA/WBNB", token0: "GALA", token1: "WBNB", enabled: true },
      { name: "ADA/WBNB", token0: "ADA", token1: "WBNB", enabled: true },
      { name: "DOT/WBNB", token0: "DOT", token1: "WBNB", enabled: true },
      { name: "MATIC/WBNB", token0: "MATIC", token1: "WBNB", enabled: true },
    ],
  },
};
