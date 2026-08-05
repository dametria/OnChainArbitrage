export const bscConfig = {
  chainId: 56,
  name: "BSC",
  nativeCurrency: {
    name: "BNB",
    symbol: "BNB",
    decimals: 18,
  },
  // Optional Uniswap V3 quoter address for BSC (provided)
  uniswapQuoter: process.env.BSC_UNISWAP_QUOTER || "0x78D78E420Da98ad378D7799bE8f4AF69033EB077",
  // Optional aave provider supplied by chain config (BSC Aave v3 provider)
  aavePoolAddressProvider: process.env.BSC_AAVE_PROVIDER || "0xff75B6da14FfbbfD355Daf7a2731456b3562Ba6D.",
  rpcUrls: {
    http: process.env.BSC_RPC_URL as string,
    websocket: process.env.BSC_WSS_URL as string,
  },
  dexes: {
    pancakeswap: {
      name: "PancakeSwap V2",
      router: "0x10ED43C718714eb63d5aA57B78B54704E256024E",
      fee: 25,
      dailyVolume: "$400M+",
    },
    apeswap: {
      name: "ApeSwap",
      router: "0xcF0feBd3f17CEf5b47b0cD257aCf6025c5BFf3b7",
      fee: 20,
      dailyVolume: "$15M+",
    },
    biswap: {
      name: "BiSwap",
      router: "0x3a6d8cA21D1CF76F653A67577FA0D27453350dD8",
      fee: 10,
      dailyVolume: "$10M+",
    },
    bakeryswap: {
      name: "BakerySwap",
      router: "0xCDe540d7eAFE93aC5fE6233Bee57E1270D3E330F",
      fee: 30,
      dailyVolume: "$5M+",
    },
    mdex: {
      name: "MDEX",
      router: "0x7DAe51BD3E3376B8c7c4900E9107f12Be3AF1bA8",
      fee: 30,
      dailyVolume: "$3M+",
    },
  },
  tokens: {
    WBNB: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
    WETH: "0x2170Ed0880ac9A755fd29B2688956BD959F933F8",
    USDC: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
    USDT: "0x55d398326f99059fF775485246999027B3197955",
    DAI:  "0x1AF3F329e8BE154074D8769D1FFa4eE058B1DBc3",
    BTCB: "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c",
    LINK: "0xF8A0BF9cF54Bb92F17374d9e9A321E6a111a51bD",
    AAVE: "0xfb6115445Bff7b52FeB98650C87f44907E58f802",
    UNI: "0xBf5140A22578168FD562DCcF235E5D43A02ce9B1",
    CAKE: "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82",
    BANANA: "0x603c7f932ED1fc6575303D8Fb018fDCBb0f39a95",
  },
};

export default bscConfig;
