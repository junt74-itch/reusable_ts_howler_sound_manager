/** Options for starting playback on the audio backend. */
export interface AudioBackendPlayOptions {
  soundId: string;
  volume: number;
  /** Envelope 0–1 multiplied with `volume`. Defaults to 1. */
  gain?: number;
  pan: number;
  loop?: number;
  initialAudioPosition: number;
  fadeSeconds?: number;
}

/** Internal backend playback instance (not the public PlaybackHandle). */
export interface AudioBackendInstance {
  backendInstanceId: number;
  soundId: string;
  state: "loading" | "playing" | "paused" | "stopped";
}

export type AudioBackendOperation =
  | { type: "load"; soundId: string; urls: readonly string[] }
  | { type: "play"; instanceId: number; options: AudioBackendPlayOptions }
  | { type: "stop"; instanceId: number }
  | { type: "pause"; instanceId: number }
  | { type: "resume"; instanceId: number }
  | { type: "seek"; instanceId: number; position: number }
  | { type: "setVolume"; instanceId: number; volume: number }
  | {
      type: "fade";
      instanceId: number;
      toVolume: number;
      duration: number;
    }
  | { type: "unload"; soundId: string }
  | { type: "unlockAudio" };

export type AudioBackendEndedListener = (backendInstanceId: number) => void;
export type AudioBackendErrorListener = (
  backendInstanceId: number,
  error?: unknown,
) => void;
export type AudioBackendFadeCompleteListener = (
  backendInstanceId: number,
) => void;

/**
 * Abstraction over Howler.js. P1 uses FakeAudioBackend for tests.
 */
export interface AudioBackend {
  load(soundId: string, urls: readonly string[]): Promise<void>;
  play(options: AudioBackendPlayOptions): AudioBackendInstance;
  stop(instanceId: number): void;
  pause(instanceId: number): void;
  resume(instanceId: number): void;
  seek(instanceId: number, position: number): void;
  /** Tweens the playback envelope (`0`–`1`). Mixer volume is applied separately. */
  fade(instanceId: number, toGain: number, duration: number): void;
  setVolume(instanceId: number, volume: number): void;
  unload(soundId: string): void;
  unlockAudio(): Promise<void>;
  onEnded(listener: AudioBackendEndedListener): void;
  onError(listener: AudioBackendErrorListener): void;
  onFadeComplete(listener: AudioBackendFadeCompleteListener): void;
}

export type FakeLoadResult = "success" | "failure";

/** Controllable in-memory backend for unit tests. */
export class FakeAudioBackend implements AudioBackend {
  readonly operations: AudioBackendOperation[] = [];
  private nextInstanceId = 1;
  private readonly instances = new Map<number, AudioBackendInstance>();
  private readonly instanceLoops = new Map<number, number>();
  private readonly instanceMixerVolumes = new Map<number, number>();
  private readonly instanceGains = new Map<number, number>();
  private readonly instanceFadeTargets = new Map<number, number>();
  private readonly loadResults = new Map<string, FakeLoadResult>();
  private readonly loadedSoundIds = new Set<string>();
  private readonly pendingLoads = new Map<string, Promise<void>>();
  private readonly endedListeners: AudioBackendEndedListener[] = [];
  private readonly errorListeners: AudioBackendErrorListener[] = [];
  private readonly fadeCompleteListeners: AudioBackendFadeCompleteListener[] =
    [];

  async load(soundId: string, urls: readonly string[]): Promise<void> {
    const existing = this.pendingLoads.get(soundId);
    if (existing) {
      return existing;
    }

    const promise = this.runLoad(soundId, urls);
    this.pendingLoads.set(soundId, promise);
    try {
      await promise;
    } finally {
      if (this.pendingLoads.get(soundId) === promise) {
        this.pendingLoads.delete(soundId);
      }
    }
  }

  setLoadResult(soundId: string, result: FakeLoadResult): void {
    this.loadResults.set(soundId, result);
  }

  isSoundLoaded(soundId: string): boolean {
    return this.loadedSoundIds.has(soundId);
  }

  play(options: AudioBackendPlayOptions): AudioBackendInstance {
    if (!this.loadedSoundIds.has(options.soundId)) {
      throw new Error(`Sound is not loaded: ${options.soundId}`);
    }

    const backendInstanceId = this.nextInstanceId++;
    const loop = options.loop ?? 0;
    const instance: AudioBackendInstance = {
      backendInstanceId,
      soundId: options.soundId,
      state: "playing",
    };
    this.instances.set(backendInstanceId, instance);
    this.instanceLoops.set(backendInstanceId, loop);
    this.instanceMixerVolumes.set(backendInstanceId, options.volume);
    this.instanceGains.set(backendInstanceId, options.gain ?? 1);
    this.operations.push({ type: "play", instanceId: backendInstanceId, options });
    return instance;
  }

  stop(instanceId: number): void {
    this.instanceLoops.delete(instanceId);
    this.instanceMixerVolumes.delete(instanceId);
    this.instanceGains.delete(instanceId);
    this.instanceFadeTargets.delete(instanceId);
    this.updateState(instanceId, "stopped");
    this.operations.push({ type: "stop", instanceId });
  }

  pause(instanceId: number): void {
    this.updateState(instanceId, "paused");
    this.operations.push({ type: "pause", instanceId });
  }

  resume(instanceId: number): void {
    this.updateState(instanceId, "playing");
    this.operations.push({ type: "resume", instanceId });
  }

  seek(instanceId: number, position: number): void {
    this.operations.push({ type: "seek", instanceId, position });
  }

  fade(instanceId: number, toGain: number, duration: number): void {
    this.instanceFadeTargets.set(instanceId, toGain);
    this.operations.push({
      type: "fade",
      instanceId,
      toVolume: toGain,
      duration,
    });
  }

  setVolume(instanceId: number, volume: number): void {
    this.instanceMixerVolumes.set(instanceId, volume);
    this.operations.push({
      type: "setVolume",
      instanceId,
      volume: volume * (this.instanceGains.get(instanceId) ?? 1),
    });
  }

  async unlockAudio(): Promise<void> {
    this.operations.push({ type: "unlockAudio" });
  }

  unload(soundId: string): void {
    this.loadedSoundIds.delete(soundId);
    this.operations.push({ type: "unload", soundId });
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

  /** Simulates natural playback completion for tests. */
  emitEnd(instanceId: number): void {
    const loop = this.instanceLoops.get(instanceId) ?? 0;
    if (loop === -1) {
      return;
    }

    this.instanceLoops.delete(instanceId);
    for (const listener of this.endedListeners) {
      listener(instanceId);
    }
  }

  /** Simulates playback failure for tests. */
  emitError(instanceId: number, error?: unknown): void {
    for (const listener of this.errorListeners) {
      listener(instanceId, error);
    }
  }

  /** Simulates fade completion for tests. */
  emitFadeComplete(instanceId: number): void {
    const targetGain = this.instanceFadeTargets.get(instanceId);
    if (targetGain !== undefined) {
      this.instanceGains.set(instanceId, targetGain);
      this.instanceFadeTargets.delete(instanceId);
    }
    for (const listener of this.fadeCompleteListeners) {
      listener(instanceId);
    }
  }

  getInstance(instanceId: number): AudioBackendInstance | undefined {
    return this.instances.get(instanceId);
  }

  resetForTesting(): void {
    this.operations.length = 0;
    this.instances.clear();
    this.instanceLoops.clear();
    this.instanceMixerVolumes.clear();
    this.instanceGains.clear();
    this.instanceFadeTargets.clear();
    this.nextInstanceId = 1;
    this.loadResults.clear();
    this.loadedSoundIds.clear();
    this.pendingLoads.clear();
    this.endedListeners.length = 0;
    this.errorListeners.length = 0;
    this.fadeCompleteListeners.length = 0;
  }

  private async runLoad(
    soundId: string,
    urls: readonly string[],
  ): Promise<void> {
    this.operations.push({ type: "load", soundId, urls });
    const result = this.loadResults.get(soundId) ?? "success";
    if (result === "failure") {
      throw new Error(`FakeAudioBackend failed to load: ${soundId}`);
    }
    this.loadedSoundIds.add(soundId);
  }

  private updateState(
    instanceId: number,
    state: AudioBackendInstance["state"],
  ): void {
    const instance = this.instances.get(instanceId);
    if (instance) {
      instance.state = state;
    }
  }
}
