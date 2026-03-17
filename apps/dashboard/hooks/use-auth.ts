"use client";

import { useState, useCallback, useEffect } from "react";
import { useAccount, useSignMessage } from "wagmi";
import { fetchNonce, verifySignature } from "@/lib/api";

export function useAuth() {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [token, setToken] = useState<string | null>(null);
  const [authenticating, setAuthenticating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const authenticate = useCallback(async () => {
    if (!address) return;
    setAuthenticating(true);
    setError(null);
    try {
      const nonce = await fetchNonce(address);
      const message = `Sign this message to authenticate with Veil.\n\nNonce: ${nonce}`;
      const signature = await signMessageAsync({ message });
      const authToken = await verifySignature(address, signature);
      setToken(authToken);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Auth failed";
      setError(msg);
      setToken(null);
    } finally {
      setAuthenticating(false);
    }
  }, [address, signMessageAsync]);

  // Clear token on disconnect
  useEffect(() => {
    if (!isConnected) {
      setToken(null);
      setError(null);
    }
  }, [isConnected]);

  // Auto-authenticate when wallet connects (guard on error to prevent infinite retry)
  useEffect(() => {
    if (isConnected && address && !token && !authenticating && !error) {
      authenticate();
    }
  }, [isConnected, address, token, authenticating, error, authenticate]);

  return {
    token,
    isAuthenticated: token !== null,
    authenticating,
    authenticate,
    walletAddress: address,
    error,
  };
}
