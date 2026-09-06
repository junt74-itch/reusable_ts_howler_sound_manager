import { describe, expect, it, vi } from "vitest";

import { HowlerBackend } from "../src/howler-backend.js";

type MockHowlListener = (...args: unknown[]) => void;

interface MockHowlInstance {
  id: number;
  volume: number;
  pan: number;
  seek: number;
  loop: boolean;
  state: "playing" | "stopped";
}

function createMockHowl(config?: { loadOutcome?: "success" | "manual" }) {
  const instances = new Map<number, MockHowlInstance>();
  const listeners = new Map<string, Map<number | "global", MockHowlListener[]>>();
  let nextId = 1;

  const getListenerBucket = (
    event: string,
    id: number | "global",
  ): MockHowlListener[] => {
    const eventListeners = listeners.get(event) ?? new Map();
    listeners.set(event, eventListeners);
    const bucket = eventListeners.get(id) ?? [];
    eventListeners.set(id, bucket);
    return bucket;
  };

  const Howl = vi.fn((options: {
    src: string[];
    preload: boolean;
    pool: number;
    onload?: () => void;
    onloaderror?: (soundId: number, error: unknown) => void;
  }) => {
    const howl = {
      play: vi.fn((reuseId?: number) => {
        const id = typeof reuseId === "number" ? reuseId : nextId++;
        instances.set(id, {
          id,
          volume: 1,
          pan: 0,
          seek: 0,
          loop: false,
          state: "playing",
        });
        for (const listener of getListenerBucket("play", id)) {
          listener(id);
        }
        return id;
      }),
      stop: vi.fn((id: number) => {
        const instance = instances.get(id);
        if (instance) {
          instance.state = "stopped";
        }
      }),
      pause: vi.fn(),
      volume: vi.fn((value?: number, id?: number) => {
        if (typeof value === "number" && typeof id === "number") {
          instances.get(id)!.volume = value;
          return howl;
        }
        if (typeof id === "number") {
          return instances.get(id)?.volume ?? 1;
        }
        return 1;
      }),
      stereo: vi.fn((pan: number, id: number) => {
        instances.get(id)!.pan = pan;
        return howl;
      }),
      seek: vi.fn((position?: number, id?: number) => {
        if (typeof position === "number" && typeof id === "number") {
          instances.get(id)!.seek = position;
          return howl;
        }
        if (typeof id === "number") {
          return instances.get(id)?.seek ?? 0;
        }
        return 0;
      }),
      loop: vi.fn((value?: boolean, id?: number) => {
        if (typeof value === "boolean" && typeof id === "number") {
          instances.get(id)!.loop = value;
          return howl;
        }
        if (typeof id === "number") {
          return instances.get(id)?.loop ?? false;
        }
        return false;
      }),
      fade: vi.fn((from: number, to: number, duration: number, id: number) => {
        if (duration === 0) {
          queueMicrotask(() => {
            for (const listener of getListenerBucket("fade", id)) {
              listener(id);
            }
          });
        }
      }),
      on: vi.fn((event: string, callback: MockHowlListener, id?: number) => {
        const bucket = getListenerBucket(event, id ?? "global");
        bucket.push(callback);
        return howl;
      }),
      off: vi.fn((event: string, callback: MockHowlListener, id?: number) => {
        const eventListeners = listeners.get(event);
        if (!eventListeners) {
          return howl;
        }
        const bucket = eventListeners.get(id ?? "global");
        if (!bucket) {
          return howl;
        }
        const index = bucket.indexOf(callback);
        if (index !== -1) {
          bucket.splice(index, 1);
        }
        return howl;
      }),
      unload: vi.fn(),
      emitEnd: (id: number) => {
        for (const listener of getListenerBucket("end", id)) {
          listener(id);
        }
      },
      emitPlayError: (id: number, error: unknown) => {
        for (const listener of getListenerBucket("playerror", id)) {
          listener(id, error);
        }
      },
      emitFade: (id: number) => {
        for (const listener of getListenerBucket("fade", id)) {
          listener(id);
        }
      },
      emitLoadError: (error?: unknown) => {
        options.onloaderror?.(0, error ?? new Error("load failed"));
      },
      emitLoad: () => {
        options.onload?.();
      },
      getInstance: (id: number) => instances.get(id),
      options,
    };

    if (config?.loadOutcome !== "manual") {
      queueMicrotask(() => {
        options.onload?.();
      });
    }

    return howl;
  });

  return { Howl, instances, listeners };
}

describe("HowlerBackend", () => {
  it("loads sounds and resolves when Howl fires onload", async () => {
    const { Howl } = createMockHowl();
    const backend = new HowlerBackend(Howl as never);

    await backend.load("hit", ["audio/hit.ogg"]);

    expect(Howl).toHaveBeenCalledWith(
      expect.objectContaining({
        src: ["audio/hit.ogg"],
        preload: true,
        pool: 64,
      }),
    );
  });

  it("unloads and allows retry after onloaderror", async () => {
    let attempt = 0;
    const Howl = vi.fn((options: {
      src: string[];
      preload: boolean;
      pool: number;
      onload?: () => void;
      onloaderror?: (soundId: number, error: unknown) => void;
    }) => {
      attempt += 1;
      const howl = { unload: vi.fn() };
      queueMicrotask(() => {
        if (attempt === 1) {
          options.onloaderror?.(0, new Error("decode failed"));
        } else {
          options.onload?.();
        }
      });
      return howl;
    });

    const backend = new HowlerBackend(Howl as never);

    await expect(backend.load("hit", ["audio/hit.ogg"])).rejects.toEqual(
      expect.any(Error),
    );
    expect(Howl.mock.results[0]!.value.unload).toHaveBeenCalled();

    await backend.load("hit", ["audio/hit.ogg"]);

    expect(Howl).toHaveBeenCalledTimes(2);
    expect(Howl.mock.calls[1]?.[0]).toMatchObject({
      src: ["audio/hit.ogg"],
    });
  });

  it("plays with volume, pan, seek, and loop settings", async () => {
    const { Howl } = createMockHowl();
    const backend = new HowlerBackend(Howl as never);
    await backend.load("bgm", ["audio/bgm.ogg"]);

    const instance = backend.play({
      soundId: "bgm",
      volume: 0.5,
      pan: -0.25,
      loop: -1,
      initialAudioPosition: 2,
    });

    const howl = Howl.mock.results[0]!.value as ReturnType<typeof createMockHowl>["instances"] extends never ? never : {
      volume: ReturnType<typeof vi.fn>;
      stereo: ReturnType<typeof vi.fn>;
      seek: ReturnType<typeof vi.fn>;
      loop: ReturnType<typeof vi.fn>;
      getInstance: (id: number) => MockHowlInstance | undefined;
    };

    expect(instance.backendInstanceId).toBe(1);
    expect(howl.volume).toHaveBeenCalledWith(0.5, 1);
    expect(howl.stereo).toHaveBeenCalledWith(-0.25, 1);
    expect(howl.seek).toHaveBeenCalledWith(2, 1);
    expect(howl.loop).toHaveBeenCalledWith(true, 1);
    expect(howl.getInstance(1)?.loop).toBe(true);
  });

  it("emits ended after a single play when loop is 0", async () => {
    const { Howl } = createMockHowl();
    const backend = new HowlerBackend(Howl as never);
    await backend.load("se", ["audio/se.ogg"]);

    const ended = vi.fn();
    backend.onEnded(ended);

    const instance = backend.play({
      soundId: "se",
      volume: 1,
      pan: 0,
      loop: 0,
      initialAudioPosition: 0,
    });
    const howl = Howl.mock.results[0]!.value as { emitEnd: (id: number) => void };

    howl.emitEnd(instance.backendInstanceId);

    expect(ended).toHaveBeenCalledWith(instance.backendInstanceId);
  });

  it("does not emit ended for infinite loop playback", async () => {
    const { Howl } = createMockHowl();
    const backend = new HowlerBackend(Howl as never);
    await backend.load("bgm", ["audio/bgm.ogg"]);

    const ended = vi.fn();
    backend.onEnded(ended);

    const instance = backend.play({
      soundId: "bgm",
      volume: 1,
      pan: 0,
      loop: -1,
      initialAudioPosition: 0,
    });
    const howl = Howl.mock.results[0]!.value as { emitEnd: (id: number) => void };

    howl.emitEnd(instance.backendInstanceId);

    expect(ended).not.toHaveBeenCalled();
  });

  it("replays for positive loop counts before ending", async () => {
    const { Howl } = createMockHowl();
    const backend = new HowlerBackend(Howl as never);
    await backend.load("me", ["audio/me.ogg"]);

    const ended = vi.fn();
    backend.onEnded(ended);

    const instance = backend.play({
      soundId: "me",
      volume: 1,
      pan: 0,
      loop: 1,
      initialAudioPosition: 0,
    });
    const howl = Howl.mock.results[0]!.value as {
      emitEnd: (id: number) => void;
      play: ReturnType<typeof vi.fn>;
      seek: ReturnType<typeof vi.fn>;
    };

    howl.emitEnd(instance.backendInstanceId);
    expect(ended).not.toHaveBeenCalled();
    expect(howl.seek).toHaveBeenCalledWith(0, instance.backendInstanceId);
    expect(howl.play).toHaveBeenCalledWith(instance.backendInstanceId);

    howl.emitEnd(instance.backendInstanceId);
    expect(ended).toHaveBeenCalledWith(instance.backendInstanceId);
  });

  it("stops playback and ignores subsequent end events", async () => {
    const { Howl } = createMockHowl();
    const backend = new HowlerBackend(Howl as never);
    await backend.load("se", ["audio/se.ogg"]);

    const ended = vi.fn();
    backend.onEnded(ended);

    const instance = backend.play({
      soundId: "se",
      volume: 1,
      pan: 0,
      loop: 0,
      initialAudioPosition: 0,
    });
    const howl = Howl.mock.results[0]!.value as {
      emitEnd: (id: number) => void;
      stop: ReturnType<typeof vi.fn>;
    };

    backend.stop(instance.backendInstanceId);
    howl.emitEnd(instance.backendInstanceId);

    expect(howl.stop).toHaveBeenCalledWith(instance.backendInstanceId);
    expect(ended).not.toHaveBeenCalled();
  });

  it("emits fade complete when the envelope tween finishes", async () => {
    vi.useFakeTimers();
    const { Howl } = createMockHowl();
    const backend = new HowlerBackend(Howl as never);
    await backend.load("bgm", ["audio/bgm.ogg"]);

    const onFadeComplete = vi.fn();
    backend.onFadeComplete(onFadeComplete);

    const instance = backend.play({
      soundId: "bgm",
      volume: 1,
      pan: 0,
      loop: -1,
      initialAudioPosition: 0,
    });

    backend.fade(instance.backendInstanceId, 0, 2);
    expect(onFadeComplete).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(2000);
    expect(onFadeComplete).toHaveBeenCalledWith(instance.backendInstanceId);
    vi.useRealTimers();
  });

  it("applies mixer volume without completing an in-progress fade", async () => {
    vi.useFakeTimers();
    const { Howl } = createMockHowl();
    const backend = new HowlerBackend(Howl as never);
    await backend.load("bgm", ["audio/bgm.ogg"]);

    const onFadeComplete = vi.fn();
    backend.onFadeComplete(onFadeComplete);

    const instance = backend.play({
      soundId: "bgm",
      volume: 1,
      pan: 0,
      loop: -1,
      initialAudioPosition: 0,
      gain: 0,
    });
    const howl = Howl.mock.results[0]!.value as {
      volume: ReturnType<typeof vi.fn>;
    };

    backend.fade(instance.backendInstanceId, 1, 2);
    backend.setVolume(instance.backendInstanceId, 0.5);

    expect(onFadeComplete).not.toHaveBeenCalled();
    expect(howl.volume).toHaveBeenCalledWith(0, instance.backendInstanceId);

    await vi.advanceTimersByTimeAsync(2000);
    expect(onFadeComplete).toHaveBeenCalledTimes(1);
    expect(howl.volume).toHaveBeenCalledWith(0.5, instance.backendInstanceId);
    vi.useRealTimers();
  });

  it("removes Howl listeners on stop, end, and playerror", async () => {
    const { Howl, listeners } = createMockHowl();
    const backend = new HowlerBackend(Howl as never);
    await backend.load("se", ["audio/se.ogg"]);
    const howl = Howl.mock.results[0]!.value as {
      emitEnd: (id: number) => void;
      emitPlayError: (id: number, error: unknown) => void;
    };

    const count = (event: string, id: number) =>
      listeners.get(event)?.get(id)?.length ?? 0;

    const stopped = backend.play({
      soundId: "se",
      volume: 1,
      pan: 0,
      loop: 0,
      initialAudioPosition: 0,
    });
    expect(count("end", stopped.backendInstanceId)).toBe(1);
    expect(count("playerror", stopped.backendInstanceId)).toBe(1);
    backend.stop(stopped.backendInstanceId);
    expect(count("end", stopped.backendInstanceId)).toBe(0);
    expect(count("playerror", stopped.backendInstanceId)).toBe(0);

    const ended = backend.play({
      soundId: "se",
      volume: 1,
      pan: 0,
      loop: 0,
      initialAudioPosition: 0,
    });
    howl.emitEnd(ended.backendInstanceId);
    expect(count("end", ended.backendInstanceId)).toBe(0);
    expect(count("playerror", ended.backendInstanceId)).toBe(0);

    const failed = backend.play({
      soundId: "se",
      volume: 1,
      pan: 0,
      loop: 0,
      initialAudioPosition: 0,
    });
    howl.emitPlayError(failed.backendInstanceId, new Error("decode failed"));
    expect(count("end", failed.backendInstanceId)).toBe(0);
    expect(count("playerror", failed.backendInstanceId)).toBe(0);
  });

  it("emits error on playerror", async () => {
    const { Howl } = createMockHowl();
    const backend = new HowlerBackend(Howl as never);
    await backend.load("se", ["audio/se.ogg"]);

    const onError = vi.fn();
    backend.onError(onError);

    const instance = backend.play({
      soundId: "se",
      volume: 1,
      pan: 0,
      loop: 0,
      initialAudioPosition: 0,
    });
    const howl = Howl.mock.results[0]!.value as {
      emitPlayError: (id: number, error: unknown) => void;
    };

    howl.emitPlayError(instance.backendInstanceId, new Error("decode failed"));

    expect(onError).toHaveBeenCalledWith(
      instance.backendInstanceId,
      expect.any(Error),
    );
  });
});
