import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, readFileSync, rmSync, existsSync } from "node:fs";
import { IntentLogger } from "../intent-log.js";

const TEST_DIR = "data/logs";
const TEST_INTENT_ID = "test-intent-123";

describe("IntentLogger", () => {
  let logger: IntentLogger;

  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
    logger = new IntentLogger(TEST_INTENT_ID, TEST_DIR);
  });

  afterEach(() => {
    const path = `${TEST_DIR}/${TEST_INTENT_ID}.jsonl`;
    if (existsSync(path)) rmSync(path);
  });

  it("writes a log entry to the intent-specific JSONL file", () => {
    logger.log("test_action", { tool: "test-tool" });

    const path = `${TEST_DIR}/${TEST_INTENT_ID}.jsonl`;
    const content = readFileSync(path, "utf-8").trim();
    const entry = JSON.parse(content);

    expect(entry.action).toBe("test_action");
    expect(entry.tool).toBe("test-tool");
    expect(entry.timestamp).toBeDefined();
    expect(entry.sequence).toBe(0);
  });

  it("increments sequence number", () => {
    logger.log("first");
    logger.log("second");

    const path = `${TEST_DIR}/${TEST_INTENT_ID}.jsonl`;
    const lines = readFileSync(path, "utf-8").trim().split("\n");
    expect(JSON.parse(lines[0]).sequence).toBe(0);
    expect(JSON.parse(lines[1]).sequence).toBe(1);
  });

  it("includes cycle when provided", () => {
    logger.log("cycle_action", { cycle: 5 });

    const path = `${TEST_DIR}/${TEST_INTENT_ID}.jsonl`;
    const entry = JSON.parse(readFileSync(path, "utf-8").trim());
    expect(entry.cycle).toBe(5);
  });

  it("reads all entries back", () => {
    logger.log("a");
    logger.log("b");
    logger.log("c");

    const entries = logger.readAll();
    expect(entries).toHaveLength(3);
    expect(entries.map((e) => e.action)).toEqual(["a", "b", "c"]);
  });

  it("readAll returns empty array if file does not exist", () => {
    const freshLogger = new IntentLogger("nonexistent", TEST_DIR);
    expect(freshLogger.readAll()).toEqual([]);
  });

  it("getFilePath returns correct path", () => {
    expect(logger.getFilePath()).toBe(`${TEST_DIR}/${TEST_INTENT_ID}.jsonl`);
  });
});
