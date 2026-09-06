import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { type AudioBackendOperation } from "../src/audio-backend.js";
import {
  BgmPlayAttributes,
  PlaybackState,
  SoundManager,
} from "../src/index.js";
import { registerAndPreloadSounds } from "./test-helpers.js";

function instanceIdFor(
  operations: AudioBackendOperation[],
  soundId: string,
): number | undefined {
  const op = operations.find(
    (entry): entry is Extract<AudioBackendOperation, { type: "play" }> =>
      entry.type === "play" && entry.options.soundId === soundId,
  );
  return op?.instanceId;
}

function pauseOps(
  operations: AudioBackendOperation[],
  instanceId: number,
): Extract<AudioBackendOperation, { type: "pause" }>[] {
  return operations.filter(
    (op): op is Extract<AudioBackendOperation, { type: "pause" }> =>
      op.type === "pause" && op.instanceId === instanceId,
  );
}

function resumeOps(
  operations: AudioBackendOperation[],
  instanceId: number,
): Extract<AudioBackendOperation, { type: "resume" }>[] {
  return operations.filter(
    (op): op is Extract<AudioBackendOperation, { type: "resume" }> =>
      op.type === "resume" && op.instanceId === instanceId,
  );
}

describe("ME playback and BGM coordination", () => {
  beforeEach(() => {
    SoundManager.resetForTesting();
  });

  afterEach(() => {
    SoundManager.resetForTesting();
  });

  it("replaces the current ME when meChannelCount is 1 and resumes BGM after the last ME ends", async () => {
    SoundManager.Initialize({ meChannelCount: 1, pauseBgmDuringMe: true });
    const backend = SoundManager.getBackendForTesting()!;
    await registerAndPreloadSounds(["bgm-a", "me-1", "me-2"]);

    const bgm = SoundManager.PlayBGM(
      new BgmPlayAttributes({ id: "bgm-a", fadeSeconds: 0 }),
    );
    const bgmInstanceId = SoundManager.getBackendInstanceIdForTesting(bgm)!;

    const firstMe = SoundManager.PlayME({ id: "me-1" });
    expect(bgm.state).toBe(PlaybackState.PAUSED);
    expect(pauseOps(backend.operations, bgmInstanceId)).toHaveLength(1);

    const secondMe = SoundManager.PlayME({ id: "me-2" });
    expect(firstMe.state).toBe(PlaybackState.STOPPED);
    expect(secondMe.state).toBe(PlaybackState.PLAYING);
    expect(bgm.state).toBe(PlaybackState.PAUSED);
    expect(resumeOps(backend.operations, bgmInstanceId)).toHaveLength(0);

    const secondMeInstanceId =
      SoundManager.getBackendInstanceIdForTesting(secondMe)!;
    backend.emitEnd(secondMeInstanceId);

    expect(secondMe.state).toBe(PlaybackState.ENDED);
    expect(bgm.state).toBe(PlaybackState.PLAYING);
    expect(resumeOps(backend.operations, bgmInstanceId)).toHaveLength(1);
  });

  it("plays two MEs concurrently when meChannelCount is 2 and resumes BGM only after both end", async () => {
    SoundManager.Initialize({ meChannelCount: 2, pauseBgmDuringMe: true });
    const backend = SoundManager.getBackendForTesting()!;
    await registerAndPreloadSounds(["bgm-a", "me-1", "me-2"]);

    const bgm = SoundManager.PlayBGM(
      new BgmPlayAttributes({ id: "bgm-a", fadeSeconds: 0 }),
    );
    const bgmInstanceId = SoundManager.getBackendInstanceIdForTesting(bgm)!;

    const firstMe = SoundManager.PlayME({ id: "me-1" });
    const secondMe = SoundManager.PlayME({ id: "me-2" });

    expect(firstMe.state).toBe(PlaybackState.PLAYING);
    expect(secondMe.state).toBe(PlaybackState.PLAYING);
    expect(firstMe.channel).not.toBe(secondMe.channel);
    expect(bgm.state).toBe(PlaybackState.PAUSED);

    const firstMeInstanceId =
      SoundManager.getBackendInstanceIdForTesting(firstMe)!;
    backend.emitEnd(firstMeInstanceId);

    expect(firstMe.state).toBe(PlaybackState.ENDED);
    expect(secondMe.state).toBe(PlaybackState.PLAYING);
    expect(bgm.state).toBe(PlaybackState.PAUSED);
    expect(resumeOps(backend.operations, bgmInstanceId)).toHaveLength(0);

    const secondMeInstanceId =
      SoundManager.getBackendInstanceIdForTesting(secondMe)!;
    backend.emitEnd(secondMeInstanceId);

    expect(bgm.state).toBe(PlaybackState.PLAYING);
    expect(resumeOps(backend.operations, bgmInstanceId)).toHaveLength(1);
  });

  it("does not pause BGM when pauseBgmDuringMe is false", async () => {
    SoundManager.Initialize({ meChannelCount: 1, pauseBgmDuringMe: false });
    const backend = SoundManager.getBackendForTesting()!;
    await registerAndPreloadSounds(["bgm-a", "me-1"]);

    const bgm = SoundManager.PlayBGM(
      new BgmPlayAttributes({ id: "bgm-a", fadeSeconds: 0 }),
    );
    const bgmInstanceId = SoundManager.getBackendInstanceIdForTesting(bgm)!;

    SoundManager.PlayME({ id: "me-1" });

    expect(bgm.state).toBe(PlaybackState.PLAYING);
    expect(pauseOps(backend.operations, bgmInstanceId)).toHaveLength(0);
  });

  it("leaves user-paused BGM paused after ME ends", async () => {
    SoundManager.Initialize({ pauseBgmDuringMe: true });
    const backend = SoundManager.getBackendForTesting()!;
    await registerAndPreloadSounds(["bgm-a", "me-1"]);

    const bgm = SoundManager.PlayBGM(
      new BgmPlayAttributes({ id: "bgm-a", fadeSeconds: 0 }),
    );
    const bgmInstanceId = SoundManager.getBackendInstanceIdForTesting(bgm)!;

    SoundManager.Pause(bgm);
    expect(bgm.state).toBe(PlaybackState.PAUSED);

    const me = SoundManager.PlayME({ id: "me-1" });
    const meInstanceId = SoundManager.getBackendInstanceIdForTesting(me)!;

    expect(pauseOps(backend.operations, bgmInstanceId)).toHaveLength(1);

    backend.emitEnd(meInstanceId);

    expect(bgm.state).toBe(PlaybackState.PAUSED);
    expect(resumeOps(backend.operations, bgmInstanceId)).toHaveLength(0);
  });

  it("pauses new BGM started during ME playback", async () => {
    SoundManager.Initialize({ pauseBgmDuringMe: true });
    const backend = SoundManager.getBackendForTesting()!;
    await registerAndPreloadSounds(["bgm-a", "bgm-b", "me-1"]);

    SoundManager.PlayBGM(
      new BgmPlayAttributes({ id: "bgm-a", fadeSeconds: 0 }),
    );

    const me = SoundManager.PlayME({ id: "me-1" });
    const meInstanceId = SoundManager.getBackendInstanceIdForTesting(me)!;

    const newBgm = SoundManager.PlayBGM(
      new BgmPlayAttributes({ id: "bgm-b", fadeSeconds: 0 }),
    );
    const newBgmInstanceId =
      SoundManager.getBackendInstanceIdForTesting(newBgm)!;

    expect(newBgm.state).toBe(PlaybackState.PAUSED);
    expect(pauseOps(backend.operations, newBgmInstanceId)).toHaveLength(1);

    backend.emitEnd(meInstanceId);

    expect(newBgm.state).toBe(PlaybackState.PLAYING);
    expect(resumeOps(backend.operations, newBgmInstanceId)).toHaveLength(1);
  });

  it("pauses both sides of a crossfade started during ME playback", async () => {
    SoundManager.Initialize({ pauseBgmDuringMe: true });
    const backend = SoundManager.getBackendForTesting()!;
    await registerAndPreloadSounds(["bgm-a", "bgm-b", "me-1"]);

    SoundManager.PlayBGM(
      new BgmPlayAttributes({ id: "bgm-a", fadeSeconds: 0 }),
    );

    const me = SoundManager.PlayME({ id: "me-1" });
    const meInstanceId = SoundManager.getBackendInstanceIdForTesting(me)!;

    const firstBgm = SoundManager.PlayBGM(
      new BgmPlayAttributes({ id: "bgm-a", fadeSeconds: 1 }),
    );
    const secondBgm = SoundManager.PlayBGM(
      new BgmPlayAttributes({ id: "bgm-b", fadeSeconds: 1 }),
    );
    const firstBgmInstanceId =
      SoundManager.getBackendInstanceIdForTesting(firstBgm)!;
    const secondBgmInstanceId =
      SoundManager.getBackendInstanceIdForTesting(secondBgm)!;

    expect(firstBgm.state).toBe(PlaybackState.PAUSED);
    expect(secondBgm.state).toBe(PlaybackState.PAUSED);
    expect(pauseOps(backend.operations, firstBgmInstanceId).length).toBeGreaterThan(
      0,
    );
    expect(pauseOps(backend.operations, secondBgmInstanceId)).toHaveLength(1);

    backend.emitEnd(meInstanceId);

    expect(firstBgm.state).toBe(PlaybackState.PLAYING);
    expect(secondBgm.state).toBe(PlaybackState.PLAYING);
  });

  it("resumes BGM when the last ME is stopped via StopME", async () => {
    SoundManager.Initialize({ pauseBgmDuringMe: true });
    const backend = SoundManager.getBackendForTesting()!;
    await registerAndPreloadSounds(["bgm-a", "me-1"]);

    const bgm = SoundManager.PlayBGM(
      new BgmPlayAttributes({ id: "bgm-a", fadeSeconds: 0 }),
    );
    const bgmInstanceId = SoundManager.getBackendInstanceIdForTesting(bgm)!;

    const me = SoundManager.PlayME({ id: "me-1" });
    expect(bgm.state).toBe(PlaybackState.PAUSED);

    SoundManager.StopME(me);

    expect(me.state).toBe(PlaybackState.STOPPED);
    expect(bgm.state).toBe(PlaybackState.PLAYING);
    expect(resumeOps(backend.operations, bgmInstanceId)).toHaveLength(1);
  });

  it("resumes BGM when the last ME ends with an error", async () => {
    SoundManager.Initialize({ pauseBgmDuringMe: true });
    const backend = SoundManager.getBackendForTesting()!;
    await registerAndPreloadSounds(["bgm-a", "me-1"]);

    const bgm = SoundManager.PlayBGM(
      new BgmPlayAttributes({ id: "bgm-a", fadeSeconds: 0 }),
    );
    const bgmInstanceId = SoundManager.getBackendInstanceIdForTesting(bgm)!;

    const me = SoundManager.PlayME({ id: "me-1" });
    const meInstanceId = SoundManager.getBackendInstanceIdForTesting(me)!;

    expect(bgm.state).toBe(PlaybackState.PAUSED);

    backend.emitError(meInstanceId, new Error("me failed"));

    expect(me.state).toBe(PlaybackState.ERROR);
    expect(bgm.state).toBe(PlaybackState.PLAYING);
    expect(resumeOps(backend.operations, bgmInstanceId)).toHaveLength(1);
  });

  it("resumes BGM when StopAllME clears the last active ME", async () => {
    SoundManager.Initialize({ meChannelCount: 2, pauseBgmDuringMe: true });
    const backend = SoundManager.getBackendForTesting()!;
    await registerAndPreloadSounds(["bgm-a", "me-1", "me-2"]);

    const bgm = SoundManager.PlayBGM(
      new BgmPlayAttributes({ id: "bgm-a", fadeSeconds: 0 }),
    );
    const bgmInstanceId = SoundManager.getBackendInstanceIdForTesting(bgm)!;

    SoundManager.PlayME({ id: "me-1" });
    SoundManager.PlayME({ id: "me-2" });
    expect(bgm.state).toBe(PlaybackState.PAUSED);

    SoundManager.StopAllME();

    expect(bgm.state).toBe(PlaybackState.PLAYING);
    expect(resumeOps(backend.operations, bgmInstanceId)).toHaveLength(1);
  });

  it("does not expose PauseAllBGM on the public API", () => {
    SoundManager.Initialize();
    expect("PauseAllBGM" in SoundManager).toBe(false);
  });

  it("uses loop 0 by default for one-shot ME playback", async () => {
    SoundManager.Initialize();
    const backend = SoundManager.getBackendForTesting()!;
    await registerAndPreloadSounds(["me-1"]);

    const me = SoundManager.PlayME({ id: "me-1" });
    const meInstanceId = instanceIdFor(backend.operations, "me-1")!;

    const playOp = backend.operations.find(
      (op): op is Extract<AudioBackendOperation, { type: "play" }> =>
        op.type === "play" && op.instanceId === meInstanceId,
    );
    expect(playOp?.options.loop).toBe(0);

    backend.emitEnd(meInstanceId);
    expect(me.state).toBe(PlaybackState.ENDED);
  });
});
