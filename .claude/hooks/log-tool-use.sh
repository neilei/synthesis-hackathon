# #!/bin/bash
# # PostToolUse hook — logs every tool call to agent_log.jsonl
# # Reads JSON from stdin (Claude Code hook protocol)

# LOG_FILE="$CLAUDE_PROJECT_DIR/agent_log.jsonl"
# INPUT=$(cat)

# TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
# TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // "unknown"')
# TOOL_INPUT=$(echo "$INPUT" | jq -c '.tool_input // {}')

# echo "{\"timestamp\":\"$TIMESTAMP\",\"action\":\"claude_tool_use\",\"tool\":\"$TOOL_NAME\",\"input\":$TOOL_INPUT,\"source\":\"hook\"}" >> "$LOG_FILE"
