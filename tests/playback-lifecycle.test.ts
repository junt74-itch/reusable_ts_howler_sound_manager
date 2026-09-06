import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { type AudioBackendOperation } from "../src/audio-backend.js";
import { PlaybackState, SoundManager } from "../src/index.js";
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

describe("playback lifecycle", () => {
  beforeEach(() => {
    SoundManager.resetForTesting();
  });

  afterEach(() => {
    SoundManager.resetForTesting();
  });

  it("transitions to ended and releases the channel on natural completion", async () => {
    SoundManager.Initialize();
    const backend = SoundManager.getBackendForTesting()!;
    await registerAndPreloadSounds(["hit"]);

    const handle = SoundManager.PlaySE({ id: "hit" });
    const instanceId = lastPlayInstanceId(backend.operations)!;

    backend.emitEnd(instanceId);

    expect(handle.state).toBe(PlaybackState.ENDED);
    expect(handle.isActive()).toBe(false);
    expect(SoundManager.getResourceStoreForTesting()?.isLoaded("hit")).toBe(true);
  });

  it("allows unloading a sound after playback ends", async () => {
    SoundManager.Initialize();
    const backend = SoundManager.getBackendForTesting()!;
    await registerAndPreloadSounds(["solo"]);

    const handle = SoundManager.PlaySE({ id: "solo" });
    const instanceId = lastPlayInstanceId(backend.operations)!;
    backend.emitEnd(instanceId);

    await SoundManager.UnloadGroup("__test");

    expect(handle.state).toBe(PlaybackState.ENDED);
    expect(backend.isSoundLoaded("solo")).toBe(false);
  });

  it("ignores delayed end events after explicit stop", async () => {
    SoundManager.Initialize();
    const backend = SoundManager.getBackendForTesting()!;
    await registerAndPreloadSounds(["a", "b"]);

    const first = SoundManager.PlaySE({ id: "a" });
    const firstInstanceId = lastPlayInstanceId(backend.operations)!;
    SoundManager.Stop(first);

    const second = SoundManager.PlaySE({ id: "b" });
    const secondInstanceId = lastPlayInstanceId(backend.operations)!;

    backend.emitEnd(firstInstanceId);

    expect(first.state).toBe(PlaybackState.STOPPED);
    expect(second.state).toBe(PlaybackState.PLAYING);
    expect(secondInstanceId).not.toBe(firstInstanceId);
  });

  it("does not let stale events or handles affect channel reuse", async () => {
    SoundManager.Initialize();
    const backend = SoundManager.getBackendForTesting()!;
    await registerAndPreloadSounds(["old", "new"]);

    const first = SoundManager.PlayBGS({ channel: 0, id: "old" });
    const firstInstanceId = lastPlayInstanceId(backend.operations)!;

    const second = SoundManager.PlayBGS({ channel: 0, id: "new" });
    const secondInstanceId = lastPlayInstanceId(backend.operations)!;

    SoundManager.Stop(first);
    SoundManager.Pause(first);
    SoundManager.Resume(first);
    backend.emitEnd(firstInstanceId);

    expect(first.isActive()).toBe(false);
    expect(second.state).toBe(PlaybackState.PLAYING);
    expect(
      backend.operations.filter(
        (op) => op.type === "stop" && op.instanceId === secondInstanceId,
      ),
    ).toHaveLength(0);
    expect(secondInstanceId).not.toBe(firstInstanceId);
  });

  it("releases the channel when playback ends", async () => {
    SoundManager.Initialize();
    const backend = SoundManager.getBackendForTesting()!;
    const soundIds = Array.from({ length: 16 }, (_, index) => `se-${index}`);
    await registerAndPreloadSounds(soundIds);

    const handles = soundIds.map((id) => SoundManager.PlaySE({ id }));
    const oldest = handles[0]!;
    const oldestInstanceId = (
      backend.operations.find(
        (op) => op.type === "play" && op.options.soundId === "se-0",
      ) as Extract<AudioBackendOperation, { type: "play" }> | undefined
    )?.instanceId;

    backend.emitEnd(oldestInstanceId!);

    const replacement = SoundManager.PlaySE({ id: "se-0" });
    expect(replacement.channel).toBe(oldest.channel);
    expect(oldest.state).toBe(PlaybackState.ENDED);
    expect(replacement.state).toBe(PlaybackState.PLAYING);
  });

  it("transitions to error and releases resources on playback failure", async () => {
    SoundManager.Initialize();
    const backend = SoundManager.getBackendForTesting()!;
    await registerAndPreloadSounds(["fail"]);

    const handle = SoundManager.PlaySE({ id: "fail" });
    const instanceId = lastPlayInstanceId(backend.operations)!;

    backend.emitError(instanceId, new Error("playback failed"));

    expect(handle.state).toBe(PlaybackState.ERROR);
    expect(handle.isActive()).toBe(false);
  });
});
