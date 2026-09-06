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

function playInstanceIdForSound(
  operations: AudioBackendOperation[],
  soundId: string,
): number | undefined {
  const op = operations.find(
    (entry) => entry.type === "play" && entry.options.soundId === soundId,
  );
  return op?.type === "play" ? op.instanceId : undefined;
}

describe("SE category", () => {
  beforeEach(() => {
    SoundManager.resetForTesting();
  });

  afterEach(() => {
    SoundManager.resetForTesting();
  });

  it("auto-assigns channels and allows fire-and-forget playback", async () => {
    SoundManager.Initialize();
    await registerAndPreloadSounds(["hit", "explosion"]);

    SoundManager.PlaySE({ id: "hit", volume: 1.0 });
    const kept = SoundManager.PlaySE({ id: "explosion" });

    expect(kept.category).toBe(SoundCategory.SE);
    expect(kept.state).toBe(PlaybackState.PLAYING);
    expect(kept.channel).toBeGreaterThanOrEqual(0);
    expect(kept.channel).toBeLessThan(16);
  });

  it("releases the channel when playback ends", async () => {
    SoundManager.Initialize();
    const backend = SoundManager.getBackendForTesting()!;
    const soundIds = Array.from({ length: 16 }, (_, index) => `se-${index}`);
    await registerAndPreloadSounds(soundIds);

    const handles = soundIds.map((id) => SoundManager.PlaySE({ id }));
    const oldest = handles[0]!;
    const oldestInstanceId = playInstanceIdForSound(backend.operations, "se-0")!;

    backend.emitEnd(oldestInstanceId);

    const replacement = SoundManager.PlaySE({ id: "se-0" });
    expect(replacement.channel).toBe(oldest.channel);
    expect(oldest.state).toBe(PlaybackState.ENDED);
    expect(replacement.state).toBe(PlaybackState.PLAYING);
  });

  it("steals the oldest channel when all 16 slots are full", async () => {
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
  });

  it("stops playback via StopSE(handle)", async () => {
    SoundManager.Initialize();
    const backend = SoundManager.getBackendForTesting()!;
    await registerAndPreloadSounds(["hit"]);

    const handle = SoundManager.PlaySE({ id: "hit" });
    const instanceId = lastPlayInstanceId(backend.operations)!;

    SoundManager.StopSE(handle);

    expect(handle.state).toBe(PlaybackState.STOPPED);
    expect(
      backend.operations.some(
        (op) => op.type === "stop" && op.instanceId === instanceId,
      ),
    ).toBe(true);
  });
});

describe("SYSTEM SE category", () => {
  beforeEach(() => {
    SoundManager.resetForTesting();
  });

  afterEach(() => {
    SoundManager.resetForTesting();
  });

  it("auto-assigns channels independently from SE", async () => {
    SoundManager.Initialize();
    await registerAndPreloadSounds(["ui-confirm", "ui-cancel"]);

    const systemSe = SoundManager.PlaySystemSE({ id: "ui-confirm" });

    expect(systemSe.category).toBe(SoundCategory.SYSTEM_SE);
    expect(systemSe.channel).toBeGreaterThanOrEqual(0);
    expect(systemSe.channel).toBeLessThan(4);
    expect(systemSe.state).toBe(PlaybackState.PLAYING);
  });

  it("releases the channel when playback ends", async () => {
    SoundManager.Initialize();
    const backend = SoundManager.getBackendForTesting()!;
    const soundIds = Array.from({ length: 4 }, (_, index) => `sys-${index}`);
    await registerAndPreloadSounds(soundIds);

    const handles = soundIds.map((id) => SoundManager.PlaySystemSE({ id }));
    const oldest = handles[0]!;
    const oldestInstanceId = playInstanceIdForSound(backend.operations, "sys-0")!;

    backend.emitEnd(oldestInstanceId);

    const replacement = SoundManager.PlaySystemSE({ id: "sys-0" });
    expect(replacement.channel).toBe(oldest.channel);
    expect(oldest.state).toBe(PlaybackState.ENDED);
    expect(replacement.state).toBe(PlaybackState.PLAYING);
  });

  it("steals the oldest channel when all 4 slots are full", async () => {
    SoundManager.Initialize();
    const soundIds = [
      ...Array.from({ length: 4 }, (_, index) => `sys-${index}`),
      "sys-new",
    ];
    await registerAndPreloadSounds(soundIds);

    const handles = Array.from({ length: 4 }, (_, index) =>
      SoundManager.PlaySystemSE({ id: `sys-${index}` }),
    );
    const oldest = handles[0]!;
    const newest = SoundManager.PlaySystemSE({ id: "sys-new" });

    expect(newest.channel).toBe(oldest.channel);
    expect(oldest.state).toBe(PlaybackState.STOPPED);
    expect(newest.state).toBe(PlaybackState.PLAYING);
  });

  it("stops playback via StopSystemSE(handle)", async () => {
    SoundManager.Initialize();
    const backend = SoundManager.getBackendForTesting()!;
    await registerAndPreloadSounds(["ui-confirm"]);

    const handle = SoundManager.PlaySystemSE({ id: "ui-confirm" });
    const instanceId = lastPlayInstanceId(backend.operations)!;

    SoundManager.StopSystemSE(handle);

    expect(handle.state).toBe(PlaybackState.STOPPED);
    expect(
      backend.operations.some(
        (op) => op.type === "stop" && op.instanceId === instanceId,
      ),
    ).toBe(true);
  });
});

describe("BGS category", () => {
  beforeEach(() => {
    SoundManager.resetForTesting();
  });

  afterEach(() => {
    SoundManager.resetForTesting();
  });

  it("plays up to 4 sounds on distinct channels", async () => {
    SoundManager.Initialize();
    await registerAndPreloadSounds(["rain", "wind", "river", "birds"]);

    const handles = [
      SoundManager.PlayBGS({ channel: 0, id: "rain" }),
      SoundManager.PlayBGS({ channel: 1, id: "wind" }),
      SoundManager.PlayBGS({ channel: 2, id: "river" }),
      SoundManager.PlayBGS({ channel: 3, id: "birds" }),
    ];

    expect(handles.map((handle) => handle.channel)).toEqual([0, 1, 2, 3]);
    expect(handles.every((handle) => handle.state === PlaybackState.PLAYING)).toBe(
      true,
    );
  });

  it("replaces existing playback on the same channel", async () => {
    SoundManager.Initialize();
    const backend = SoundManager.getBackendForTesting()!;
    await registerAndPreloadSounds(["old", "new"]);

    const first = SoundManager.PlayBGS({ channel: 0, id: "old" });
    const firstInstanceId = lastPlayInstanceId(backend.operations)!;

    const second = SoundManager.PlayBGS({ channel: 0, id: "new" });

    expect(first.state).toBe(PlaybackState.STOPPED);
    expect(second.state).toBe(PlaybackState.PLAYING);
    expect(second.channel).toBe(0);
    expect(
      backend.operations.some(
        (op) => op.type === "stop" && op.instanceId === firstInstanceId,
      ),
    ).toBe(true);
  });

  it("keeps a playing BGS loaded when its group is unloaded then the same sound is replayed", async () => {
    SoundManager.Initialize();
    const backend = SoundManager.getBackendForTesting()!;
    SoundManager.registerCatalogForTesting(
      {
        version: 1,
        resources: { rain: { src: ["audio/rain.ogg"] } },
        groups: { weather: ["rain"] },
      },
      "https://example.test/catalog.json",
    );
    await SoundManager.PreloadGroup("weather");

    const first = SoundManager.PlayBGS({ channel: 0, id: "rain" });
    await SoundManager.UnloadGroup("weather");
    expect(backend.isSoundLoaded("rain")).toBe(true);

    const second = SoundManager.PlayBGS({ channel: 0, id: "rain" });

    expect(first.state).toBe(PlaybackState.STOPPED);
    expect(second.state).toBe(PlaybackState.PLAYING);
    expect(backend.isSoundLoaded("rain")).toBe(true);
    expect(
      backend.operations.filter((op) => op.type === "unload" && op.soundId === "rain"),
    ).toHaveLength(0);
  });

  it("defaults to infinite loop so emitEnd does not end playback", async () => {
    SoundManager.Initialize();
    const backend = SoundManager.getBackendForTesting()!;
    await registerAndPreloadSounds(["rain"]);

    const handle = SoundManager.PlayBGS({ channel: 0, id: "rain" });
    const instanceId = lastPlayInstanceId(backend.operations)!;
    const playOp = backend.operations.find(
      (op) => op.type === "play" && op.instanceId === instanceId,
    ) as Extract<AudioBackendOperation, { type: "play" }>;

    expect(playOp.options.loop).toBe(-1);

    backend.emitEnd(instanceId);

    expect(handle.state).toBe(PlaybackState.PLAYING);
    expect(handle.isActive()).toBe(true);
  });

  it("ends when loop is explicitly set to 0", async () => {
    SoundManager.Initialize();
    const backend = SoundManager.getBackendForTesting()!;
    await registerAndPreloadSounds(["one-shot"]);

    const handle = SoundManager.PlayBGS({ channel: 1, id: "one-shot", loop: 0 });
    const instanceId = lastPlayInstanceId(backend.operations)!;

    backend.emitEnd(instanceId);

    expect(handle.state).toBe(PlaybackState.ENDED);
    expect(handle.isActive()).toBe(false);
  });

  it("stops via handle and channel number", async () => {
    SoundManager.Initialize();
    const backend = SoundManager.getBackendForTesting()!;
    await registerAndPreloadSounds(["rain", "wind"]);

    const byHandle = SoundManager.PlayBGS({ channel: 0, id: "rain" });
    const byChannel = SoundManager.PlayBGS({ channel: 1, id: "wind" });
    const handleInstanceId = playInstanceIdForSound(backend.operations, "rain")!;
    const channelInstanceId = playInstanceIdForSound(backend.operations, "wind")!;

    SoundManager.StopBGS(byHandle);
    SoundManager.StopBGS(1);

    expect(byHandle.state).toBe(PlaybackState.STOPPED);
    expect(byChannel.state).toBe(PlaybackState.STOPPED);
    expect(
      backend.operations.filter((op) => op.type === "stop").map((op) => op.instanceId),
    ).toContain(handleInstanceId);
    expect(
      backend.operations.filter((op) => op.type === "stop").map((op) => op.instanceId),
    ).toContain(channelInstanceId);
  });
});

describe("SE / SYSTEM SE / BGS independence", () => {
  beforeEach(() => {
    SoundManager.resetForTesting();
  });

  afterEach(() => {
    SoundManager.resetForTesting();
  });

  it("keeps SYSTEM SE playable when all SE slots are full", async () => {
    SoundManager.Initialize();
    const seIds = Array.from({ length: 16 }, (_, index) => `se-${index}`);
    await registerAndPreloadSounds([...seIds, "ui-confirm"]);

    seIds.forEach((id) => {
      SoundManager.PlaySE({ id });
    });

    const systemSe = SoundManager.PlaySystemSE({ id: "ui-confirm" });
    expect(systemSe.state).toBe(PlaybackState.PLAYING);
    expect(systemSe.category).toBe(SoundCategory.SYSTEM_SE);
  });

  it("keeps SE playable when all SYSTEM SE slots are full", async () => {
    SoundManager.Initialize();
    const systemIds = Array.from({ length: 4 }, (_, index) => `sys-${index}`);
    await registerAndPreloadSounds([...systemIds, "hit"]);

    systemIds.forEach((id) => {
      SoundManager.PlaySystemSE({ id });
    });

    const se = SoundManager.PlaySE({ id: "hit" });
    expect(se.state).toBe(PlaybackState.PLAYING);
    expect(se.category).toBe(SoundCategory.SE);
  });

  it("StopAllSE does not stop SYSTEM SE", async () => {
    SoundManager.Initialize();
    await registerAndPreloadSounds(["hit", "ui-confirm"]);

    const se = SoundManager.PlaySE({ id: "hit" });
    const systemSe = SoundManager.PlaySystemSE({ id: "ui-confirm" });

    SoundManager.StopAllSE();

    expect(se.state).toBe(PlaybackState.STOPPED);
    expect(systemSe.state).toBe(PlaybackState.PLAYING);
  });

  it("StopAllSystemSE does not stop SE", async () => {
    SoundManager.Initialize();
    await registerAndPreloadSounds(["hit", "ui-confirm"]);

    const se = SoundManager.PlaySE({ id: "hit" });
    const systemSe = SoundManager.PlaySystemSE({ id: "ui-confirm" });

    SoundManager.StopAllSystemSE();

    expect(systemSe.state).toBe(PlaybackState.STOPPED);
    expect(se.state).toBe(PlaybackState.PLAYING);
  });

  it("ignores cross-category stop requests", async () => {
    SoundManager.Initialize();
    const backend = SoundManager.getBackendForTesting()!;
    await registerAndPreloadSounds(["hit", "ui-confirm"]);

    const se = SoundManager.PlaySE({ id: "hit" });
    const systemSe = SoundManager.PlaySystemSE({ id: "ui-confirm" });
    const stopCountBefore = backend.operations.filter(
      (op) => op.type === "stop",
    ).length;

    SoundManager.StopSE(systemSe);
    SoundManager.StopSystemSE(se);

    expect(se.state).toBe(PlaybackState.PLAYING);
    expect(systemSe.state).toBe(PlaybackState.PLAYING);
    expect(backend.operations.filter((op) => op.type === "stop")).toHaveLength(
      stopCountBefore,
    );
  });
});
