"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from "react";
import { useAccount, useSignMessage } from "wagmi";
import { fetchNonce, verifySignature } from "@/lib/api";

const STORAGE_KEY = "maw_auth_token";

interface AuthState {
  token: string | null;
  isAuthenticated: boolean;
  authenticating: boolean;
  authenticate: () => Promise<void>;
  walletAddress: `0x${string}` | undefined;
  error: string | null;
}

const AuthContext = createContext<AuthState | null>(null);

function readStoredToken(address: string): string | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const stored: { wallet: string; token: string } = JSON.parse(raw);
    if (stored.wallet.toLowerCase() !== address.toLowerCase()) return null;
    return stored.token;
  } catch {
    return null;
  }
}

function writeStoredToken(address: string, token: string): void {
  try {
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ wallet: address.toLowerCase(), token }),
    );
  } catch {
    // sessionStorage unavailable (SSR, private browsing quota) — silent fail
  }
}

function clearStoredToken(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // silent
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [token, setToken] = useState<string | null>(null);
  const [authenticating, setAuthenticating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  // Rehydrate token from sessionStorage on mount / wallet change
  useEffect(() => {
    if (address) {
      const stored = readStoredToken(address);
      if (stored) {
        setToken(stored);
        setError(null);
      } else {
        setToken(null);
      }
    } else {
      setToken(null);
    }
    setHydrated(true);
  }, [address]);

  const authenticate = useCallback(async () => {
    if (!address) return;
    setAuthenticating(true);
    setError(null);
    try {
      const nonce = await fetchNonce(address);
      const message = `Sign this message to authenticate with Maw.\n\nNonce: ${nonce}`;
      const signature = await signMessageAsync({ message });
      const authToken = await verifySignature(address, signature);
      setToken(authToken);
      writeStoredToken(address, authToken);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Auth failed";
      setError(msg);
      setToken(null);
      clearStoredToken();
    } finally {
      setAuthenticating(false);
    }
  }, [address, signMessageAsync]);

  // Clear token on disconnect
  useEffect(() => {
    if (!isConnected) {
      setToken(null);
      setError(null);
      clearStoredToken();
    }
  }, [isConnected]);

  // Auto-authenticate when wallet connects and no stored token exists
  useEffect(() => {
    if (hydrated && isConnected && address && !token && !authenticating && !error) {
      authenticate();
    }
  }, [hydrated, isConnected, address, token, authenticating, error, authenticate]);

  const value: AuthState = {
    token,
    isAuthenticated: token !== null,
    authenticating,
    authenticate,
    walletAddress: address,
    error,
  };

  return <AuthContext value={value}>{children}</AuthContext>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}
