# #!/bin/bash
# # PostToolUseFailure hook — logs tool failures to agent_log.jsonl
# # Reads JSON from stdin (Claude Code hook protocol)

# LOG_FILE="$CLAUDE_PROJECT_DIR/agent_log.jsonl"
# INPUT=$(cat)

# TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
# TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // "unknown"')
# ERROR=$(echo "$INPUT" | jq -r '.error // "unknown error"')

# echo "{\"timestamp\":\"$TIMESTAMP\",\"action\":\"claude_tool_failure\",\"tool\":\"$TOOL_NAME\",\"error\":\"$ERROR\",\"source\":\"hook\"}" >> "$LOG_FILE"
