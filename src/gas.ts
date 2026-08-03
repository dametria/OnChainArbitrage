import { ethers, FeeData } from "ethers";

/**
 * Robust, chain-agnostic gas fee estimator
 *
 * Strategy:
 * 1. Optional custom gas-station URL (if provided)
 * 2. provider.getFeeData()
 * 3. Configurable static fallback (or throw)
 */
export async function getFeeData(
  provider: ethers.Provider,
  options: {
    retries?: number;
    retryDelayMs?: number;
    /** Optional chain-specific gas station endpoint (e.g. Polygon Gas Station) */
    gasStationUrl?: string;
    /** Prefer the gas station when a URL is supplied (default: true) */
    preferGasStation?: boolean;
    /**
     * Static fallback values (in gwei).
     * Set to null/undefined to disable the static fallback and throw instead.
     */
    staticFallback?: {
      maxFeePerGasGwei: number;
      maxPriorityFeePerGasGwei: number;
    } | null;
  } = {}
): Promise<FeeData> {
  const {
    retries = 3,
    retryDelayMs = 800,
    gasStationUrl,
    preferGasStation = true,
    staticFallback = {
      maxFeePerGasGwei: 50,
      maxPriorityFeePerGasGwei: 30,
    },
  } = options;

  // --- 1. Optional external gas station (with retries) ---
  if (preferGasStation && gasStationUrl) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const res = await fetch(gasStationUrl, {
          signal: AbortSignal.timeout(4000),
        });

        if (!res.ok) throw new Error(`Gas Station HTTP ${res.status}`);

        const data = await res.json();

        // Expect the common shape: { fast: { maxFee, maxPriorityFee } } (values in gwei)
        const maxPriorityFeePerGas = ethers.parseUnits(
          String(Math.ceil(data.fast?.maxPriorityFee ?? data.fast?.maxPriorityFeePerGas)),
          "gwei"
        );
        const maxFeePerGas = ethers.parseUnits(
          String(Math.ceil(data.fast?.maxFee ?? data.fast?.maxFeePerGas)),
          "gwei"
        );

        console.log(`[Gas] Using gas station (attempt ${attempt})`);
        return {
          maxFeePerGas,
          maxPriorityFeePerGas,
          gasPrice: null, // EIP-1559 style
        };
      } catch (err: any) {
        console.warn(
          `[Gas] Gas station failed (attempt \( {attempt}/ \){retries}):`,
          err?.shortMessage || err?.message || err
        );

        if (attempt < retries) {
          await new Promise((r) => setTimeout(r, retryDelayMs * attempt));
          continue;
        }
        // Fall through to provider
        break;
      }
    }
  }

  // --- 2. Primary: provider.getFeeData() ---
  try {
    const feeData = await provider.getFeeData();

    // Prefer EIP-1559 fields when available
    if (feeData.maxFeePerGas && feeData.maxPriorityFeePerGas) {
      console.log("[Gas] Using provider.getFeeData() (EIP-1559)");
      return feeData;
    }

    // Fallback to legacy gasPrice if the chain/provider only returns that
    if (feeData.gasPrice) {
      console.log("[Gas] Using provider.getFeeData() (legacy gasPrice)");
      return {
        maxFeePerGas: feeData.gasPrice,
        maxPriorityFeePerGas: feeData.gasPrice / 2n, // conservative tip
        gasPrice: feeData.gasPrice,
      };
    }
  } catch (err) {
    console.warn("[Gas] provider.getFeeData() failed:", err);
  }

  // --- 3. Static fallback (or fail) ---
  if (staticFallback) {
    console.log("[Gas] Using static fallback values");
    return {
      maxFeePerGas: ethers.parseUnits(String(staticFallback.maxFeePerGasGwei), "gwei"),
      maxPriorityFeePerGas: ethers.parseUnits(
        String(staticFallback.maxPriorityFeePerGasGwei),
        "gwei"
      ),
      gasPrice: null,
    };
  }

  throw new Error("Unable to obtain fee data from any source");
}