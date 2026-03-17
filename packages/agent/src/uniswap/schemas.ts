/**
 * Zod validation schemas for Uniswap Trading API responses.
 * These validate external API data before it enters the agent.
 *
 * @module @veil/agent/uniswap/schemas
 */
import { z } from "zod";
import type { Hex } from "viem";

const hexString = z.custom<Hex>(
  (val) => typeof val === "string" && val.startsWith("0x"),
  { message: "Expected a hex string starting with 0x" },
);

export const PermitDataSchema = z.object({
  domain: z.record(z.string(), z.unknown()),
  types: z.record(
    z.string(),
    z.array(
      z.object({
        name: z.string(),
        type: z.string(),
      }),
    ),
  ),
  values: z.record(z.string(), z.unknown()),
});
export type PermitData = z.infer<typeof PermitDataSchema>;

export const ApprovalResponseSchema = z.object({
  approval: z
    .object({
      tokenAddress: hexString,
      spender: hexString,
      amount: z.string(),
      transactionRequest: z
        .object({
          to: hexString,
          data: hexString,
          value: z.string(),
        })
        .optional(),
    })
    .nullable(),
});
export type ApprovalResponse = z.infer<typeof ApprovalResponseSchema>;

export const QuoteResponseSchema = z.object({
  requestId: z.string(),
  quote: z.object({
    chainId: z.number(),
    input: z.object({ token: hexString, amount: z.string() }),
    output: z.object({ token: hexString, amount: z.string() }),
    swapper: hexString,
    slippage: z.union([
      z.object({ tolerance: z.number() }),
      z.number(),
    ]),
  }),
  routing: z.string(),
  permitData: PermitDataSchema.optional().nullable(),
});
export type QuoteResponse = z.infer<typeof QuoteResponseSchema>;

export const SwapResponseSchema = z.object({
  swap: z.object({
    chainId: z.number().optional(),
    to: hexString,
    data: hexString,
    value: z.string(),
    gasLimit: z.string().optional(),
  }),
  requestId: z.string(),
});
export type SwapResponse = z.infer<typeof SwapResponseSchema>;
