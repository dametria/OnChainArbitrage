export const baseConfig = {
  chainId: 8453,
  name: "Base",
  nativeCurrency: {
    name: "Ethereum",
    symbol: "ETH",
    decimals: 18,
  },
  rpcUrls: {
    http: process.env.BASE_RPC_URL as string,
    websocket: process.env.BASE_WSS_URL as string,
  },
  dexes: {
    baseswap: {
      name: "BaseSwap",
      router: "0x327Df1E6de05895d2ab08513aaDD9313Fe505d86",
      fee: 30,
      dailyVolume: "$40M+",
    },
    sushiswap: {
      name: "SushiSwap",
      router: "0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506",
      fee: 30,
      dailyVolume: "$15M+",
    },
    swapbased: {
      name: "SwapBased",
      router: "0xaaa3b1F1bd7BCc97fD1917c18ADE665C5D31F066",
      fee: 25,
      dailyVolume: "$5M+",
    },
    rocketswap: {
      name: "RocketSwap",
      router: "0x5Edb77b8f2b8D8e8C7b7a3F4a6a6b9D7C8E9F0A1",
      fee: 30,
      dailyVolume: "$3M+",
    },
  },
  tokens: {
    WETH: "0x4200000000000000000000000000000000000006",
    USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    DAI: "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb",
    WBTC: "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c",
    USDT: "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2",
  },
};

export default baseConfig;
