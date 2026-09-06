import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { type AudioBackendOperation } from "../src/audio-backend.js";
import { PlaybackState, SoundCategory, SoundManager } from "../src/index.js";
import { registerAndPreloadSounds } from "./test-helpers.js";

function lastPlayInstanceId(
  operations: AudioBackendOperation[],
): number | undefined {
  for (let i = operations.length - 1; i >= 0; i -= 1) {
    const op = operations[i];
    if (op?.type === "play") {
      return op.instanceId;
    }
  }
  return undefined;
}

describe("playback handle vs channel", () => {
  beforeEach(() => {
    SoundManager.resetForTesting();
  });

  afterEach(() => {
    SoundManager.resetForTesting();
  });

  it("returns distinct handles even when the same BGS channel is reused", async () => {
    SoundManager.Initialize();
    await registerAndPreloadSounds(["rain", "wind"]);

    const first = SoundManager.PlayBGS({ channel: 0, id: "rain" });
    const second = SoundManager.PlayBGS({ channel: 0, id: "wind" });

    expect(first.channel).toBe(0);
    expect(second.channel).toBe(0);
    expect(first.handleId).not.toBe(second.handleId);
    expect(first).not.toBe(second);
    expect(first.state).toBe(PlaybackState.STOPPED);
    expect(second.state).toBe(PlaybackState.PLAYING);
  });

  it("does not let stale handle operations affect the current playback", async () => {
    SoundManager.Initialize();
    const backend = SoundManager.getBackendForTesting()!;
    await registerAndPreloadSounds(["old", "new"]);

    const first = SoundManager.PlayBGS({ channel: 1, id: "old" });
    const firstBackendId = lastPlayInstanceId(backend.operations);

    const second = SoundManager.PlayBGS({ channel: 1, id: "new" });
    const secondBackendId = lastPlayInstanceId(backend.operations);

    SoundManager.Stop(first);
    SoundManager.Pause(first);
    SoundManager.Resume(first);

    expect(first.isActive()).toBe(false);
    expect(second.state).toBe(PlaybackState.PLAYING);
    expect(
      backend.operations.filter(
        (op) => op.type === "stop" && op.instanceId === secondBackendId,
      ),
    ).toHaveLength(0);
    expect(
      backend.operations.filter(
        (op) => op.type === "stop" && op.instanceId === firstBackendId,
      ),
    ).toHaveLength(1);
  });

  it("ignores Stop/Pause/Resume on terminal handles", async () => {
    SoundManager.Initialize();
    const backend = SoundManager.getBackendForTesting()!;
    await registerAndPreloadSounds(["hit"]);

    const handle = SoundManager.PlaySE({ id: "hit" });
    SoundManager.Stop(handle);

    const stopCount = backend.operations.filter((op) => op.type === "stop").length;

    SoundManager.Stop(handle);
    SoundManager.Pause(handle);
    SoundManager.Resume(handle);

    expect(handle.state).toBe(PlaybackState.STOPPED);
    expect(backend.operations.filter((op) => op.type === "stop")).toHaveLength(
      stopCount,
    );
    expect(backend.operations.some((op) => op.type === "pause")).toBe(false);
  });

  it("steals the oldest SE channel when all 16 slots are full", async () => {
    SoundManager.Initialize();
    const soundIds = [
      ...Array.from({ length: 16 }, (_, index) => `se-${index}`),
      "se-new",
    ];
    await registerAndPreloadSounds(soundIds);

    const handles = Array.from({ length: 16 }, (_, index) =>
      SoundManager.PlaySE({ id: `se-${index}` }),
    );
    const oldest = handles[0]!;
    const newest = SoundManager.PlaySE({ id: "se-new" });

    expect(newest.channel).toBe(oldest.channel);
    expect(oldest.state).toBe(PlaybackState.STOPPED);
    expect(newest.state).toBe(PlaybackState.PLAYING);
    expect(newest.category).toBe(SoundCategory.SE);
  });
});
