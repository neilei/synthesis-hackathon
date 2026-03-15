/**
 * One-time script: approve USDC for Permit2 on Sepolia.
 * Run: npx tsx packages/agent/scripts/approve-permit2.ts
 *
 * @module @veil/agent/scripts/approve-permit2
 */
import { createWalletClient, createPublicClient, http, parseAbi, maxUint256 } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(import.meta.dirname, "..", "..", "..", ".env") });

const USDC = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238" as const;
const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3" as const;

const key = process.env.AGENT_PRIVATE_KEY;
if (!key || !key.startsWith("0x")) {
  console.error("AGENT_PRIVATE_KEY not set");
  process.exit(1);
}

const account = privateKeyToAccount(key as `0x${string}`);
const transport = http();

const publicClient = createPublicClient({ chain: sepolia, transport });
const walletClient = createWalletClient({ chain: sepolia, account, transport });

// Check current allowance
const erc20Abi = parseAbi([
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);

const currentAllowance = await publicClient.readContract({
  address: USDC,
  abi: erc20Abi,
  functionName: "allowance",
  args: [account.address, PERMIT2],
});

console.log(`Current USDC→Permit2 allowance: ${currentAllowance}`);

if (currentAllowance > 0n) {
  console.log("Already approved. Nothing to do.");
  process.exit(0);
}

console.log("Sending approve(Permit2, maxUint256)...");
const txHash = await walletClient.writeContract({
  address: USDC,
  abi: erc20Abi,
  functionName: "approve",
  args: [PERMIT2, maxUint256],
});

console.log(`Tx sent: ${txHash}`);
console.log("Waiting for confirmation...");

const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
console.log(`Confirmed in block ${receipt.blockNumber}, status: ${receipt.status}`);
