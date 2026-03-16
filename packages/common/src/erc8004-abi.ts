/**
 * @file Human-readable ABI fragments for ERC-8004 Identity and Reputation registries.
 *
 * These are the canonical ABI definitions used across the monorepo. Pass them
 * to viem's `parseAbi()` to get typed ABI objects. Kept as plain string arrays
 * so this package doesn't need a viem dependency.
 */

export const IDENTITY_REGISTRY_ABI_HUMAN = [
  "function register(string agentURI) external returns (uint256 agentId)",
  "function register() external returns (uint256 agentId)",
  "function setAgentURI(uint256 agentId, string calldata newURI) external",
  "function getMetadata(uint256 agentId, string memory metadataKey) external view returns (bytes memory)",
  "function setMetadata(uint256 agentId, string memory metadataKey, bytes memory metadataValue) external",
] as const;

export const REPUTATION_REGISTRY_ABI_HUMAN = [
  "function giveFeedback(uint256 agentId, int128 value, uint8 valueDecimals, string calldata tag1, string calldata tag2, string calldata endpoint, string calldata feedbackURI, bytes32 feedbackHash) external",
  "function revokeFeedback(uint256 agentId, uint64 feedbackIndex) external",
  "function getSummary(uint256 agentId, address[] calldata clientAddresses, string tag1, string tag2) external view returns (uint64 count, int128 summaryValue, uint8 summaryValueDecimals)",
  "function readFeedback(uint256 agentId, address clientAddress, uint64 feedbackIndex) external view returns (int128 value, uint8 valueDecimals, string tag1, string tag2, bool isRevoked)",
  "function getClients(uint256 agentId) external view returns (address[] memory)",
  "function getLastIndex(uint256 agentId, address clientAddress) external view returns (uint64)",
] as const;
