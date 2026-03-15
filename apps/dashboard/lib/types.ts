export interface AgentStateResponse {
  cycle: number;
  running: boolean;
  ethPrice: number;
  drift: number;
  trades: number;
  totalSpent: number;
  budgetTier: string;
  allocation: Record<string, number>;
  target: Record<string, number>;
  totalValue: number;
  feed: AgentLogEntry[];
  transactions: SwapRecord[];
  audit: AuditReport | null;
}

export interface SwapRecord {
  txHash: string;
  sellToken: string;
  buyToken: string;
  sellAmount: string;
  status: string;
  timestamp: string;
}

export interface AuditReport {
  allows: string[];
  prevents: string[];
  worstCase: string;
  warnings: string[];
}

export interface AgentLogEntry {
  timestamp: string;
  sequence: number;
  action: string;
  tool: string;
  parameters: Record<string, unknown>;
  result: Record<string, unknown>;
  duration_ms: number;
  success: boolean;
  error?: string;
}

export interface ParsedIntent {
  targetAllocation: Record<string, number>;
  dailyBudgetUsd: number;
  timeWindowDays: number;
  maxTradesPerDay: number;
  maxSlippage: number;
  driftThreshold: number;
}

export interface DeployResponse {
  parsed: ParsedIntent;
  audit: AuditReport | null;
}
