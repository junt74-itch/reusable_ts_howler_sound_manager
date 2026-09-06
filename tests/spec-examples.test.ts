import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  BgmPlayAttributes,
  BgsPlayAttributes,
  MePlayAttributes,
  NotInitializedError,
  PlaybackState,
  SePlayAttributes,
  SoundCategory,
  SoundManager,
  SystemSePlayAttributes,
} from "../src/index.js";

import { registerAndPreloadSounds } from "./test-helpers.js";

describe("spec API examples", () => {
  beforeEach(() => {
    SoundManager.resetForTesting();
  });

  afterEach(() => {
    SoundManager.resetForTesting();
    vi.restoreAllMocks();
  });

  it("matches initialization and playback examples from the spec", async () => {
    SoundManager.Initialize({
      meChannelCount: 1,
      pauseBgmDuringMe: true,
    });
    await registerAndPreloadSounds([
      "that-music",
      "rain",
      "fanfare",
      "hit",
      "explosion",
      "ui-confirm",
    ]);

    const bpa = new BgmPlayAttributes({
      id: "that-music",
      volume: 1.0,
      pan: 0.5,
      loop: -1,
      initialAudioPosition: 0,
      fadeSeconds: 1,
    });

    const bgm = SoundManager.PlayBGM(bpa);
    const bgs = SoundManager.PlayBGS({
      channel: 0,
      id: "rain",
      volume: 0.8,
    });
    const me = SoundManager.PlayME({ id: "fanfare" });
    SoundManager.PlaySE({ id: "hit", volume: 1.0 });
    const se = SoundManager.PlaySE({ id: "explosion" });
    const systemSe = SoundManager.PlaySystemSE({ id: "ui-confirm" });

    SoundManager.StopBGM(bgm);
    SoundManager.StopBGS(bgs);
    SoundManager.StopME(me);
    SoundManager.StopSE(se);
    SoundManager.StopSystemSE(systemSe);
    SoundManager.Stop(bgm);

    expect(bgm.soundId).toBe("that-music");
    expect(bgs.channel).toBe(0);
    expect(me.category).toBe(SoundCategory.ME);
    expect(se.category).toBe(SoundCategory.SE);
    expect(systemSe.category).toBe(SoundCategory.SYSTEM_SE);
  });

  it("matches catalog workflow signatures from the spec", async () => {
    SoundManager.Initialize();
    const backend = SoundManager.getBackendForTesting()!;

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          version: 1,
          resources: {
            "ui-confirm": { src: ["audio/ui/confirm.ogg"] },
            "forest-bgm": { src: ["audio/bgm/forest.ogg"] },
            rain: { src: ["audio/bgs/rain.ogg"] },
          },
          groups: {
            common: ["ui-confirm"],
            forest: ["forest-bgm", "rain"],
            "rainy-town": ["rain"],
          },
        }),
      })),
    );

    await SoundManager.LoadCatalog("audio/catalog.json");
    await SoundManager.PreloadGroup("common");
    await SoundManager.PreloadGroup("forest");
    await SoundManager.PreloadGroup("rainy-town");

    const bgmParams = new BgmPlayAttributes({ id: "forest-bgm" });
    const bgm = SoundManager.PlayBGM(bgmParams);

    await SoundManager.UnloadGroup("forest");

    expect(bgm.state).toBe(PlaybackState.PLAYING);
    expect(backend.operations.some((op) => op.type === "load")).toBe(true);
    expect(backend.isSoundLoaded("forest-bgm")).toBe(true);
    expect(backend.isSoundLoaded("rain")).toBe(true);
  });
});

describe("SoundManager initialization guard", () => {
  beforeEach(() => {
    SoundManager.resetForTesting();
  });

  afterEach(() => {
    SoundManager.resetForTesting();
    vi.restoreAllMocks();
  });

  it("throws before Initialize for playback and catalog APIs", () => {
    expect(() => SoundManager.PlayBGM({ id: "x" })).toThrow(NotInitializedError);
    expect(() => SoundManager.StopAll()).toThrow(NotInitializedError);
    expect(() => void SoundManager.LoadCatalog("x")).toThrow(NotInitializedError);
    expect(() => void SoundManager.PreloadGroup("x")).toThrow(NotInitializedError);
    expect(() => void SoundManager.UnloadGroup("x")).toThrow(NotInitializedError);
  });
});
