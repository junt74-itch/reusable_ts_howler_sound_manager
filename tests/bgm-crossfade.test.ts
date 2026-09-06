import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { type AudioBackendOperation } from "../src/audio-backend.js";
import {
  BgmPlayAttributes,
  PlaybackState,
  SoundManager,
} from "../src/index.js";
import { registerAndPreloadSounds } from "./test-helpers.js";

function fadeOps(
  operations: AudioBackendOperation[],
  instanceId?: number,
): Extract<AudioBackendOperation, { type: "fade" }>[] {
  return operations.filter(
    (op): op is Extract<AudioBackendOperation, { type: "fade" }> =>
      op.type === "fade" && (instanceId === undefined || op.instanceId === instanceId),
  );
}

function playOp(
  operations: AudioBackendOperation[],
  soundId: string,
): Extract<AudioBackendOperation, { type: "play" }> | undefined {
  return operations.find(
    (op): op is Extract<AudioBackendOperation, { type: "play" }> =>
      op.type === "play" && op.options.soundId === soundId,
  );
}

describe("BGM crossfade", () => {
  beforeEach(() => {
    SoundManager.resetForTesting();
    SoundManager.Initialize();
  });

  afterEach(() => {
    SoundManager.resetForTesting();
  });

  it("starts the first BGM at target volume without crossfade", async () => {
    const backend = SoundManager.getBackendForTesting()!;
    await registerAndPreloadSounds(["bgm-a"]);

    const first = SoundManager.PlayBGM(
      new BgmPlayAttributes({ id: "bgm-a", volume: 0.8, fadeSeconds: 1 }),
    );

    const play = playOp(backend.operations, "bgm-a");
    expect(play?.options.volume).toBe(0.8);
    expect(fadeOps(backend.operations)).toHaveLength(0);
    expect(first.state).toBe(PlaybackState.PLAYING);
  });

  it("crossfades on the second BGM request", async () => {
    const backend = SoundManager.getBackendForTesting()!;
    await registerAndPreloadSounds(["bgm-a", "bgm-b"]);

    const first = SoundManager.PlayBGM(
      new BgmPlayAttributes({ id: "bgm-a", volume: 1, fadeSeconds: 1 }),
    );
    const firstInstanceId = SoundManager.getBackendInstanceIdForTesting(first)!;

    const second = SoundManager.PlayBGM(
      new BgmPlayAttributes({ id: "bgm-b", volume: 0.6, fadeSeconds: 1 }),
    );
    const secondInstanceId = SoundManager.getBackendInstanceIdForTesting(second)!;

    expect(playOp(backend.operations, "bgm-b")?.options.volume).toBe(0.6);
    expect(playOp(backend.operations, "bgm-b")?.options.gain).toBe(0);
    expect(fadeOps(backend.operations, secondInstanceId)).toEqual([
      { type: "fade", instanceId: secondInstanceId, toVolume: 1, duration: 1 },
    ]);
    expect(fadeOps(backend.operations, firstInstanceId)).toEqual([
      { type: "fade", instanceId: firstInstanceId, toVolume: 0, duration: 1 },
    ]);
    expect(first.state).toBe(PlaybackState.PLAYING);
    expect(second.state).toBe(PlaybackState.PLAYING);
    expect(first.handleId).not.toBe(second.handleId);
  });

  it("stops the outgoing handle and releases the channel after fade completes", async () => {
    const backend = SoundManager.getBackendForTesting()!;
    await registerAndPreloadSounds(["bgm-a", "bgm-b", "bgm-c"]);

    const first = SoundManager.PlayBGM(
      new BgmPlayAttributes({ id: "bgm-a", fadeSeconds: 1 }),
    );
    const firstInstanceId = SoundManager.getBackendInstanceIdForTesting(first)!;
    const firstChannel = first.channel;

    SoundManager.PlayBGM(
      new BgmPlayAttributes({ id: "bgm-b", fadeSeconds: 1 }),
    );

    backend.emitFadeComplete(firstInstanceId);

    expect(first.state).toBe(PlaybackState.STOPPED);
    expect(first.isActive()).toBe(false);

    const third = SoundManager.PlayBGM(
      new BgmPlayAttributes({ id: "bgm-c", fadeSeconds: 1 }),
    );
    expect(third.channel).toBe(firstChannel);
  });

  it("switches immediately when fadeSeconds is 0", async () => {
    const backend = SoundManager.getBackendForTesting()!;
    await registerAndPreloadSounds(["bgm-a", "bgm-b"]);

    const first = SoundManager.PlayBGM(
      new BgmPlayAttributes({ id: "bgm-a", volume: 1, fadeSeconds: 1 }),
    );
    const firstInstanceId = SoundManager.getBackendInstanceIdForTesting(first)!;

    const second = SoundManager.PlayBGM(
      new BgmPlayAttributes({ id: "bgm-b", volume: 0.7, fadeSeconds: 0 }),
    );

    expect(first.state).toBe(PlaybackState.STOPPED);
    expect(
      backend.operations.some(
        (op) => op.type === "stop" && op.instanceId === firstInstanceId,
      ),
    ).toBe(true);
    expect(fadeOps(backend.operations)).toHaveLength(0);
    expect(playOp(backend.operations, "bgm-b")?.options.volume).toBe(0.7);
    expect(second.state).toBe(PlaybackState.PLAYING);
  });

  it("interrupts an in-progress crossfade for a third BGM request", async () => {
    const backend = SoundManager.getBackendForTesting()!;
    await registerAndPreloadSounds(["bgm-a", "bgm-b", "bgm-c"]);

    const first = SoundManager.PlayBGM(
      new BgmPlayAttributes({ id: "bgm-a", fadeSeconds: 1 }),
    );
    const firstInstanceId = SoundManager.getBackendInstanceIdForTesting(first)!;

    const second = SoundManager.PlayBGM(
      new BgmPlayAttributes({ id: "bgm-b", fadeSeconds: 1 }),
    );
    const secondInstanceId = SoundManager.getBackendInstanceIdForTesting(second)!;

    const third = SoundManager.PlayBGM(
      new BgmPlayAttributes({ id: "bgm-c", volume: 0.5, fadeSeconds: 1 }),
    );
    const thirdInstanceId = SoundManager.getBackendInstanceIdForTesting(third)!;

    expect(first.state).toBe(PlaybackState.STOPPED);
    expect(
      backend.operations.some(
        (op) => op.type === "stop" && op.instanceId === firstInstanceId,
      ),
    ).toBe(true);
    expect(fadeOps(backend.operations, secondInstanceId)).toContainEqual({
      type: "fade",
      instanceId: secondInstanceId,
      toVolume: 0,
      duration: 1,
    });
    expect(fadeOps(backend.operations, thirdInstanceId)).toContainEqual({
      type: "fade",
      instanceId: thirdInstanceId,
      toVolume: 1,
      duration: 1,
    });
    expect(third.handleId).not.toBe(second.handleId);
    expect(third.state).toBe(PlaybackState.PLAYING);
  });

  it("creates a new handle when replaying the same BGM", async () => {
    await registerAndPreloadSounds(["bgm-a"]);

    const first = SoundManager.PlayBGM(
      new BgmPlayAttributes({ id: "bgm-a", fadeSeconds: 1 }),
    );
    const second = SoundManager.PlayBGM(
      new BgmPlayAttributes({ id: "bgm-a", fadeSeconds: 1 }),
    );

    expect(second.handleId).not.toBe(first.handleId);
    expect(second.state).toBe(PlaybackState.PLAYING);
  });

  it("stops only the targeted handle during crossfade", async () => {
    const backend = SoundManager.getBackendForTesting()!;
    await registerAndPreloadSounds(["bgm-a", "bgm-b"]);

    const first = SoundManager.PlayBGM(
      new BgmPlayAttributes({ id: "bgm-a", fadeSeconds: 1 }),
    );
    const firstInstanceId = SoundManager.getBackendInstanceIdForTesting(first)!;

    const second = SoundManager.PlayBGM(
      new BgmPlayAttributes({ id: "bgm-b", fadeSeconds: 1 }),
    );
    const secondInstanceId = SoundManager.getBackendInstanceIdForTesting(second)!;

    SoundManager.StopBGM(first);

    expect(first.state).toBe(PlaybackState.STOPPED);
    expect(second.state).toBe(PlaybackState.PLAYING);
    expect(fadeOps(backend.operations, secondInstanceId)).toHaveLength(1);

    backend.emitFadeComplete(firstInstanceId);
    expect(second.state).toBe(PlaybackState.PLAYING);
  });

  it("applies initialAudioPosition on the first BGM start", async () => {
    const backend = SoundManager.getBackendForTesting()!;
    await registerAndPreloadSounds(["bgm-a"]);

    SoundManager.PlayBGM(
      new BgmPlayAttributes({
        id: "bgm-a",
        initialAudioPosition: 12.5,
        fadeSeconds: 1,
      }),
    );

    expect(playOp(backend.operations, "bgm-a")?.options.initialAudioPosition).toBe(
      12.5,
    );
  });

  it("does not end infinite-loop BGM on natural completion", async () => {
    const backend = SoundManager.getBackendForTesting()!;
    await registerAndPreloadSounds(["bgm-a"]);

    const handle = SoundManager.PlayBGM(
      new BgmPlayAttributes({ id: "bgm-a", loop: -1, fadeSeconds: 1 }),
    );
    const instanceId = SoundManager.getBackendInstanceIdForTesting(handle)!;

    backend.emitEnd(instanceId);

    expect(handle.state).toBe(PlaybackState.PLAYING);
    expect(handle.isActive()).toBe(true);
  });

  it("keeps the outgoing BGM loaded when its group is unloaded and the same track is requested again", async () => {
    const backend = SoundManager.getBackendForTesting()!;
    await registerAndPreloadSounds(["bgm-a", "bgm-b"]);

    SoundManager.PlayBGM(new BgmPlayAttributes({ id: "bgm-a", fadeSeconds: 1 }));
    SoundManager.PlayBGM(new BgmPlayAttributes({ id: "bgm-b", fadeSeconds: 1 }));
    await SoundManager.UnloadGroup("__test");

    expect(backend.isSoundLoaded("bgm-a")).toBe(true);

    const replayed = SoundManager.PlayBGM(
      new BgmPlayAttributes({ id: "bgm-a", fadeSeconds: 1 }),
    );

    expect(replayed.state).toBe(PlaybackState.PLAYING);
    expect(backend.isSoundLoaded("bgm-a")).toBe(true);
  });
});
