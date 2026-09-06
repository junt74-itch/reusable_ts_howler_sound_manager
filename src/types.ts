/** Sound category identifiers. */
export const SoundCategory = {
  BGM: "bgm",
  BGS: "bgs",
  ME: "me",
  SE: "se",
  SYSTEM_SE: "systemSe",
} as const;

export type SoundCategory = (typeof SoundCategory)[keyof typeof SoundCategory];

/** Playback handle lifecycle states. */
export const PlaybackState = {
  LOADING: "loading",
  PLAYING: "playing",
  PAUSED: "paused",
  STOPPED: "stopped",
  ENDED: "ended",
  ERROR: "error",
} as const;

export type PlaybackState =
  (typeof PlaybackState)[keyof typeof PlaybackState];

export function isTerminalPlaybackState(state: PlaybackState): boolean {
  return (
    state === PlaybackState.STOPPED ||
    state === PlaybackState.ENDED ||
    state === PlaybackState.ERROR
  );
}
