// CachedProvider.js
import { JsonRpcProvider, formatEther, parseEther } from "ethers";

export class CachedProvider extends JsonRpcProvider {
  constructor(url, options = {}) {
    super(url, undefined, options);

    // Internal cache
    this._cache = new Map();

    // Local balance tracking (in wei, bigint)
    this._localBalance = null;          // set only after init()
    this._balanceAddress = null;        // the address we care about

    // TTLs in ms
    this.ttls = {
      feeData: 8_000,
      blockNumber: 3_000,
      nonce: 60_000,
      // balance is intentionally NOT cached with a TTL
    };
  }

  // ─────────────────────────────────────────────
  // Lifecycle – the ONLY places balance is fetched
  // ─────────────────────────────────────────────

  /** Call once when the bot starts */
  async init(address) {
    this._balanceAddress = address.toLowerCase();
    const bal = await super.getBalance(this._balanceAddress);
    this._localBalance = bal;
    console.log(`[CachedProvider] Initial balance: ${formatEther(bal)} ETH`);
    return bal;
  }

  /** Call when the bot is shutting down */
  async stop() {
    if (!this._balanceAddress) return null;
    const bal = await super.getBalance(this._balanceAddress);
    console.log(`[CachedProvider] Final balance: ${formatEther(bal)} ETH`);
    this._localBalance = bal;
    return bal;
  }

  // ─────────────────────────────────────────────
  // Balance – never hits RPC after init()
  // ─────────────────────────────────────────────

  async getBalance(address, blockTag = "latest") {
    const addr = address.toLowerCase();

    // Only allow the real call for the tracked address on init/stop
    // (we already handled those in init/stop)
    if (this._localBalance === null) {
      throw new Error("CachedProvider: call init(address) before using getBalance");
    }

    if (addr !== this._balanceAddress) {
      // If you ever need another address, force a real call
      return super.getBalance(addr, blockTag);
    }

    // Always return the locally tracked value
    return this._localBalance;
  }

  /** Manually adjust the local balance (call after you send a tx) */
  adjustBalance(deltaWei) {
    if (this._localBalance === null) return;
    this._localBalance += BigInt(deltaWei);
    // prevent negative (optional safety)
    if (this._localBalance < 0n) this._localBalance = 0n;
  }

  /** Convenience: subtract gas cost after a successful send */
  recordSpent(gasUsed, effectiveGasPrice) {
    const cost = BigInt(gasUsed) * BigInt(effectiveGasPrice);
    this.adjustBalance(-cost);
  }

  // ─────────────────────────────────────────────
  // Nonce – local management
  // ─────────────────────────────────────────────

  async getTransactionCount(address, blockTag = "latest") {
    const key = `nonce:${address.toLowerCase()}`;
    const cached = this._get(key);
    if (cached !== null) return cached;

    const nonce = await super.getTransactionCount(address, blockTag);
    this._set(key, nonce, this.ttls.nonce);
    return nonce;
  }

  /** Call this right after you successfully broadcast a tx */
  bumpNonce(address) {
    const key = `nonce:${address.toLowerCase()}`;
    const current = this._get(key);
    if (current !== null) {
      this._set(key, current + 1, this.ttls.nonce);
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

  async getBlockNumber() {
    const key = "blockNumber";
    const cached = this._get(key);
    if (cached !== null) return cached;

    const n = await super.getBlockNumber();
    this._set(key, n, this.ttls.blockNumber);
    return n;
  }

  // ─────────────────────────────────────────────
  // Internal helpers
  // ─────────────────────────────────────────────

  _get(key) {
    const entry = this._cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expires) {
      this._cache.delete(key);
      return null;
    }
    return entry.value;
  }

  _set(key, value, ttlMs) {
    this._cache.set(key, { value, expires: Date.now() + ttlMs });
  }

  /** Force clear everything (useful on network switch, etc.) */
  clearCache() {
    this._cache.clear();
  }
}