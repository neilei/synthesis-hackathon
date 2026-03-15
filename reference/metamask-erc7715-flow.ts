/**
 * REFERENCE ONLY. MetaMask ERC-7715 (grant) + ERC-7710 (redeem) complete flow.
 * Source: MetaMask Smart Accounts Kit docs.
 *
 * @module @veil/reference/metamask-erc7715-flow
 */

// ============================================================
// STEP 0: Setup — Create session account + clients
// ============================================================

import { http, createPublicClient, createWalletClient } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { sepolia as chain } from "viem/chains";
import {
  erc7715ProviderActions,
  erc7710WalletActions,
} from "@metamask/smart-accounts-kit/actions";

// Session account: the agent's key. Created once, used forever.
const sessionPrivateKey = generatePrivateKey();
const sessionAccount = privateKeyToAccount(sessionPrivateKey);

// Wallet client for GRANTING (needs window.ethereum = MetaMask Flask)
// This runs IN THE BROWSER on the human's machine
export const grantWalletClient = createWalletClient({
  transport: custom(window.ethereum), // <-- MetaMask Flask required here
}).extend(erc7715ProviderActions());

// Wallet client for REDEEMING (server-side, no browser)
// This runs ON THE SERVER / in the agent
export const redeemWalletClient = createWalletClient({
  account: sessionAccount,
  transport: http(), // <-- Plain HTTP RPC, no MetaMask needed
  chain,
}).extend(erc7710WalletActions());

export const publicClient = createPublicClient({
  chain,
  transport: http(),
});

// ============================================================
// STEP 1: GRANT — Human approves via MetaMask Flask popup (ONE TIME)
// This is the ERC-7715 part. Runs in the browser.
// ============================================================

import { parseUnits } from "viem";

const currentTime = Math.floor(Date.now() / 1000);
const expiry = currentTime + 604800; // 1 week

// USDC address on Ethereum Sepolia
const tokenAddress = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";

const grantedPermissions = await grantWalletClient.requestExecutionPermissions([
  {
    chainId: chain.id,
    expiry,
    signer: {
      type: "account",
      data: {
        // The agent's session account gets the permissions
        address: sessionAccount.address,
      },
    },
    permission: {
      type: "erc20-token-periodic",
      data: {
        tokenAddress,
        // 10 USDC per day
        periodAmount: parseUnits("10", 6),
        // 1 day in seconds
        periodDuration: 86400,
        justification:
          "Permission to transfer up to 10 USDC per day for portfolio rebalancing",
      },
    },
    isAdjustmentAllowed: true, // User can modify in the MetaMask UI
  },
]);

// Save these — the agent needs them for every future transaction
const permissionsContext = grantedPermissions[0].context;
const delegationManager = grantedPermissions[0].signerMeta.delegationManager;

// ============================================================
// STEP 2: REDEEM — Agent executes server-side (NO BROWSER)
// This is the ERC-7710 part. Runs programmatically.
// ============================================================

// Option A: EOA session account (simpler)
const transactionHash =
  await redeemWalletClient.sendTransactionWithDelegation({
    to: tokenAddress,
    data: calldata, // ERC-20 transfer calldata
    permissionsContext,
    delegationManager,
  });

// Option B: Smart account session (needs bundler)
// import { erc7710BundlerActions } from "@metamask/smart-accounts-kit/actions";
// const bundlerClient = createBundlerClient({...}).extend(erc7710BundlerActions());
//
// const userOperationHash = await bundlerClient.sendUserOperationWithDelegation({
//   publicClient,
//   account: sessionAccount,
//   calls: [{
//     to: tokenAddress,
//     data: calldata,
//     permissionsContext,
//     delegationManager,
//   }],
//   maxFeePerGas: 1n,
//   maxPriorityFeePerGas: 1n,
// });

// ============================================================
// FOR VEIL: The Architecture
// ============================================================
// 1. Build a tiny Next.js/React page that runs STEP 1 (grant)
//    - Human opens it in Chrome with MetaMask Flask installed
//    - Human approves the permissions
//    - Page saves permissionsContext + delegationManager to a file / env var
//
// 2. Agent (Node.js server-side) runs STEP 2 (redeem) whenever it trades
//    - Loads permissionsContext from file
//    - Calls sendTransactionWithDelegation or sendUserOperationWithDelegation
//    - No browser, no popup, fully autonomous
//
// This is the CORRECT way to use ERC-7715 for an AI agent hackathon.
// The grant is the human-in-the-loop moment. The redemption is autonomous.
