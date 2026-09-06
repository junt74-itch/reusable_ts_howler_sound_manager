import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { type AudioBackendOperation } from "../src/audio-backend.js";
import {
  InvalidArgumentError,
  NotInitializedError,
  PlaybackState,
  SoundCategory,
  SoundManager,
} from "../src/index.js";
import { registerAndPreloadSounds } from "./test-helpers.js";

function lastPlayVolume(
  operations: AudioBackendOperation[],
  soundId: string,
): number | undefined {
  for (let i = operations.length - 1; i >= 0; i -= 1) {
    const op = operations[i];
    if (op?.type === "play" && op.options.soundId === soundId) {
      return op.options.volume;
    }
  }
  return undefined;
}

function setVolumeOps(
  operations: AudioBackendOperation[],
  instanceId: number,
): Extract<AudioBackendOperation, { type: "setVolume" }>[] {
  return operations.filter(
    (op): op is Extract<AudioBackendOperation, { type: "setVolume" }> =>
      op.type === "setVolume" && op.instanceId === instanceId,
  );
}

describe("volume and mute", () => {
  beforeEach(() => {
    SoundManager.resetForTesting();
    SoundManager.Initialize();
  });

  afterEach(() => {
    SoundManager.resetForTesting();
  });

  it("defaults master and category volume to 1 and mute to false", () => {
    expect(SoundManager.GetMasterVolume()).toBe(1);
    expect(SoundManager.IsMasterMute()).toBe(false);
    expect(SoundManager.GetCategoryVolume(SoundCategory.BGM)).toBe(1);
    expect(SoundManager.IsCategoryMute(SoundCategory.SE)).toBe(false);
    expect(SoundManager.IsCategoryMute(SoundCategory.SYSTEM_SE)).toBe(false);
  });

  it("rejects out-of-range volume values", () => {
    expect(() => SoundManager.SetMasterVolume(-0.1)).toThrow(
      InvalidArgumentError,
    );
    expect(() => SoundManager.SetMasterVolume(1.1)).toThrow(
      InvalidArgumentError,
    );
    expect(() => SoundManager.SetCategoryVolume(SoundCategory.SE, 2)).toThrow(
      InvalidArgumentError,
    );
  });

  it("throws when mixer APIs are used before Initialize", () => {
    SoundManager.resetForTesting();
    expect(() => SoundManager.GetMasterVolume()).toThrow(NotInitializedError);
    expect(() => SoundManager.UnlockAudio()).toThrow(NotInitializedError);
  });

  it("applies master * category * playback volume at play time", async () => {
    const backend = SoundManager.getBackendForTesting()!;
    await registerAndPreloadSounds(["hit"]);

    SoundManager.SetMasterVolume(0.5);
    SoundManager.SetCategoryVolume(SoundCategory.SE, 0.4);
    SoundManager.PlaySE({ id: "hit", volume: 0.5 });

    expect(lastPlayVolume(backend.operations, "hit")).toBeCloseTo(0.1);
  });

  it("uses zero effective volume when master or category is muted", async () => {
    const backend = SoundManager.getBackendForTesting()!;
    await registerAndPreloadSounds(["hit", "ui-confirm"]);

    SoundManager.SetMasterMute(true);
    SoundManager.PlaySE({ id: "hit", volume: 1 });
    expect(lastPlayVolume(backend.operations, "hit")).toBe(0);

    SoundManager.SetMasterMute(false);
    SoundManager.SetCategoryMute(SoundCategory.SE, true);
    SoundManager.PlaySE({ id: "hit", volume: 1 });
    expect(lastPlayVolume(backend.operations, "hit")).toBe(0);

    SoundManager.SetCategoryMute(SoundCategory.SE, false);
    SoundManager.SetCategoryMute(SoundCategory.SYSTEM_SE, true);
    SoundManager.PlaySystemSE({ id: "ui-confirm", volume: 1 });
    expect(lastPlayVolume(backend.operations, "ui-confirm")).toBe(0);
  });

  it("keeps SYSTEM SE volume independent from SE", async () => {
    const backend = SoundManager.getBackendForTesting()!;
    await registerAndPreloadSounds(["hit", "ui-confirm"]);

    SoundManager.SetCategoryVolume(SoundCategory.SE, 0.2);
    SoundManager.SetCategoryVolume(SoundCategory.SYSTEM_SE, 0.8);

    SoundManager.PlaySE({ id: "hit", volume: 1 });
    SoundManager.PlaySystemSE({ id: "ui-confirm", volume: 1 });

    expect(lastPlayVolume(backend.operations, "hit")).toBeCloseTo(0.2);
    expect(lastPlayVolume(backend.operations, "ui-confirm")).toBeCloseTo(0.8);
  });

  it("reflects mixer changes on active playback immediately", async () => {
    const backend = SoundManager.getBackendForTesting()!;
    await registerAndPreloadSounds(["hit"]);

    const handle = SoundManager.PlaySE({ id: "hit", volume: 1 });
    const instanceId = SoundManager.getBackendInstanceIdForTesting(handle)!;

    SoundManager.SetMasterVolume(0.5);
    expect(setVolumeOps(backend.operations, instanceId).at(-1)?.volume).toBe(
      0.5,
    );

    SoundManager.SetCategoryMute(SoundCategory.SE, true);
    expect(setVolumeOps(backend.operations, instanceId).at(-1)?.volume).toBe(0);
  });

  it("uses effective volume for BGM crossfade targets", async () => {
    const backend = SoundManager.getBackendForTesting()!;
    await registerAndPreloadSounds(["bgm-a", "bgm-b"]);

    SoundManager.SetMasterVolume(0.5);
    SoundManager.SetCategoryVolume(SoundCategory.BGM, 0.8);

    SoundManager.PlayBGM({ id: "bgm-a", volume: 1, fadeSeconds: 1 });
    const second = SoundManager.PlayBGM({
      id: "bgm-b",
      volume: 0.5,
      fadeSeconds: 1,
    });
    const secondInstanceId =
      SoundManager.getBackendInstanceIdForTesting(second)!;

    const fadeIn = backend.operations.find(
      (op): op is Extract<AudioBackendOperation, { type: "fade" }> =>
        op.type === "fade" &&
        op.instanceId === secondInstanceId &&
        op.toVolume > 0,
    );
    expect(fadeIn?.toVolume).toBe(1);
    const incomingPlay = backend.operations.find(
      (op): op is Extract<AudioBackendOperation, { type: "play" }> =>
        op.type === "play" && op.options.soundId === "bgm-b",
    );
    expect(incomingPlay?.options.volume).toBeCloseTo(0.2);
    expect(incomingPlay?.options.gain).toBe(0);
  });

  it("does not apply SE mixer changes to active BGM", async () => {
    const backend = SoundManager.getBackendForTesting()!;
    await registerAndPreloadSounds(["bgm-a", "hit"]);

    const bgm = SoundManager.PlayBGM({ id: "bgm-a", fadeSeconds: 1 });
    const bgmInstanceId = SoundManager.getBackendInstanceIdForTesting(bgm)!;
    SoundManager.PlaySE({ id: "hit" });

    const volumeOpsBefore = backend.operations.filter(
      (op) => op.type === "setVolume" && op.instanceId === bgmInstanceId,
    ).length;

    SoundManager.SetCategoryVolume(SoundCategory.SE, 0.2);

    const volumeOpsAfter = backend.operations.filter(
      (op) => op.type === "setVolume" && op.instanceId === bgmInstanceId,
    ).length;
    expect(volumeOpsAfter).toBe(volumeOpsBefore);
  });

  it("keeps BGM fade envelopes when master volume changes", async () => {
    const backend = SoundManager.getBackendForTesting()!;
    await registerAndPreloadSounds(["bgm-a", "bgm-b"]);

    const first = SoundManager.PlayBGM({ id: "bgm-a", volume: 1, fadeSeconds: 1 });
    const firstInstanceId = SoundManager.getBackendInstanceIdForTesting(first)!;
    const second = SoundManager.PlayBGM({
      id: "bgm-b",
      volume: 1,
      fadeSeconds: 1,
    });
    const secondInstanceId =
      SoundManager.getBackendInstanceIdForTesting(second)!;

    SoundManager.SetMasterVolume(0.5);

    expect(setVolumeOps(backend.operations, firstInstanceId).at(-1)?.volume).toBe(
      0.5,
    );
    expect(setVolumeOps(backend.operations, secondInstanceId).at(-1)?.volume).toBe(
      0,
    );
    expect(first.state).toBe(PlaybackState.PLAYING);
    expect(second.state).toBe(PlaybackState.PLAYING);

    backend.emitFadeComplete(firstInstanceId);
    expect(first.state).toBe(PlaybackState.STOPPED);
  });

  it("StopAllSE does not stop SYSTEM SE", async () => {
    await registerAndPreloadSounds(["hit", "ui-confirm"]);

    const se = SoundManager.PlaySE({ id: "hit" });
    const systemSe = SoundManager.PlaySystemSE({ id: "ui-confirm" });

    SoundManager.StopAllSE();

    expect(se.state).toBe(PlaybackState.STOPPED);
    expect(systemSe.state).toBe(PlaybackState.PLAYING);
  });

  it("UnlockAudio resolves immediately on the fake backend", async () => {
    const backend = SoundManager.getBackendForTesting()!;
    await SoundManager.UnlockAudio();
    expect(backend.operations.some((op) => op.type === "unlockAudio")).toBe(
      true,
    );
  });
});
