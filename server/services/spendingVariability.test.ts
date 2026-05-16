import { EventEmitter } from "events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.hoisted(() => vi.fn());

vi.mock("child_process", () => ({
  spawn: spawnMock,
}));

import { runSpendingVariabilityInsight } from "./spendingVariability";

function createChildProcess() {
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  const closeHandlers: Array<(code: number) => void> = [];

  return {
    stdout,
    stderr,
    on: vi.fn((event: string, handler: any) => {
      if (event === "close") closeHandlers.push(handler);
      return undefined;
    }),
    emitClose(code: number) {
      closeHandlers.forEach((handler) => handler(code));
    },
  };
}

describe("runSpendingVariabilityInsight", () => {
  beforeEach(() => {
    spawnMock.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("returns parsed JSON when the Python script succeeds", async () => {
    const child = createChildProcess();
    spawnMock.mockReturnValue(child);

    const promise = runSpendingVariabilityInsight("user-1", "2025-01");
    child.stdout.emit("data", Buffer.from('{"title":"Stable spending","summary":"ok"}'));
    child.emitClose(0);

    await expect(promise).resolves.toMatchObject({ title: "Stable spending" });
  });

  it("returns null on script failure or malformed output", async () => {
    const failedChild = createChildProcess();
    spawnMock.mockReturnValueOnce(failedChild);

    const failedPromise = runSpendingVariabilityInsight("user-1", "2025-01");
    failedChild.stderr.emit("data", Buffer.from("failure"));
    failedChild.emitClose(1);
    await expect(failedPromise).resolves.toBeNull();

    const invalidChild = createChildProcess();
    spawnMock.mockReturnValueOnce(invalidChild);

    const invalidPromise = runSpendingVariabilityInsight("user-1", "2025-01");
    invalidChild.stdout.emit("data", Buffer.from("not-json"));
    invalidChild.emitClose(0);
    await expect(invalidPromise).resolves.toBeNull();
  });
});
