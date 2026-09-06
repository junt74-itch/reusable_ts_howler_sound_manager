import { InvalidArgumentError } from "./errors.js";

/** Options passed to SoundManager.Initialize. */
export interface SoundManagerInitOptions {
  /** ME simultaneous playback slots. Integer >= 1. Default 1. */
  meChannelCount?: number;
  /** Pause BGM while ME is playing. Default true. */
  pauseBgmDuringMe?: boolean;
}

export const DEFAULT_INIT_OPTIONS: Required<SoundManagerInitOptions> = {
  meChannelCount: 1,
  pauseBgmDuringMe: true,
};

export function resolveInitOptions(
  options?: SoundManagerInitOptions,
): Required<SoundManagerInitOptions> {
  const meChannelCount =
    options?.meChannelCount ?? DEFAULT_INIT_OPTIONS.meChannelCount;

  if (!Number.isInteger(meChannelCount) || meChannelCount < 1) {
    throw new InvalidArgumentError(
      "meChannelCount must be an integer greater than or equal to 1",
    );
  }

  return {
    meChannelCount,
    pauseBgmDuringMe:
      options?.pauseBgmDuringMe ?? DEFAULT_INIT_OPTIONS.pauseBgmDuringMe,
  };
}
