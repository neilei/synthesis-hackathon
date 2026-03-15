/**
 * Debug script: test the full ERC-7710 delegation flow end-to-end on Sepolia.
 * Creates smart account, deploys, funds, delegates, quotes via Uniswap, and redeems.
 * Run: npx tsx packages/agent/scripts/debug-delegation.ts
 *
 * @module @veil/agent/scripts/debug-delegation
 */
import {
  createPublicClient,
  createWalletClient,
  http,
  formatEther,
  encodePacked,
  type Hex,
  type Address,
} from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { sepolia } from "viem/chains";
import { config } from "dotenv";
import { resolve } from "path";
import {
  createDelegation,
  getSmartAccountsEnvironment,
  toMetaMaskSmartAccount,
  Implementation,
  createExecution,
  ExecutionMode,
} from "@metamask/smart-accounts-kit";
import { DelegationManager } from "@metamask/smart-accounts-kit/contracts";

config({ path: resolve(import.meta.dirname, "..", "..", "..", ".env") });

const agentKey = process.env.AGENT_PRIVATE_KEY as `0x${string}`;
const agentAccount = privateKeyToAccount(agentKey);
const publicClient = createPublicClient({ chain: sepolia, transport: http() });

console.log("Agent address:", agentAccount.address);

const agentBalance = await publicClient.getBalance({
  address: agentAccount.address,
});
console.log("Agent ETH balance:", formatEther(agentBalance));

// 1. Create delegator smart account
const delegatorKey = generatePrivateKey();
const delegatorEOA = privateKeyToAccount(delegatorKey);
console.log("Delegator EOA:", delegatorEOA.address);

const delegatorSmartAccount = await toMetaMaskSmartAccount({
  client: publicClient,
  implementation: Implementation.Hybrid,
  deployParams: [delegatorEOA.address, [], [], []],
  deploySalt: "0x",
  signer: { account: delegatorEOA },
});
console.log("Delegator Smart Account:", delegatorSmartAccount.address);

// 2. Deploy the smart account
const code = await publicClient.getCode({
  address: delegatorSmartAccount.address,
});
if (!code || code === "0x") {
  console.log("Deploying smart account...");
  const factoryArgs = await delegatorSmartAccount.getFactoryArgs();
  const walletClient = createWalletClient({
    account: agentAccount,
    chain: sepolia,
    transport: http(),
  });
  const deployTx = await walletClient.sendTransaction({
    to: factoryArgs.factory,
    data: factoryArgs.factoryData,
    chain: sepolia,
    account: agentAccount,
  });
  console.log("Deploy tx:", deployTx);
  const receipt = await publicClient.waitForTransactionReceipt({
    hash: deployTx,
  });
  console.log("Deploy status:", receipt.status, "block:", receipt.blockNumber);
} else {
  console.log("Smart account already deployed");
}

// 3. Fund the smart account with a small amount of ETH for the swap
const FUND_AMOUNT = 1_500_000_000_000_000n; // 0.0015 ETH
const saBalance = await publicClient.getBalance({
  address: delegatorSmartAccount.address,
});
console.log(
  "\nSmart account ETH balance:",
  formatEther(saBalance),
);

if (saBalance < FUND_AMOUNT) {
  console.log(`Funding smart account with ${formatEther(FUND_AMOUNT)} ETH...`);
  const walletClient = createWalletClient({
    account: agentAccount,
    chain: sepolia,
    transport: http(),
  });
  const fundTx = await walletClient.sendTransaction({
    to: delegatorSmartAccount.address,
    value: FUND_AMOUNT,
    chain: sepolia,
    account: agentAccount,
  });
  const fundReceipt = await publicClient.waitForTransactionReceipt({
    hash: fundTx,
  });
  console.log("Fund tx:", fundTx, "status:", fundReceipt.status);
} else {
  console.log("Smart account already has enough ETH");
}

// 4. Create a delegation with nativeTokenTransferAmount scope
const environment = getSmartAccountsEnvironment(sepolia.id);
console.log(
  "\nEnvironment DelegationManager:",
  environment.DelegationManager,
);

// Use functionCall scope — target the Uniswap Universal Router, allow execute() selector,
// and cap per-call ETH value. This is the proper delegation for DeFi swaps.
const UNISWAP_ROUTER = "0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b"; // Sepolia
const EXECUTE_SELECTOR = "0x3593564c"; // execute(bytes,bytes[],uint256)

const caveats = [
  {
    enforcer: environment.caveatEnforcers.TimestampEnforcer as Address,
    terms: encodePacked(
      ["uint128", "uint128"],
      [0n, BigInt(Math.floor(Date.now() / 1000) + 3600)], // 1 hour from now
    ),
    args: "0x" as Hex,
  },
];

const delegation = createDelegation({
  from: delegatorSmartAccount.address as Hex,
  to: agentAccount.address as Hex,
  environment,
  scope: {
    type: "functionCall" as const,
    targets: [UNISWAP_ROUTER],
    selectors: [EXECUTE_SELECTOR],
    valueLte: { maxValue: 10_000_000_000_000_000n }, // 0.01 ETH max per call
  },
  caveats,
});

console.log("\nDelegation created:");
console.log("  delegator:", delegation.delegator);
console.log("  delegate:", delegation.delegate);
console.log("  caveats:", delegation.caveats.length);
for (const c of delegation.caveats) {
  console.log("    enforcer:", c.enforcer, "terms length:", c.terms.length);
}

// 5. Sign the delegation
const signature = await delegatorSmartAccount.signDelegation({ delegation });
console.log("Signature:", signature.slice(0, 40) + "...");

const signedDelegation = { ...delegation, signature };

// Skip simple test — functionCall scope only allows calls to the Uniswap router.
// Go straight to the swap test.
const walletClient = createWalletClient({
  account: agentAccount,
  chain: sepolia,
  transport: http(),
});

// 7. Test: Execute a Uniswap swap through delegation
// Get a quote from Uniswap with the smart account as swapper
console.log("\n--- Test 2: Uniswap swap via delegation ---");

const UNISWAP_API_KEY = process.env.UNISWAP_API_KEY;
if (!UNISWAP_API_KEY) {
  console.error("UNISWAP_API_KEY not set");
  process.exit(1);
}

const NATIVE_ETH = "0x0000000000000000000000000000000000000000";
const USDC_SEPOLIA = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";
const SWAP_AMOUNT = "1000000000000000"; // 0.001 ETH in wei

console.log(
  `Getting Uniswap quote: 0.001 ETH (native) -> USDC (swapper: ${delegatorSmartAccount.address})`,
);

const quoteRes = await fetch("https://trade-api.gateway.uniswap.org/v1/quote", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-api-key": UNISWAP_API_KEY,
  },
  body: JSON.stringify({
    tokenIn: NATIVE_ETH,
    tokenOut: USDC_SEPOLIA,
    amount: SWAP_AMOUNT,
    type: "EXACT_INPUT",
    swapper: delegatorSmartAccount.address,
    tokenInChainId: 11155111,
    tokenOutChainId: 11155111,
    slippageTolerance: 5, // 5% for testnet
  }),
});

if (!quoteRes.ok) {
  const errText = await quoteRes.text();
  console.error("Quote failed:", quoteRes.status, errText);
  process.exit(1);
}

const quote = await quoteRes.json();
console.log(
  "Quote received:",
  quote.quote?.input?.amount,
  "->",
  quote.quote?.output?.amount,
);
console.log("Routing:", quote.routing);

// Get swap calldata (no permit needed for ETH sells)
const swapRes = await fetch("https://trade-api.gateway.uniswap.org/v1/swap", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-api-key": UNISWAP_API_KEY,
  },
  body: JSON.stringify({
    quote: quote.quote,
    simulateTransaction: false, // Can't simulate — will be called from smart account
  }),
});

if (!swapRes.ok) {
  const errText = await swapRes.text();
  console.error("Swap API failed:", swapRes.status, errText);
  process.exit(1);
}

const swapData = await swapRes.json();
console.log("Swap calldata to:", swapData.swap?.to);
console.log("Swap value:", swapData.swap?.value);
console.log(
  "Swap data length:",
  swapData.swap?.data?.length,
);

// Execute the swap through delegation redemption
const swapExecution = createExecution({
  target: swapData.swap.to as Hex,
  callData: swapData.swap.data as Hex,
  value: BigInt(swapData.swap.value || "0"),
});

const swapRedeemCalldata = DelegationManager.encode.redeemDelegations({
  delegations: [[signedDelegation]],
  modes: [ExecutionMode.SingleDefault],
  executions: [[swapExecution]],
});

console.log("\nSending Uniswap swap via delegation redemption...");
try {
  const swapTx = await walletClient.sendTransaction({
    to: environment.DelegationManager as Hex,
    data: swapRedeemCalldata,
    chain: sepolia,
    account: agentAccount,
  });
  console.log("Swap delegation tx:", swapTx);
  const receipt = await publicClient.waitForTransactionReceipt({
    hash: swapTx,
  });
  console.log("Status:", receipt.status, "gas:", receipt.gasUsed);

  if (receipt.status === "success") {
    console.log(
      "\n*****************************************************",
    );
    console.log(
      "*** UNISWAP SWAP VIA DELEGATION SUCCEEDED! ***",
    );
    console.log(
      "*****************************************************",
    );
    console.log(
      `Verify on Etherscan: https://sepolia.etherscan.io/tx/${swapTx}`,
    );
  } else {
    console.log("Swap tx was included but REVERTED on-chain");
  }
} catch (err) {
  console.error(
    "Swap delegation FAILED:",
    err instanceof Error ? err.message : err,
  );

  // If the swap fails, it might be because the nativeTokenTransferAmount scope
  // only allows pure ETH transfers, not contract calls with ETH value.
  // In that case, we need to use an unrestricted delegation.
  console.log(
    "\nRetrying with unrestricted delegation (no scope)...",
  );

  // Broader scope: same functionCall but higher value limit and wider selector
  const unrestrictedDelegation = createDelegation({
    from: delegatorSmartAccount.address as Hex,
    to: agentAccount.address as Hex,
    environment,
    scope: {
      type: "functionCall" as const,
      targets: [UNISWAP_ROUTER],
      selectors: [EXECUTE_SELECTOR],
      valueLte: { maxValue: 100_000_000_000_000_000n }, // 0.1 ETH max
    },
  });

  const unrestrictedSig = await delegatorSmartAccount.signDelegation({
    delegation: unrestrictedDelegation,
  });
  const signedUnrestricted = { ...unrestrictedDelegation, signature: unrestrictedSig };

  const unrestrictedCalldata = DelegationManager.encode.redeemDelegations({
    delegations: [[signedUnrestricted]],
    modes: [ExecutionMode.SingleDefault],
    executions: [[swapExecution]],
  });

  try {
    const tx2 = await walletClient.sendTransaction({
      to: environment.DelegationManager as Hex,
      data: unrestrictedCalldata,
      chain: sepolia,
      account: agentAccount,
    });
    console.log("Unrestricted delegation tx:", tx2);
    const receipt2 = await publicClient.waitForTransactionReceipt({
      hash: tx2,
    });
    console.log("Status:", receipt2.status, "gas:", receipt2.gasUsed);

    if (receipt2.status === "success") {
      console.log(
        "\n*****************************************************",
      );
      console.log(
        "*** UNRESTRICTED DELEGATION SWAP SUCCEEDED! ***",
      );
      console.log(
        "*****************************************************",
      );
      console.log(
        `Verify: https://sepolia.etherscan.io/tx/${tx2}`,
      );
    }
  } catch (err2) {
    console.error(
      "Unrestricted delegation also FAILED:",
      err2 instanceof Error ? err2.message : err2,
    );
  }
}
