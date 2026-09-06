import { PlaybackState, SoundCategory, isTerminalPlaybackState } from "./types.js";

let nextPlaybackHandleId = 1;

/**
 * Identifies a single playback request. Distinct from channel slot numbers.
 */
export class PlaybackHandle {
  readonly handleId: number;
  readonly soundId: string;
  readonly category: SoundCategory;
  readonly channel: number;

  private _state: PlaybackState;
  private _active: boolean;

  constructor(
    soundId: string,
    category: SoundCategory,
    channel: number,
    state: PlaybackState = PlaybackState.PLAYING,
  ) {
    this.handleId = nextPlaybackHandleId++;
    this.soundId = soundId;
    this.category = category;
    this.channel = channel;
    this._state = state;
    this._active = true;
  }

  get state(): PlaybackState {
    return this._state;
  }

  /** Whether this handle still controls an active playback. */
  isActive(): boolean {
    return this._active && !isTerminalPlaybackState(this._state);
  }

  /** Marks the handle inactive when its channel is reused. */
  invalidate(): void {
    this._active = false;
    if (!isTerminalPlaybackState(this._state)) {
      this._state = PlaybackState.STOPPED;
    }
  }

  setState(state: PlaybackState): void {
    this._state = state;
    if (isTerminalPlaybackState(state)) {
      this._active = false;
    }
  }
}

/** Resets handle ID sequence for isolated tests. */
export function resetPlaybackHandleIdsForTesting(): void {
  nextPlaybackHandleId = 1;
}
