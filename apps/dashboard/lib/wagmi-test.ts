/**
 * Test-mode wagmi config using the built-in mock connector.
 * Activated when NEXT_PUBLIC_TEST_WALLET is set.
 */
import { http, createConfig } from "wagmi";
import { sepolia } from "wagmi/chains";
import { mock } from "wagmi/connectors";

const testWallet = process.env.NEXT_PUBLIC_TEST_WALLET as
  | `0x${string}`
  | undefined;

export const testWagmiConfig = testWallet
  ? createConfig({
      chains: [sepolia],
      connectors: [
        mock({
          accounts: [testWallet],
          features: { defaultConnected: true },
        }),
      ],
      transports: {
        [sepolia.id]: http(),
      },
    })
  : null;
