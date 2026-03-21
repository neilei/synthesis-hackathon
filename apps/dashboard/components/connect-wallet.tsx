"use client";

import { useAccount, useConnect, useDisconnect } from "wagmi";
import { truncateAddress } from "@maw/common";
import { Button } from "./ui/button";

export function ConnectWallet() {
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();

  if (isConnected && address) {
    return (
      <div className="flex items-center gap-3">
        <span className="font-mono text-xs text-text-secondary">
          {truncateAddress(address)}
        </span>
        <Button onClick={() => disconnect()}>
          Disconnect
        </Button>
      </div>
    );
  }

  return (
    <Button
      variant="outline"
      onClick={() => {
        const injected = connectors.find((c) => c.id === "injected");
        if (injected) connect({ connector: injected });
      }}
      disabled={isPending}
      className="bg-accent-positive/10 border-accent-positive/20"
    >
      {isPending ? "Connecting..." : "Connect Wallet"}
    </Button>
  );
}
