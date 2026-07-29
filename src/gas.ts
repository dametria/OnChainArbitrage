import { ethers, FeeData } from "ethers";

/**
 * Robust gas fee estimator for Polygon
 * 1. Tries official Gas Station
 * 2. Falls back to provider.getFeeData()
 * 3. Falls back to safe static values
 */
export async function getPolygonFeeData(
  provider: ethers.Provider,
  options: {
    retries?: number;
    retryDelayMs?: number;
    preferGasStation?: boolean;
  } = {}
): Promise<FeeData> {
  const {
    retries = 3,
    retryDelayMs = 800,
    preferGasStation = true,
  } = options;

  // --- 1. Try official Polygon Gas Station (with retries) ---
  if (preferGasStation) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const res = await fetch("https://gasstation.polygon.technology/v2", {
          signal: AbortSignal.timeout(4000), // prevent hanging
        });

        if (!res.ok) throw new Error(`Gas Station HTTP ${res.status}`);

        const data = await res.json();

        // Convert from gwei (API returns numbers in gwei)
        const maxPriorityFeePerGas = ethers.parseUnits(
          String(Math.ceil(data.fast.maxPriorityFee)),
          "gwei"
        );
        const maxFeePerGas = ethers.parseUnits(
          String(Math.ceil(data.fast.maxFee)),
          "gwei"
        );

        console.log(`[Gas] Using Polygon Gas Station (attempt ${attempt})`);
        return {
          maxFeePerGas,
          maxPriorityFeePerGas,
          gasPrice: null, // EIP-1559
        };
      } catch (err: any) {
        const isInternalError =
          err?.code === "SERVER_ERROR" ||
          err?.error?.code === -32000 ||
          err?.message?.includes("internal error") ||
          err?.shortMessage?.includes("coalesce");

        console.warn(
          `[Gas] Gas Station failed (attempt \( {attempt}/ \){retries}):`,
          err?.shortMessage || err?.message || err
        );

        if (attempt < retries && isInternalError) {
          await new Promise((r) => setTimeout(r, retryDelayMs * attempt));
          continue;
        }
        // Fall through to provider fallback
        break;
      }
    }
  }

  // --- 2. Fallback: provider.getFeeData() ---
  try {
    const feeData = await provider.getFeeData();
    if (feeData.maxFeePerGas && feeData.maxPriorityFeePerGas) {
      console.log("[Gas] Using provider.getFeeData()");
      return feeData;
    }
  } catch (err) {
    console.warn("[Gas] provider.getFeeData() also failed:", err);
  }

  // --- 3. Last resort: safe static values for Polygon ---
  // These are deliberately conservative (usually still cheap)
  console.log("[Gas] Using static fallback values");
  return {
    maxFeePerGas: ethers.parseUnits("80", "gwei"),        // max you're willing to pay
    maxPriorityFeePerGas: ethers.parseUnits("40", "gwei"), // tip
    gasPrice: null,
  };
}