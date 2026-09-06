import { Howl, Howler } from "howler";

import {
  type AudioBackend,
  type AudioBackendEndedListener,
  type AudioBackendErrorListener,
  type AudioBackendFadeCompleteListener,
  type AudioBackendInstance,
  type AudioBackendPlayOptions,
} from "./audio-backend.js";

/** Large enough for concurrent instances; not used as channel-pool sizing. */
const HOWL_POOL_SIZE = 64;

type HowlConstructor = typeof Howl;

interface LoadedHowl {
  howl: Howl;
  loadPromise: Promise<void>;
}

interface TrackedInstance {
  soundId: string;
  howl: Howl;
  loop: number;
  remainingRepeats: number;
  state: AudioBackendInstance["state"];
  mixerVolume: number;
  gain: number;
  endListener: () => void;
  playErrorListener: (_soundId: unknown, error: unknown) => void;
  fadeTimer: ReturnType<typeof setInterval> | undefined;
}

/** Howler.js-backed audio backend for production use. */
export class HowlerBackend implements AudioBackend {
  private readonly HowlClass: HowlConstructor;
  private readonly howls = new Map<string, LoadedHowl>();
  private readonly instances = new Map<number, TrackedInstance>();
  private readonly endedListeners: AudioBackendEndedListener[] = [];
  private readonly errorListeners: AudioBackendErrorListener[] = [];
  private readonly fadeCompleteListeners: AudioBackendFadeCompleteListener[] =
    [];

  constructor(HowlClass: HowlConstructor = Howl) {
    this.HowlClass = HowlClass;
  }

  onEnded(listener: AudioBackendEndedListener): void {
    this.endedListeners.push(listener);
  }

  onError(listener: AudioBackendErrorListener): void {
    this.errorListeners.push(listener);
  }

  onFadeComplete(listener: AudioBackendFadeCompleteListener): void {
    this.fadeCompleteListeners.push(listener);
  }

  async load(soundId: string, urls: readonly string[]): Promise<void> {
    const existing = this.howls.get(soundId);
    if (existing) {
      return existing.loadPromise;
    }

    let resolveLoad!: () => void;
    let rejectLoad!: (error: unknown) => void;
    const loadPromise = new Promise<void>((resolve, reject) => {
      resolveLoad = resolve;
      rejectLoad = reject;
    });

    const howl = new this.HowlClass({
      src: [...urls],
      preload: true,
      pool: HOWL_POOL_SIZE,
      onload: () => {
        resolveLoad();
      },
      onloaderror: (_soundId, error) => {
        if (this.howls.get(soundId)?.howl === howl) {
          this.howls.delete(soundId);
        }
        howl.unload();
        rejectLoad(error);
      },
    });

    this.howls.set(soundId, { howl, loadPromise });
    return loadPromise;
  }

  play(options: AudioBackendPlayOptions): AudioBackendInstance {
    const loaded = this.howls.get(options.soundId);
    if (!loaded) {
      throw new Error(`Sound is not loaded: ${options.soundId}`);
    }

    const howl = loaded.howl;
    const loop = options.loop ?? 0;
    const backendInstanceId = howl.play();

    howl.stereo(options.pan, backendInstanceId);

    if (options.initialAudioPosition > 0) {
      howl.seek(options.initialAudioPosition, backendInstanceId);
    }

    if (loop === -1) {
      howl.loop(true, backendInstanceId);
    } else {
      howl.loop(false, backendInstanceId);
    }

    const tracked: TrackedInstance = {
      soundId: options.soundId,
      howl,
      loop,
      remainingRepeats: loop > 0 ? loop : 0,
      state: "playing",
      mixerVolume: options.volume,
      gain: options.gain ?? 1,
      endListener: () => {
        this.handleEnd(backendInstanceId);
      },
      playErrorListener: (_soundId, error) => {
        this.handleError(backendInstanceId, error);
      },
      fadeTimer: undefined,
    };
    this.instances.set(backendInstanceId, tracked);
    this.applyOutput(tracked, backendInstanceId);

    howl.on("end", tracked.endListener, backendInstanceId);
    howl.on("playerror", tracked.playErrorListener, backendInstanceId);

    return {
      backendInstanceId,
      soundId: options.soundId,
      state: "playing",
    };
  }

  stop(instanceId: number): void {
    const tracked = this.instances.get(instanceId);
    if (!tracked) {
      return;
    }

    this.detachInstance(instanceId, tracked);
    tracked.howl.stop(instanceId);
    tracked.state = "stopped";
    this.instances.delete(instanceId);
  }

  pause(instanceId: number): void {
    const tracked = this.instances.get(instanceId);
    if (!tracked) {
      return;
    }

    tracked.howl.pause(instanceId);
    tracked.state = "paused";
  }

  resume(instanceId: number): void {
    const tracked = this.instances.get(instanceId);
    if (!tracked) {
      return;
    }

    tracked.howl.play(instanceId);
    tracked.state = "playing";
  }

  seek(instanceId: number, position: number): void {
    const tracked = this.instances.get(instanceId);
    if (!tracked) {
      return;
    }

    tracked.howl.seek(position, instanceId);
  }

  fade(instanceId: number, toGain: number, duration: number): void {
    const tracked = this.instances.get(instanceId);
    if (!tracked) {
      return;
    }

    this.clearFadeTimer(tracked);
    const fromGain = tracked.gain;
    if (duration <= 0) {
      tracked.gain = toGain;
      this.applyOutput(tracked, instanceId);
      this.emitFadeComplete(instanceId);
      return;
    }

    const startMs = Date.now();
    const durationMs = duration * 1000;
    tracked.fadeTimer = setInterval(() => {
      const current = this.instances.get(instanceId);
      if (!current || current !== tracked) {
        this.clearFadeTimer(tracked);
        return;
      }

      const progress = Math.min(1, (Date.now() - startMs) / durationMs);
      current.gain = fromGain + (toGain - fromGain) * progress;
      this.applyOutput(current, instanceId);
      if (progress >= 1) {
        this.clearFadeTimer(current);
        this.emitFadeComplete(instanceId);
      }
    }, 16);
  }

  setVolume(instanceId: number, volume: number): void {
    const tracked = this.instances.get(instanceId);
    if (!tracked) {
      return;
    }

    tracked.mixerVolume = volume;
    this.applyOutput(tracked, instanceId);
  }

  async unlockAudio(): Promise<void> {
    const ctx = Howler.ctx;
    if (!ctx) {
      return;
    }

    if (ctx.state === "suspended" || ctx.state === "interrupted") {
      await ctx.resume();
    }
  }

  unload(soundId: string): void {
    const loaded = this.howls.get(soundId);
    if (!loaded) {
      return;
    }

    loaded.howl.unload();
    this.howls.delete(soundId);
  }

  private handleEnd(backendInstanceId: number): void {
    const tracked = this.instances.get(backendInstanceId);
    if (!tracked || tracked.state === "stopped") {
      return;
    }

    if (tracked.loop === -1) {
      return;
    }

    if (tracked.remainingRepeats > 0) {
      tracked.remainingRepeats -= 1;
      tracked.howl.seek(0, backendInstanceId);
      tracked.howl.play(backendInstanceId);
      return;
    }

    this.detachInstance(backendInstanceId, tracked);
    this.instances.delete(backendInstanceId);
    this.emitEnded(backendInstanceId);
  }

  private handleError(backendInstanceId: number, error?: unknown): void {
    const tracked = this.instances.get(backendInstanceId);
    if (!tracked) {
      return;
    }

    this.detachInstance(backendInstanceId, tracked);
    this.instances.delete(backendInstanceId);
    this.emitError(backendInstanceId, error);
  }

  private applyOutput(tracked: TrackedInstance, instanceId: number): void {
    tracked.howl.volume(tracked.mixerVolume * tracked.gain, instanceId);
  }

  private clearFadeTimer(tracked: TrackedInstance): void {
    if (tracked.fadeTimer !== undefined) {
      clearInterval(tracked.fadeTimer);
      tracked.fadeTimer = undefined;
    }
  }

  private detachInstance(instanceId: number, tracked: TrackedInstance): void {
    this.clearFadeTimer(tracked);
    tracked.howl.off("end", tracked.endListener, instanceId);
    tracked.howl.off("playerror", tracked.playErrorListener, instanceId);
  }

  private emitEnded(backendInstanceId: number): void {
    for (const listener of this.endedListeners) {
      listener(backendInstanceId);
    }
  }

  private emitError(backendInstanceId: number, error?: unknown): void {
    for (const listener of this.errorListeners) {
      listener(backendInstanceId, error);
    }
  }

  private emitFadeComplete(backendInstanceId: number): void {
    for (const listener of this.fadeCompleteListeners) {
      listener(backendInstanceId);
    }
  }
}
