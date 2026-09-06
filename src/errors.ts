/** Base error for SoundManager failures. */
export class SoundManagerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** Thrown when SoundManager APIs are used before Initialize. */
export class NotInitializedError extends SoundManagerError {
  constructor(message = "SoundManager is not initialized") {
    super(message);
  }
}

/** Thrown for invalid arguments such as out-of-range attribute values. */
export class InvalidArgumentError extends SoundManagerError {
  constructor(message: string) {
    super(message);
  }
}

/** Thrown when catalog loading fails. */
export class CatalogFailureError extends SoundManagerError {
  readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.cause = cause;
  }
}

/** Thrown when group preload fails; exposes failed sound IDs. */
export class PreloadFailureError extends SoundManagerError {
  readonly failedIds: readonly string[];

  constructor(failedIds: readonly string[], message?: string) {
    super(message ?? `Preload failed for: ${failedIds.join(", ")}`);
    this.failedIds = failedIds;
  }
}

/** Thrown when playback references an unknown catalog sound ID. */
export class UnknownSoundIdError extends SoundManagerError {
  readonly soundId: string;

  constructor(soundId: string) {
    super(`Unknown sound ID: ${soundId}`);
    this.soundId = soundId;
  }
}

/** Thrown when playback references a catalog sound that is not loaded. */
export class SoundNotLoadedError extends SoundManagerError {
  readonly soundId: string;

  constructor(soundId: string) {
    super(`Sound is not loaded: ${soundId}`);
    this.soundId = soundId;
  }
}
