import { ethers } from "ethers";
import { config } from "./config.js";
import logger from "./logger.js";

interface PolygonGasStationResponse {
  safeLow: { maxPriorityFee: number; maxFee: number };
  standard: { maxPriorityFee: number; maxFee: number };
  fast: { maxPriorityFee: number; maxFee: number };
  estimatedBaseFee: number;
  blockNumber: number;
}

/**
 * Fetches gas fee data from Polygon Gas Station API.
 * Falls back to provider.getFeeData() if the API is unavailable.
 */
export async function getPolygonFeeData(
  provider: ethers.Provider
): Promise<ethers.FeeData> {
  try {
    const response = await fetch("https://gasstation.polygon.technology/v2", {
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      throw new Error(`Gas station returned ${response.status}`);
    }

    const data: PolygonGasStationResponse = await response.json() as PolygonGasStationResponse;

    const maxPriorityFeePerGas = ethers.parseUnits(
      String(Math.ceil(data.fast.maxPriorityFee)),
      "gwei"
    );
    const maxFeePerGas = ethers.parseUnits(
      String(Math.ceil(data.fast.maxFee)),
      "gwei"
    );

    logger.debug(
      `Polygon Gas Station: maxFee=${data.fast.maxFee} gwei, maxPriorityFee=${data.fast.maxPriorityFee} gwei`
    );

    return new ethers.FeeData(
      maxFeePerGas,
      maxPriorityFeePerGas,
      null
    );
  } catch (error) {
    logger.warning(
      `Polygon Gas Station unavailable, falling back to provider fee data: ${error}`
    );
    const feeData = await provider.getFeeData();
    return feeData;
  }
}

/**
 * Returns fee data appropriate for the current network.
 * Uses Polygon Gas Station for Polygon, provider.getFeeData() for other chains.
 */
export async function getNetworkFeeData(
  provider: ethers.Provider
): Promise<ethers.FeeData> {
  const networkName = config.network.name;

  if (networkName === "polygon") {
    return getPolygonFeeData(provider);
  }

  return provider.getFeeData();
}
