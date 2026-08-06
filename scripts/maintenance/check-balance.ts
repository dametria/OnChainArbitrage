/**
 * Check wallet balance
 * Works both under Hardhat and as a standalone ethers script.
 */
import { ethers } from "ethers";
import * as dotenv from "dotenv";
dotenv.config();

async function main() {
  // Prefer Hardhat if available, otherwise pure ethers + env
  let address: string;
  let balance: bigint;
  let networkName: string;
  let chainId: bigint | number;

  try {
    // Dynamic import so the file still type-checks when hardhat is not the resolver
    const hardhat = await import("hardhat").catch(() => null);
    if (hardhat?.ethers) {
      const [signer] = await hardhat.ethers.getSigners();
      address = await signer.getAddress();
      balance = await hardhat.ethers.provider.getBalance(address);
      const network = await hardhat.ethers.provider.getNetwork();
      networkName = network.name;
      chainId = network.chainId;
    } else {
      throw new Error("Hardhat not available");
    }
  } catch {
    const rpcUrl =
      process.env.POLYGON_RPC_URL ||
      process.env.BSC_RPC_URL ||
      process.env.BASE_RPC_URL ||
      process.env.SEPOLIA_RPC_URL ||
      "";
    const privateKey = process.env.PRIVATE_KEY || "";
    if (!rpcUrl || !privateKey) {
      throw new Error(
        "Set POLYGON_RPC_URL (or other) and PRIVATE_KEY, or run via Hardhat"
      );
    }
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const wallet = new ethers.Wallet(privateKey, provider);
    address = wallet.address;
    balance = await provider.getBalance(address);
    const network = await provider.getNetwork();
    networkName = network.name;
    chainId = network.chainId;
  }

  console.log("👤 Wallet Address:", address);
  console.log("💰 Balance:", ethers.formatEther(balance), "ETH");
  console.log("💰 Balance (Wei):", balance.toString());
  console.log("📡 Network:", networkName);
  console.log("🔗 Chain ID:", chainId.toString());
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
