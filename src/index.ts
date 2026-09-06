export { SoundManager } from "./sound-manager.js";

export {
  BgmPlayAttributes,
  BgsPlayAttributes,
  MePlayAttributes,
  SePlayAttributes,
  SystemSePlayAttributes,
  type BgmPlayAttributesInput,
  type BgsPlayAttributesInput,
  type MePlayAttributesInput,
  type SePlayAttributesInput,
  type SystemSePlayAttributesInput,
} from "./attributes.js";

export { PlaybackHandle } from "./playback-handle.js";

export {
  SoundCategory,
  PlaybackState,
  isTerminalPlaybackState,
} from "./types.js";

export {
  type SoundManagerInitOptions,
  DEFAULT_INIT_OPTIONS,
} from "./init-options.js";

export {
  SoundManagerError,
  NotInitializedError,
  InvalidArgumentError,
  CatalogFailureError,
  PreloadFailureError,
  UnknownSoundIdError,
  SoundNotLoadedError,
} from "./errors.js";
