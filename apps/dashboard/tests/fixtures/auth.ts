/**
 * Playwright auth fixture. Generates a test wallet, authenticates against
 * the real agent server, and injects the session token so the dashboard
 * starts in an authenticated state with the mock wagmi connector.
 *
 * Usage:
 *   import { test, expect, gotoAuthenticated } from "../fixtures/auth";
 *
 *   test("something requiring auth", async ({ page, auth }) => {
 *     // auth.wallet  — lowercase 0x address
 *     // auth.token   — bearer token for API calls
 *     await gotoAuthenticated(page, "/", auth);
 *   });
 *
 * @module @veil/dashboard/tests/fixtures/auth
 */
import { test as base, type Page } from "@playwright/test";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const agentPort = process.env.AGENT_PORT || "3148";
const AGENT_URL = process.env.AGENT_URL ?? `http://localhost:${agentPort}`;

export interface AuthFixture {
  wallet: string;
  token: string;
}

export const test = base.extend<{ auth: AuthFixture }>({
  auth: async ({ page }, use) => {
    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);

    // Step 1: Fetch nonce from agent server
    const nonceRes = await fetch(
      `${AGENT_URL}/api/auth/nonce?wallet=${account.address}`,
    );
    if (!nonceRes.ok) {
      const body = await nonceRes.text().catch(() => "");
      throw new Error(`Nonce fetch failed: ${nonceRes.status} ${body}`);
    }
    const { nonce } = (await nonceRes.json()) as { nonce: string };

    // Step 2: Sign the nonce message (same format as auth route)
    const message = `Sign this message to authenticate with Veil.\n\nNonce: ${nonce}`;
    const signature = await account.signMessage({ message });

    // Step 3: Verify signature to get bearer token
    const verifyRes = await fetch(`${AGENT_URL}/api/auth/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wallet: account.address, signature }),
    });
    if (!verifyRes.ok) {
      const body = await verifyRes.text().catch(() => "");
      throw new Error(`Auth verify failed: ${verifyRes.status} ${body}`);
    }
    const { token } = (await verifyRes.json()) as { token: string };

    // Step 4: Inject auth token into sessionStorage via addInitScript
    await page.addInitScript(
      ({ wallet, tkn }: { wallet: string; tkn: string }) => {
        sessionStorage.setItem(
          "veil_auth_token",
          JSON.stringify({ wallet: wallet.toLowerCase(), token: tkn }),
        );
      },
      { wallet: account.address, tkn: token },
    );

    // eslint-disable-next-line react-hooks/rules-of-hooks -- Playwright fixture callback, not a React hook
    await use({ wallet: account.address.toLowerCase(), token });
  },
});

/**
 * Navigate to a page with auth credentials pre-seeded in sessionStorage.
 * The addInitScript from the fixture handles injection on every navigation,
 * so this is a convenience wrapper that just navigates.
 */
export async function gotoAuthenticated(
  page: Page,
  path: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  auth: AuthFixture,
): Promise<void> {
  await page.goto(path);
}

export { expect } from "@playwright/test";
