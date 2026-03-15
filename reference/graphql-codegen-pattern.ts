/**
 * REFERENCE ONLY. GraphQL Code Generator configuration patterns for frontend
 * and backend.
 *
 * @module @veil/reference/graphql-codegen-pattern
 */

// ============================================================
// BACKEND CODEGEN (simpler — for agent server-side usage)
// Source: ~/projects/private-streams/scripts/codegen.ts
// ============================================================

import type { CodegenConfig } from "@graphql-codegen/cli";

const config: CodegenConfig = {
  overwrite: true,
  // Point at the Uniswap V3 Base subgraph (or whichever subgraph we use)
  schema:
    "https://gateway.thegraph.com/api/[API_KEY]/subgraphs/id/FUbEPQw1oMghy39fwWBFY5fE6MXPXZQtjncQy2cXdrNS",
  documents: ["**/*.graphql", "*.ts", "!codegen.ts"],
  generates: {
    "__generated__/graphql.ts": {
      config: {
        enumsAsTypes: true,
        // Map The Graph scalar types to TypeScript strings
        scalars: {
          BigDecimal: "string",
          BigInt: "string",
          Bytes: "string",
          Int8: "string",
          Timestamp: "string",
        },
        useTypeImports: true,
      },
      plugins: [
        "typescript",
        "typescript-operations",
        "typescript-graphql-request",
      ],
    },
  },
  ignoreNoDocuments: true,
};

export default config;

// ============================================================
// FRONTEND CODEGEN (richer — TypedDocumentNode + SDK)
// Source: ~/projects/private-streams/apps/insider-streams-frontend/codegen.ts
// ============================================================

// Same as above but adds:
// 1. "typed-document-node" plugin (for Apollo Client useQuery/useMutation)
// 2. Separate "sdk.ts" output (for graphql-request in Next.js API routes)
// 3. "introspection" plugin (saves graphql.schema.json locally)

// ============================================================
// PACKAGES NEEDED
// ============================================================
// devDependencies:
//   @graphql-codegen/cli: ^6.1.2
//   @graphql-codegen/typescript: ^5.0.8
//   @graphql-codegen/typescript-operations: ^5.0.8
//   @graphql-codegen/typescript-graphql-request: ^6.4.0
//   @graphql-codegen/introspection: ^5.0.0          (optional, for schema caching)
//   @graphql-codegen/typed-document-node: ^6.1.6    (optional, for Apollo Client)
//
// Script:
//   "codegen": "graphql-codegen --config codegen.ts"

// ============================================================
// WAGMI CONTRACT CODEGEN (separate pattern)
// Source: ~/projects/private-streams/packages/common/wagmi.config.ts
// ============================================================
// Generates TypeScript types from Solidity contract ABIs
// Useful if we deploy custom caveat enforcers (MetaMask)
//
// import { defineConfig } from "@wagmi/cli";
// export default defineConfig({
//   out: "src/__generated__/contract-types.ts",
//   contracts: [
//     { name: "PortfolioDriftEnforcer", abi: loadAbi(...) },
//   ],
// });
