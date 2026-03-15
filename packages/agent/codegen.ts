/**
 * GraphQL Code Generator config for Uniswap V3 subgraph types and SDK.
 *
 * @module @veil/agent/codegen
 */
import "dotenv/config";
import type { CodegenConfig } from "@graphql-codegen/cli";

const SUBGRAPH_ID = "5zvR82QoaXYFyDEKLZ9t6v9adgnptxYpKpSbxtgVENFV";
const key = process.env.THEGRAPH_API_KEY;
const schemaUrl = key
  ? `https://gateway.thegraph.com/api/${key}/subgraphs/id/${SUBGRAPH_ID}`
  : `https://gateway.thegraph.com/api/subgraphs/id/${SUBGRAPH_ID}`;

const config: CodegenConfig = {
  overwrite: true,
  schema: schemaUrl,
  documents: ["src/**/*.graphql", "src/**/*.ts", "!codegen.ts"],
  generates: {
    "__generated__/graphql.ts": {
      config: {
        enumsAsTypes: true,
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
