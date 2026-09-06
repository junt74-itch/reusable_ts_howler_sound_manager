import type { AudioBackend } from "./audio-backend.js";
import type { Catalog } from "./catalog.js";
import { InvalidArgumentError, PreloadFailureError } from "./errors.js";

type LoadState = "unloaded" | "loading" | "loaded";

/**
 * Tracks loaded sound assets, group references, and coordinates backend load/unload.
 */
export class ResourceStore {
  /** Groups that completed a successful PreloadGroup. */
  private readonly loadedGroups = new Set<string>();
  /** soundId -> group names that hold a reference via preload (including in-flight). */
  private readonly groupRefs = new Map<string, Set<string>>();
  private readonly loadStates = new Map<string, LoadState>();
  private readonly loadPromises = new Map<string, Promise<void>>();
  private readonly groupPreloadPromises = new Map<string, Promise<void>>();
  /** Bumped when a group preload starts or is cancelled by UnloadGroup. */
  private readonly groupRequestIds = new Map<string, number>();
  /** Temporary pins so replacement playback cannot unload its own sound. */
  private readonly retainCounts = new Map<string, number>();

  constructor(
    private readonly catalog: Catalog,
    private readonly backend: AudioBackend,
    private readonly isSoundInUse: (soundId: string) => boolean,
  ) {}

  isLoaded(soundId: string): boolean {
    return this.loadStates.get(soundId) === "loaded";
  }

  isGroupLoaded(groupName: string): boolean {
    return this.loadedGroups.has(groupName);
  }

  getGroupRefCount(soundId: string): number {
    return this.groupRefs.get(soundId)?.size ?? 0;
  }

  /** Prevents unload while a playback replacement is in progress. */
  retain(soundId: string): void {
    this.retainCounts.set(soundId, (this.retainCounts.get(soundId) ?? 0) + 1);
  }

  releaseRetain(soundId: string): void {
    const next = (this.retainCounts.get(soundId) ?? 0) - 1;
    if (next <= 0) {
      this.retainCounts.delete(soundId);
    } else {
      this.retainCounts.set(soundId, next);
    }
    this.tryUnloadSound(soundId);
  }

  preloadGroup(groupName: string): Promise<void> {
    const soundIds = this.catalog.getGroupSoundIds(groupName);
    if (!soundIds) {
      return Promise.reject(new InvalidArgumentError(`Unknown group: ${groupName}`));
    }

    if (this.loadedGroups.has(groupName)) {
      return Promise.resolve();
    }

    const inFlight = this.groupPreloadPromises.get(groupName);
    if (inFlight) {
      return inFlight;
    }

    const requestId = (this.groupRequestIds.get(groupName) ?? 0) + 1;
    this.groupRequestIds.set(groupName, requestId);
    for (const soundId of soundIds) {
      this.addGroupRef(soundId, groupName);
    }

    const promise = this.runGroupPreload(groupName, soundIds, requestId).finally(
      () => {
        if (this.groupPreloadPromises.get(groupName) === promise) {
          this.groupPreloadPromises.delete(groupName);
        }
      },
    );
    this.groupPreloadPromises.set(groupName, promise);
    return promise;
  }

  async unloadGroup(groupName: string): Promise<void> {
    const soundIds = this.catalog.getGroupSoundIds(groupName);
    if (!soundIds) {
      return;
    }

    this.loadedGroups.delete(groupName);
    this.groupPreloadPromises.delete(groupName);
    this.groupRequestIds.set(
      groupName,
      (this.groupRequestIds.get(groupName) ?? 0) + 1,
    );

    for (const soundId of soundIds) {
      this.removeGroupRef(soundId, groupName);
      this.tryUnloadSound(soundId);
    }
  }

  clear(): void {
    this.loadedGroups.clear();
    this.groupRefs.clear();
    this.loadStates.clear();
    this.loadPromises.clear();
    this.groupPreloadPromises.clear();
    this.groupRequestIds.clear();
    this.retainCounts.clear();
  }

  /** Called when an active playback no longer references a sound. */
  notifyPlaybackReleased(soundId: string): void {
    this.tryUnloadSound(soundId);
  }

  private isCurrentRequest(groupName: string, requestId: number): boolean {
    return this.groupRequestIds.get(groupName) === requestId;
  }

  private async runGroupPreload(
    groupName: string,
    soundIds: readonly string[],
    requestId: number,
  ): Promise<void> {
    const results = await Promise.allSettled(
      soundIds.map((soundId) => this.ensureLoaded(soundId)),
    );

    if (!this.isCurrentRequest(groupName, requestId)) {
      throw new PreloadFailureError(
        [...soundIds],
        `Preload cancelled for group: ${groupName}`,
      );
    }

    const failedIds: string[] = [];
    for (let index = 0; index < results.length; index += 1) {
      const result = results[index]!;
      const soundId = soundIds[index]!;
      if (result.status === "rejected") {
        failedIds.push(soundId);
      }
    }

    if (failedIds.length > 0) {
      for (const soundId of soundIds) {
        this.removeGroupRef(soundId, groupName);
      }
      throw new PreloadFailureError(failedIds);
    }

    this.loadedGroups.add(groupName);
  }

  private async ensureLoaded(soundId: string): Promise<void> {
    const resource = this.catalog.getResource(soundId);
    if (!resource) {
      throw new InvalidArgumentError(`Unknown sound ID: ${soundId}`);
    }

    const state = this.loadStates.get(soundId);
    if (state === "loaded") {
      return;
    }

    const existing = this.loadPromises.get(soundId);
    if (existing) {
      return existing;
    }

    this.loadStates.set(soundId, "loading");
    const promise = this.backend
      .load(soundId, resource.urls)
      .then(() => {
        this.loadPromises.delete(soundId);
        if (!this.isSoundHeld(soundId)) {
          this.loadStates.set(soundId, "unloaded");
          this.backend.unload(soundId);
          throw new Error(`Load discarded for sound ID: ${soundId}`);
        }
        this.loadStates.set(soundId, "loaded");
      })
      .catch((error) => {
        this.loadStates.set(soundId, "unloaded");
        this.loadPromises.delete(soundId);
        throw error;
      });

    this.loadPromises.set(soundId, promise);
    return promise;
  }

  private addGroupRef(soundId: string, groupName: string): void {
    let refs = this.groupRefs.get(soundId);
    if (!refs) {
      refs = new Set<string>();
      this.groupRefs.set(soundId, refs);
    }
    refs.add(groupName);
  }

  private removeGroupRef(soundId: string, groupName: string): void {
    const refs = this.groupRefs.get(soundId);
    if (!refs) {
      return;
    }
    refs.delete(groupName);
    if (refs.size === 0) {
      this.groupRefs.delete(soundId);
    }
  }

  private isSoundHeld(soundId: string): boolean {
    return (
      this.groupRefs.has(soundId) ||
      this.isSoundInUse(soundId) ||
      (this.retainCounts.get(soundId) ?? 0) > 0
    );
  }

  private tryUnloadSound(soundId: string): void {
    if (this.isSoundHeld(soundId)) {
      return;
    }

    const state = this.loadStates.get(soundId);
    if (state === "loading") {
      return;
    }

    if (state === "loaded") {
      this.loadStates.set(soundId, "unloaded");
      this.backend.unload(soundId);
    }
  }
}
