/**
 * E2E verification: create an intent via API and confirm identity.json works.
 * Run: cd packages/agent && npx tsx ../../scripts/verify-identity-json.ts
 */
import { privateKeyToAccount } from "viem/accounts";
import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = typeof import.meta.dirname === "string"
  ? import.meta.dirname
  : dirname(fileURLToPath(import.meta.url));

config({ path: resolve(__dirname, "..", ".env") });

const account = privateKeyToAccount(
  process.env.AGENT_PRIVATE_KEY as `0x${string}`,
);
const BASE = "https://api.maw.finance";

async function main() {
  // Step 1: Get nonce
  const nonceRes = await fetch(
    `${BASE}/api/auth/nonce?wallet=${account.address}`,
  );
  const { nonce } = (await nonceRes.json()) as { nonce: string };
  console.log("1. Nonce obtained:", nonce.slice(0, 16) + "...");

  // Step 2: Sign nonce
  const message = `Sign this message to authenticate with Maw.\n\nNonce: ${nonce}`;
  const signature = await account.signMessage({ message });
  console.log("2. Nonce signed");

  // Step 3: Verify -> get token
  const verifyRes = await fetch(`${BASE}/api/auth/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ wallet: account.address, signature }),
  });
  const verifyBody = (await verifyRes.json()) as {
    token?: string;
    error?: string;
  };
  if (!verifyBody.token) {
    console.error("Auth failed:", verifyBody);
    process.exit(1);
  }
  console.log("3. Auth token obtained");

  // Step 4: Create intent
  const intentRes = await fetch(`${BASE}/api/intents`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${verifyBody.token}`,
    },
    body: JSON.stringify({
      intentText: "60/40 ETH/USDC, $100/day, 7 days",
      parsedIntent: {
        targetAllocation: { ETH: 0.6, USDC: 0.4 },
        dailyBudgetUsd: 100,
        timeWindowDays: 7,
        maxTradesPerDay: 5,
        maxPerTradeUsd: 100,
        maxSlippage: 0.005,
        driftThreshold: 0.05,
      },
      permissions: JSON.stringify([{ type: "native-token-periodic", context: "0x00", token: "ETH" }]),
      delegationManager: account.address,
      dependencies: "[]",
    }),
  });
  const intentBody = (await intentRes.json()) as {
    intent?: { id: string };
    error?: string;
  };
  if (!intentBody.intent?.id) {
    console.error("Intent creation failed:", intentBody);
    process.exit(1);
  }
  const intentId = intentBody.intent.id;
  console.log("4. Intent created:", intentId);

  // Step 5: Fetch identity.json (NO auth header)
  const idRes = await fetch(
    `${BASE}/api/intents/${intentId}/identity.json`,
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const idBody = (await idRes.json()) as any;
  console.log("5. Identity.json response (status " + idRes.status + "):");
  console.log(JSON.stringify(idBody, null, 2));

  // Step 6: Validate
  const checks: [string, boolean][] = [
    ["status is 200", idRes.status === 200],
    [
      "type is registration-v1",
      idBody.type ===
        "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    ],
    [
      "name contains id prefix",
      idBody.name?.includes(intentId.slice(0, 8)),
    ],
    [
      "description contains allocation",
      idBody.description?.includes("60% ETH"),
    ],
    ["active is true", idBody.active === true],
    [
      "services array",
      Array.isArray(idBody.services) && idBody.services.length > 0,
    ],
    ["supportedTrust", Array.isArray(idBody.supportedTrust)],
    [
      "cache-control header",
      idRes.headers.get("cache-control")?.includes("public") ?? false,
    ],
  ];

  console.log("\n--- Verification ---");
  let allPassed = true;
  for (const [name, passed] of checks) {
    console.log(`  ${passed ? "PASS" : "FAIL"}: ${name}`);
    if (!passed) allPassed = false;
  }

  // Cleanup: cancel the intent
  await fetch(`${BASE}/api/intents/${intentId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${verifyBody.token}` },
  });
  console.log("\n6. Test intent cancelled (cleanup)");

  if (!allPassed) {
    console.error("\nSome checks FAILED");
    process.exit(1);
  }
  console.log("\nAll checks PASSED");
}

main();
