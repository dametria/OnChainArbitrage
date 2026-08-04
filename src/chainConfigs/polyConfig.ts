export const polyConfig = {
  chainId: 137,
  name: "Polygon",
  nativeCurrency: {
    name: "MATIC",
    symbol: "MATIC",
    decimals: 18,
  },
  rpcUrls: {
    http: process.env.POLYGON_RPC_URL as string,
    websocket: process.env.POLYGON_WSS_URL as string,
  },
  dexes: {
    quickswap: {
      name: "QuickSwap",
      router: "0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff",
      fee: 25,
      dailyVolume: "$50M+",
    },
    sushiswap: {
      name: "SushiSwap",
      router: "0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506",
      fee: 30,
      dailyVolume: "$20M+",
    },
    uniswapv3: {
      name: "Uniswap V3",
      router: "0xE592427A0AEce92De3Edee1F18E0157C05861564",
      fee: 5,
      dailyVolume: "$100M+",
    },
    apeswap: {
      name: "ApeSwap",
      router: "0xC0788A3aD43d79aa53B09c2EaCc313A787d1d607",
      fee: 20,
      dailyVolume: "$10M+",
    },
    dfyn: {
      name: "Dfyn",
      router: "0xE7Fb3e833eFE5F9c441105EB65Ef8b261266423B",
      fee: 30,
      dailyVolume: "$5M+",
    },
    polycat: {
      name: "Polycat",
      router: "0x94930a328162957FF1dd48900aF67B5439336cBD",
      fee: 25,
      dailyVolume: "$2M+",
    },
    jetswap: {
      name: "JetSwap",
      router: "0x5C6EC38fb0e2609672BDf628B1fD605A523E5923",
      fee: 30,
      dailyVolume: "$1M+",
    },
  },
  tokens: {
    WMATIC: "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270",
    WETH: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619",
    USDC: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
    USDT: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F",
    DAI: "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063",
    WBTC: "0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6",
    LINK: "0x53E0bca35eC356BD5ddDFebbD1Fc0fD03FaBad39",
    AAVE: "0xD6DF932A45C0f255f85145f286eA0b292B21C90B",
    UNI: "0xb33EaAd8d922B1083446DC23f610c2567fB5180f",
    CRV: "0x172370d5Cd63279eFa6d502DAB29171933a610AF",
    SUSHI: "0x0b3F868E0BE5597D5DB7fEB59E1CADBb0fdDa50a",
    BAL: "0x9a71012B13CA4d3D0Cdc72A177DF3ef03b0E76A3",
    GHST: "0x385Eeac5cB85A38A9a07A70c73e0a3271CfB54A7",
    MAI: "0xa3Fa99A148fA48D14Ed51d610C367C61876997F1",
    FRAX: "0x45c32fA6DF82ead1e2EF74d17b76547EDdFaFF89",
  },
};

export default polyConfig;
