import { PlaybackHandle } from "./playback-handle.js";
import { SoundCategory } from "./types.js";

export interface PlaybackEntry {
  handle: PlaybackHandle;
  backendInstanceId: number;
  category: SoundCategory;
  channel: number;
  /** Per-playback volume from play attributes (`0.0`–`1.0`). */
  playbackVolume: number;
}

function channelKey(category: SoundCategory, channel: number): string {
  return `${category}:${channel}`;
}

/** Tracks active playback handles and channel occupancy. */
export class PlaybackRegistry {
  private readonly byHandleId = new Map<number, PlaybackEntry>();
  private readonly byChannel = new Map<string, PlaybackHandle>();

  register(entry: PlaybackEntry): void {
    this.byHandleId.set(entry.handle.handleId, entry);
    this.byChannel.set(channelKey(entry.category, entry.channel), entry.handle);
  }

  getByHandle(handle: PlaybackHandle): PlaybackEntry | undefined {
    if (!handle.isActive()) {
      return undefined;
    }
    const entry = this.byHandleId.get(handle.handleId);
    if (!entry || entry.handle !== handle) {
      return undefined;
    }
    return entry;
  }

  getByBackendInstanceId(
    backendInstanceId: number,
  ): PlaybackEntry | undefined {
    for (const entry of this.byHandleId.values()) {
      if (entry.backendInstanceId === backendInstanceId) {
        return entry;
      }
    }
    return undefined;
  }

  getActiveHandleForChannel(
    category: SoundCategory,
    channel: number,
  ): PlaybackHandle | undefined {
    return this.byChannel.get(channelKey(category, channel));
  }

  invalidateChannel(
    category: SoundCategory,
    channel: number,
  ): PlaybackEntry | undefined {
    const key = channelKey(category, channel);
    const current = this.byChannel.get(key);
    if (!current) {
      return undefined;
    }

    const entry = this.byHandleId.get(current.handleId);
    if (!entry) {
      return undefined;
    }

    current.invalidate();
    this.remove(entry);
    return entry;
  }

  remove(entry: PlaybackEntry): void {
    this.byHandleId.delete(entry.handle.handleId);
    const key = channelKey(entry.category, entry.channel);
    if (this.byChannel.get(key) === entry.handle) {
      this.byChannel.delete(key);
    }
  }

  entriesForCategory(category: SoundCategory): PlaybackEntry[] {
    return [...this.byHandleId.values()].filter(
      (entry) => entry.category === category,
    );
  }

  hasActivePlaybackForSound(soundId: string): boolean {
    for (const entry of this.byHandleId.values()) {
      if (entry.handle.isActive() && entry.handle.soundId === soundId) {
        return true;
      }
    }
    return false;
  }

  allEntries(): PlaybackEntry[] {
    return [...this.byHandleId.values()];
  }

  clear(): void {
    this.byHandleId.clear();
    this.byChannel.clear();
  }
}
