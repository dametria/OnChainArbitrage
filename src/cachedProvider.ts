/**
 * CachedProvider – aggressive caching wrapper around ethers JsonRpcProvider
 *
 * - eth_getBalance is called ONLY on init() and stop()
 * - During normal operation a local balance is tracked and returned
 * - Nonce, fee data and block number are cached with short TTLs
 * - Local nonce bumping after sending transactions
 */

import { JsonRpcProvider, Networkish } from "ethers";

interface CacheEntry {
  value: any;
  expires: number;
}

export class CachedProvider extends JsonRpcProvider {
  private _cache = new Map<string, CacheEntry>();

  /** Locally tracked balance in wei (bigint). Set only after init(). */
  private _localBalance: bigint | null = null;

  /** Address whose balance we are tracking */
  private _balanceAddress: string | null = null;

  /** Configurable TTLs (ms) */
  public ttls = {
    feeData: 8_000,
    blockNumber: 3_000,
    nonce: 60_000,
  };

  constructor(url: string, network?: Networkish) {
    super(url, network);
  }

  // ─────────────────────────────────────────────
  // Lifecycle – the ONLY places balance is fetched from RPC
  // ─────────────────────────────────────────────

  /**
   * Call once when the bot starts.
   * Performs the single real eth_getBalance call.
   */
  async init(address: string): Promise<bigint> {
    this._balanceAddress = address.toLowerCase();
    const bal = await super.getBalance(this._balanceAddress);
    this._localBalance = bal;
    return bal;
  }

  /**
   * Call when the bot is shutting down.
   * Performs the second (and last) real eth_getBalance call.
   */
  async stop(): Promise<bigint | null> {
    if (!this._balanceAddress) return null;
    const bal = await super.getBalance(this._balanceAddress);
    this._localBalance = bal;
    return bal;
  }

  // ─────────────────────────────────────────────
  // Balance – never hits RPC after init()
  // ─────────────────────────────────────────────

  async getBalance(address: string, blockTag: any = "latest"): Promise<bigint> {
    const addr = address.toLowerCase();

    if (this._localBalance === null) {
      throw new Error(
        "CachedProvider: call init(address) before using getBalance during normal operation"
      );
    }

    if (addr === this._balanceAddress) {
      return this._localBalance;
    }

    // Any other address still goes to the RPC (rare)
    return super.getBalance(addr, blockTag);
  }

  /** Manually adjust the local balance (positive or negative wei) */
  adjustBalance(deltaWei: bigint | number | string): void {
    if (this._localBalance === null) return;
    this._localBalance += BigInt(deltaWei);
    if (this._localBalance < 0n) this._localBalance = 0n;
  }

  /**
   * Convenience: subtract the gas cost of a confirmed transaction
   * from the local balance.
   */
  recordSpent(gasUsed: bigint | number, effectiveGasPrice: bigint | number): void {
    const cost = BigInt(gasUsed) * BigInt(effectiveGasPrice);
    this.adjustBalance(-cost);
  }

  // ─────────────────────────────────────────────
  // Nonce – cached + local bumping
  // ─────────────────────────────────────────────

  async getTransactionCount(
    address: string,
    blockTag: any = "latest"
  ): Promise<number> {
    const key = `nonce:${address.toLowerCase()}`;
    const cached = this._get(key);
    if (cached !== null) return cached as number;

    const nonce = await super.getTransactionCount(address, blockTag);
    this._set(key, nonce, this.ttls.nonce);
    return nonce;
  }

  /** Call immediately after a transaction is successfully broadcast */
  bumpNonce(address: string): void {
    const key = `nonce:${address.toLowerCase()}`;
    const current = this._get(key);
    if (current !== null) {
      this._set(key, (current as number) + 1, this.ttls.nonce);
    }
  }

  // ─────────────────────────────────────────────
  // Fee data & block number
  // ─────────────────────────────────────────────

  async getFeeData() {
    const key = "feeData";
    const cached = this._get(key);
    if (cached !== null) return cached;

    const fee = await super.getFeeData();
    this._set(key, fee, this.ttls.feeData);
    return fee;
  }

  async getBlockNumber(): Promise<number> {
    const key = "blockNumber";
    const cached = this._get(key);
    if (cached !== null) return cached as number;

    const n = await super.getBlockNumber();
    this._set(key, n, this.ttls.blockNumber);
    return n;
  }

  // ─────────────────────────────────────────────
  // Internal helpers
  // ─────────────────────────────────────────────

  private _get(key: string): any {
    const entry = this._cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expires) {
      this._cache.delete(key);
      return null;
    }
    return entry.value;
  }

  private _set(key: string, value: any, ttlMs: number): void {
    this._cache.set(key, { value, expires: Date.now() + ttlMs });
  }

  /** Clear all cached values (useful on network change etc.) */
  clearCache(): void {
    this._cache.clear();
  }
}