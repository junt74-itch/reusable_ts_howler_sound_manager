import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type AudioBackendOperation } from "../src/audio-backend.js";
import {
  BgmPlayAttributes,
  CatalogFailureError,
  PlaybackState,
  PreloadFailureError,
  SoundManager,
  SoundNotLoadedError,
  UnknownSoundIdError,
} from "../src/index.js";
import { registerAndPreloadSounds } from "./test-helpers.js";

const SPEC_CATALOG = {
  version: 1,
  resources: {
    "ui-confirm": {
      src: ["audio/ui/confirm.ogg", "audio/ui/confirm.mp3"],
    },
    "forest-bgm": {
      src: ["audio/bgm/forest.ogg"],
    },
    rain: {
      src: ["audio/bgs/rain.ogg"],
    },
    "bad-load": {
      src: ["audio/bad.ogg"],
    },
  },
  groups: {
    common: ["ui-confirm"],
    forest: ["forest-bgm", "rain"],
    "rainy-town": ["rain"],
    broken: ["bad-load"],
  },
} as const;

const CATALOG_URL = "https://example.test/catalog.json";

function loadOperations(operations: AudioBackendOperation[]): number {
  return operations.filter((op) => op.type === "load").length;
}

function loadedSoundIds(operations: AudioBackendOperation[]): string[] {
  return operations
    .filter((op) => op.type === "load")
    .map((op) => op.soundId);
}

function unloadedSoundIds(operations: AudioBackendOperation[]): string[] {
  return operations
    .filter((op) => op.type === "unload")
    .map((op) => op.soundId);
}

describe("catalog registration", () => {
  beforeEach(() => {
    SoundManager.resetForTesting();
  });

  afterEach(() => {
    SoundManager.resetForTesting();
    vi.restoreAllMocks();
  });

  it("registers catalog without loading audio files", async () => {
    SoundManager.Initialize();
    const backend = SoundManager.getBackendForTesting()!;

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => SPEC_CATALOG,
      })),
    );

    await SoundManager.LoadCatalog(CATALOG_URL);

    expect(loadOperations(backend.operations)).toBe(0);
    expect(SoundManager.getResourceStoreForTesting()?.isGroupLoaded("forest")).toBe(
      false,
    );
  });

  it("resolves relative src URLs against response.url when fetch returns a final URL", async () => {
    SoundManager.Initialize();
    const backend = SoundManager.getBackendForTesting()!;

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        url: "http://localhost:5173/catalog.json",
        json: async () => ({
          version: 1,
          resources: {
            "demo-se": { src: ["audio/demo-se.wav"] },
          },
          groups: { common: ["demo-se"] },
        }),
      })),
    );

    await SoundManager.LoadCatalog("/catalog.json");
    await SoundManager.PreloadGroup("common");

    const load = backend.operations.find(
      (op) => op.type === "load" && op.soundId === "demo-se",
    );
    expect(load).toMatchObject({
      type: "load",
      urls: ["http://localhost:5173/audio/demo-se.wav"],
    });
  });

  it("resolves relative src URLs against the catalog URL", async () => {
    SoundManager.Initialize();
    const backend = SoundManager.getBackendForTesting()!;
    backend.setLoadResult("forest-bgm", "success");

    SoundManager.registerCatalogForTesting(SPEC_CATALOG, CATALOG_URL);
    await SoundManager.PreloadGroup("forest");

    const rainLoad = backend.operations.find(
      (op) => op.type === "load" && op.soundId === "rain",
    );
    expect(rainLoad).toMatchObject({
      type: "load",
      urls: ["https://example.test/audio/bgs/rain.ogg"],
    });
  });

  it("rejects duplicate sound IDs across catalogs", () => {
    SoundManager.Initialize();
    SoundManager.registerCatalogForTesting(SPEC_CATALOG, CATALOG_URL);

    expect(() =>
      SoundManager.registerCatalogForTesting(
        {
          version: 1,
          resources: { rain: { src: ["other.ogg"] } },
          groups: {},
        },
        CATALOG_URL,
      ),
    ).toThrow(CatalogFailureError);
  });

  it("rejects unknown group member IDs at registration time", () => {
    SoundManager.Initialize();

    expect(() =>
      SoundManager.registerCatalogForTesting(
        {
          version: 1,
          resources: { known: { src: ["a.ogg"] } },
          groups: { g: ["missing-id"] },
        },
        CATALOG_URL,
      ),
    ).toThrow(/unknown sound ID/i);
  });

  it("allows later catalogs to reference already registered sound IDs in groups", () => {
    SoundManager.Initialize();
    SoundManager.registerCatalogForTesting(
      {
        version: 1,
        resources: { shared: { src: ["shared.ogg"] } },
        groups: { base: ["shared"] },
      },
      CATALOG_URL,
    );

    expect(() =>
      SoundManager.registerCatalogForTesting(
        {
          version: 1,
          resources: {},
          groups: { extended: ["shared"] },
        },
        CATALOG_URL,
      ),
    ).not.toThrow();

    expect(SoundManager.getResourceStoreForTesting()?.isGroupLoaded("extended")).toBe(
      false,
    );
  });
});

describe("PreloadGroup", () => {
  beforeEach(() => {
    SoundManager.resetForTesting();
  });

  afterEach(() => {
    SoundManager.resetForTesting();
    vi.restoreAllMocks();
  });

  it("deduplicates concurrent loads for the same sound ID", async () => {
    SoundManager.Initialize();
    const backend = SoundManager.getBackendForTesting()!;
    SoundManager.registerCatalogForTesting(SPEC_CATALOG, CATALOG_URL);

    await Promise.all([
      SoundManager.PreloadGroup("forest"),
      SoundManager.PreloadGroup("rainy-town"),
    ]);

    expect(loadOperations(backend.operations)).toBe(2);
    expect(new Set(loadedSoundIds(backend.operations))).toEqual(
      new Set(["forest-bgm", "rain"]),
    );
  });

  it("shares the same in-flight group preload promise", async () => {
    SoundManager.Initialize();
    SoundManager.registerCatalogForTesting(SPEC_CATALOG, CATALOG_URL);

    const first = SoundManager.PreloadGroup("common");
    const second = SoundManager.PreloadGroup("common");
    expect(first).toBe(second);
    await first;
  });

  it("returns immediately when the group is already preloaded", async () => {
    SoundManager.Initialize();
    const backend = SoundManager.getBackendForTesting()!;
    SoundManager.registerCatalogForTesting(SPEC_CATALOG, CATALOG_URL);

    await SoundManager.PreloadGroup("common");
    const loadCount = loadOperations(backend.operations);

    await SoundManager.PreloadGroup("common");
    expect(loadOperations(backend.operations)).toBe(loadCount);
  });

  it("keeps successful loads on partial failure and exposes failedIds", async () => {
    SoundManager.Initialize();
    const backend = SoundManager.getBackendForTesting()!;
    backend.setLoadResult("bad-load", "failure");
    SoundManager.registerCatalogForTesting(SPEC_CATALOG, CATALOG_URL);

    await expect(SoundManager.PreloadGroup("broken")).rejects.toMatchObject({
      failedIds: ["bad-load"],
    });

    expect(backend.isSoundLoaded("bad-load")).toBe(false);
    expect(SoundManager.getResourceStoreForTesting()?.isGroupLoaded("broken")).toBe(
      false,
    );
  });

  it("allows retrying failed IDs on a later preload", async () => {
    SoundManager.Initialize();
    const backend = SoundManager.getBackendForTesting()!;
    backend.setLoadResult("bad-load", "failure");
    SoundManager.registerCatalogForTesting(SPEC_CATALOG, CATALOG_URL);

    await expect(SoundManager.PreloadGroup("broken")).rejects.toBeInstanceOf(
      PreloadFailureError,
    );

    backend.setLoadResult("bad-load", "success");
    await SoundManager.PreloadGroup("broken");

    expect(backend.isSoundLoaded("bad-load")).toBe(true);
    expect(SoundManager.getResourceStoreForTesting()?.isGroupLoaded("broken")).toBe(
      true,
    );
  });
});

describe("UnloadGroup", () => {
  beforeEach(() => {
    SoundManager.resetForTesting();
  });

  afterEach(() => {
    SoundManager.resetForTesting();
    vi.restoreAllMocks();
  });

  it("does not unload sounds shared with another loaded group", async () => {
    SoundManager.Initialize();
    const backend = SoundManager.getBackendForTesting()!;
    SoundManager.registerCatalogForTesting(SPEC_CATALOG, CATALOG_URL);

    await SoundManager.PreloadGroup("forest");
    await SoundManager.PreloadGroup("rainy-town");
    await SoundManager.UnloadGroup("forest");

    expect(unloadedSoundIds(backend.operations)).not.toContain("rain");
    expect(backend.isSoundLoaded("rain")).toBe(true);
    expect(unloadedSoundIds(backend.operations)).toContain("forest-bgm");
  });

  it("succeeds idempotently when the group was never preloaded", async () => {
    SoundManager.Initialize();
    SoundManager.registerCatalogForTesting(SPEC_CATALOG, CATALOG_URL);

    await expect(SoundManager.UnloadGroup("forest")).resolves.toBeUndefined();
  });

  it("keeps sounds that are still playing or paused", async () => {
    SoundManager.Initialize();
    const backend = SoundManager.getBackendForTesting()!;
    SoundManager.registerCatalogForTesting(SPEC_CATALOG, CATALOG_URL);
    await SoundManager.PreloadGroup("forest");

    const handle = SoundManager.PlayBGS({ channel: 0, id: "rain", volume: 1 });
    SoundManager.Pause(handle);
    await SoundManager.UnloadGroup("forest");

    expect(backend.isSoundLoaded("rain")).toBe(true);
    expect(unloadedSoundIds(backend.operations)).toContain("forest-bgm");
  });

  it("discards in-flight loads when unreferenced before completion", async () => {
    SoundManager.Initialize();
    const backend = SoundManager.getBackendForTesting()!;

    let resolveLoad: (() => void) | undefined;
    const loadGate = new Promise<void>((resolve) => {
      resolveLoad = resolve;
    });

    const originalLoad = backend.load.bind(backend);
    vi.spyOn(backend, "load").mockImplementation(async (soundId, urls) => {
      backend.operations.push({ type: "load", soundId, urls });
      await loadGate;
      backend.setLoadResult(soundId, "success");
      return originalLoad(soundId, urls);
    });

    SoundManager.registerCatalogForTesting(
      {
        version: 1,
        resources: { solo: { src: ["solo.ogg"] } },
        groups: { solo: ["solo"] },
      },
      CATALOG_URL,
    );

    const preload = SoundManager.PreloadGroup("solo");
    await SoundManager.UnloadGroup("solo");
    resolveLoad?.();
    await expect(preload).rejects.toBeInstanceOf(PreloadFailureError);

    expect(backend.isSoundLoaded("solo")).toBe(false);
    expect(unloadedSoundIds(backend.operations)).toContain("solo");
  });

  it("keeps shared in-flight loads when one of two groups is unloaded", async () => {
    SoundManager.Initialize();
    const backend = SoundManager.getBackendForTesting()!;

    let resolveLoad: (() => void) | undefined;
    const loadGate = new Promise<void>((resolve) => {
      resolveLoad = resolve;
    });

    const originalLoad = backend.load.bind(backend);
    vi.spyOn(backend, "load").mockImplementation(async (soundId, urls) => {
      backend.operations.push({ type: "load", soundId, urls });
      await loadGate;
      backend.setLoadResult(soundId, "success");
      return originalLoad(soundId, urls);
    });

    SoundManager.registerCatalogForTesting(
      {
        version: 1,
        resources: { shared: { src: ["shared.ogg"] } },
        groups: { a: ["shared"], b: ["shared"] },
      },
      CATALOG_URL,
    );

    const preloadA = SoundManager.PreloadGroup("a");
    const preloadB = SoundManager.PreloadGroup("b");
    await SoundManager.UnloadGroup("a");
    resolveLoad?.();

    await expect(preloadA).rejects.toBeInstanceOf(PreloadFailureError);
    await expect(preloadB).resolves.toBeUndefined();

    expect(backend.isSoundLoaded("shared")).toBe(true);
    expect(SoundManager.getResourceStoreForTesting()?.isGroupLoaded("a")).toBe(
      false,
    );
    expect(SoundManager.getResourceStoreForTesting()?.isGroupLoaded("b")).toBe(
      true,
    );
  });

  it("does not revive a group unloaded while its preload is still finishing", async () => {
    SoundManager.Initialize();
    const backend = SoundManager.getBackendForTesting()!;
    SoundManager.registerCatalogForTesting(SPEC_CATALOG, CATALOG_URL);

    await SoundManager.PreloadGroup("forest");

    const rainy = SoundManager.PreloadGroup("rainy-town");
    await SoundManager.UnloadGroup("rainy-town");
    await expect(rainy).rejects.toBeInstanceOf(PreloadFailureError);

    expect(SoundManager.getResourceStoreForTesting()?.isGroupLoaded("rainy-town")).toBe(
      false,
    );
    expect(backend.isSoundLoaded("rain")).toBe(true);
  });

  it("does not discard a load when a new group starts preloading before it finishes", async () => {
    SoundManager.Initialize();
    const backend = SoundManager.getBackendForTesting()!;

    let resolveLoad: (() => void) | undefined;
    const loadGate = new Promise<void>((resolve) => {
      resolveLoad = resolve;
    });

    const originalLoad = backend.load.bind(backend);
    vi.spyOn(backend, "load").mockImplementation(async (soundId, urls) => {
      backend.operations.push({ type: "load", soundId, urls });
      await loadGate;
      backend.setLoadResult(soundId, "success");
      return originalLoad(soundId, urls);
    });

    SoundManager.registerCatalogForTesting(
      {
        version: 1,
        resources: { shared: { src: ["shared.ogg"] } },
        groups: { a: ["shared"], b: ["shared"] },
      },
      CATALOG_URL,
    );

    const preloadA = SoundManager.PreloadGroup("a");
    await SoundManager.UnloadGroup("a");
    const preloadB = SoundManager.PreloadGroup("b");
    resolveLoad?.();

    await expect(preloadA).rejects.toBeInstanceOf(PreloadFailureError);
    await expect(preloadB).resolves.toBeUndefined();

    expect(backend.isSoundLoaded("shared")).toBe(true);
    expect(SoundManager.getResourceStoreForTesting()?.isGroupLoaded("b")).toBe(
      true,
    );
  });

  it("allows re-preloading the same group after unloading an in-flight preload", async () => {
    SoundManager.Initialize();
    const backend = SoundManager.getBackendForTesting()!;

    let resolveLoad: (() => void) | undefined;
    const loadGate = new Promise<void>((resolve) => {
      resolveLoad = resolve;
    });

    const originalLoad = backend.load.bind(backend);
    vi.spyOn(backend, "load").mockImplementation(async (soundId, urls) => {
      backend.operations.push({ type: "load", soundId, urls });
      await loadGate;
      backend.setLoadResult(soundId, "success");
      return originalLoad(soundId, urls);
    });

    SoundManager.registerCatalogForTesting(
      {
        version: 1,
        resources: { solo: { src: ["solo.ogg"] } },
        groups: { solo: ["solo"] },
      },
      CATALOG_URL,
    );

    const first = SoundManager.PreloadGroup("solo");
    await SoundManager.UnloadGroup("solo");
    const second = SoundManager.PreloadGroup("solo");
    resolveLoad?.();

    await expect(first).rejects.toBeInstanceOf(PreloadFailureError);
    await expect(second).resolves.toBeUndefined();

    expect(backend.isSoundLoaded("solo")).toBe(true);
    expect(SoundManager.getResourceStoreForTesting()?.isGroupLoaded("solo")).toBe(
      true,
    );
  });
});

describe("playback guards", () => {
  beforeEach(() => {
    SoundManager.resetForTesting();
  });

  afterEach(() => {
    SoundManager.resetForTesting();
    vi.restoreAllMocks();
  });

  it("throws UnknownSoundIdError when no catalog is registered", () => {
    SoundManager.Initialize();

    expect(() => SoundManager.PlaySE({ id: "hit" })).toThrow(UnknownSoundIdError);
  });

  it("throws for unknown or unloaded catalog sound IDs", async () => {
    SoundManager.Initialize();
    SoundManager.registerCatalogForTesting(SPEC_CATALOG, CATALOG_URL);

    expect(() => SoundManager.PlaySE({ id: "missing" })).toThrow(
      UnknownSoundIdError,
    );
    expect(() =>
      SoundManager.PlayBGM(new BgmPlayAttributes({ id: "forest-bgm" })),
    ).toThrow(SoundNotLoadedError);

    await SoundManager.PreloadGroup("forest");
    expect(() =>
      SoundManager.PlayBGM(new BgmPlayAttributes({ id: "forest-bgm" })),
    ).not.toThrow();
  });

  it("does not allocate channels when playback is rejected", async () => {
    SoundManager.Initialize();
    const soundIds = Array.from({ length: 16 }, (_, index) => `se-${index}`);
    await registerAndPreloadSounds(soundIds);

    const handles = soundIds.map((id) => SoundManager.PlaySE({ id }));

    expect(() => SoundManager.PlaySE({ id: "missing" })).toThrow(
      UnknownSoundIdError,
    );
    expect(handles.every((handle) => handle.state === PlaybackState.PLAYING)).toBe(
      true,
    );
  });
});
