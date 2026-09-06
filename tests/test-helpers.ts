import { SoundManager } from "../src/index.js";

/** Registers and preloads the given sound IDs for playback tests. */
export async function registerAndPreloadSounds(
  soundIds: readonly string[],
): Promise<void> {
  const resources = Object.fromEntries(
    soundIds.map((id) => [id, { src: [`audio/${id}.ogg`] }]),
  );
  SoundManager.registerCatalogForTesting({
    version: 1,
    resources,
    groups: { __test: [...soundIds] },
  });
  await SoundManager.PreloadGroup("__test");
}
