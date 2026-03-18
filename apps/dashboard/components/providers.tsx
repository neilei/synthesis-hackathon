"use client";

import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { wagmiConfig } from "@/lib/wagmi";
import { testWagmiConfig } from "@/lib/wagmi-test";
import { useState } from "react";
import { AuthProvider } from "@/hooks/use-auth";

const config =
  process.env.NEXT_PUBLIC_TEST_WALLET && testWagmiConfig
    ? testWagmiConfig
    : wagmiConfig;

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>{children}</AuthProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
