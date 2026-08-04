import { ethers, FeeData } from "ethers";

/**
 * Robust, chain-agnostic gas fee estimator
 *
 * Strategy:
 * 1. Optional custom gas-station URL (if provided)
 * 2. provider.getFeeData()
 * 3. Configurable static fallback (or throw)
 */

interface GasStationResponse {
  fast?: {
    maxPriorityFee?: number;
    maxPriorityFeePerGas?: number;
    maxFee?: number;
    maxFeePerGas?: number;
  };
}

function makeFeeData(
  maxFeePerGas: bigint | null,
  maxPriorityFeePerGas: bigint | null,
  gasPrice: bigint | null = null
): FeeData {
  return {
    maxFeePerGas,
    maxPriorityFeePerGas,
    gasPrice,
    toJSON() {
      return {
        maxFeePerGas: this.maxFeePerGas?.toString() ?? null,
        maxPriorityFeePerGas: this.maxPriorityFeePerGas?.toString() ?? null,
        gasPrice: this.gasPrice?.toString() ?? null,
      };
    },
  } as FeeData;
}

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

        const data = (await res.json()) as GasStationResponse;

        // Expect the common shape: { fast: { maxFee, maxPriorityFee } } (values in gwei)
        const maxPriorityFeePerGas = ethers.parseUnits(
          String(
            Math.ceil(
              data.fast?.maxPriorityFee ?? data.fast?.maxPriorityFeePerGas ?? 30
            )
          ),
          "gwei"
        );
        const maxFeePerGas = ethers.parseUnits(
          String(Math.ceil(data.fast?.maxFee ?? data.fast?.maxFeePerGas ?? 50)),
          "gwei"
        );

        console.log(`[Gas] Using gas station (attempt ${attempt})`);
        return makeFeeData(maxFeePerGas, maxPriorityFeePerGas, null);
      } catch (err: any) {
        console.warn(
          `[Gas] Gas station failed (attempt ${attempt}/${retries}):`,
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
      return makeFeeData(
        feeData.gasPrice,
        feeData.gasPrice / 2n, // conservative tip
        feeData.gasPrice
      );
    }
  } catch (err) {
    console.warn("[Gas] provider.getFeeData() failed:", err);
  }

  // --- 3. Static fallback (or fail) ---
  if (staticFallback) {
    console.log("[Gas] Using static fallback values");
    return makeFeeData(
      ethers.parseUnits(String(staticFallback.maxFeePerGasGwei), "gwei"),
      ethers.parseUnits(String(staticFallback.maxPriorityFeePerGasGwei), "gwei"),
      null
    );
  }

  throw new Error("Unable to obtain fee data from any source");
}
