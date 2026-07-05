import { ethers } from "ethers";

async function main() {
  const [signer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(signer.address);
  
  console.log("👤 Wallet Address:", signer.address);
  console.log("💰 Balance:", ethers.formatEther(balance), "ETH");
  console.log("💰 Balance (Wei):", balance.toString());
  
  // Get network info
  const network = await ethers.provider.getNetwork();
  console.log("📡 Network:", network.name);
  console.log("🔗 Chain ID:", network.chainId.toString());
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
