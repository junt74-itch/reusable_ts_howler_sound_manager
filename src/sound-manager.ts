import {
  BgmPlayAttributes,
  BgsPlayAttributes,
  MePlayAttributes,
  SePlayAttributes,
  SystemSePlayAttributes,
  toBgmPlayAttributes,
  toBgsPlayAttributes,
  toMePlayAttributes,
  toSePlayAttributes,
  toSystemSePlayAttributes,
  type BgmPlayAttributesInput,
  type BgsPlayAttributesInput,
  type MePlayAttributesInput,
  type SePlayAttributesInput,
  type SystemSePlayAttributesInput,
} from "./attributes.js";
import {
  AudioBackend,
  FakeAudioBackend,
  type AudioBackendPlayOptions,
} from "./audio-backend.js";
import { HowlerBackend } from "./howler-backend.js";
import { Catalog } from "./catalog.js";
import { ChannelPool } from "./channel-pool.js";
import {
  InvalidArgumentError,
  NotInitializedError,
  SoundNotLoadedError,
  UnknownSoundIdError,
} from "./errors.js";
import {
  DEFAULT_INIT_OPTIONS,
  resolveInitOptions,
  type SoundManagerInitOptions,
} from "./init-options.js";
import { PlaybackHandle } from "./playback-handle.js";
import { PlaybackRegistry, type PlaybackEntry } from "./playback-registry.js";
import { ResourceStore } from "./resource-store.js";
import { PlaybackState, SoundCategory } from "./types.js";

const CATEGORY_POOL_SIZES: Record<
  Exclude<SoundCategory, typeof SoundCategory.ME>,
  number
> = {
  [SoundCategory.BGM]: 2,
  [SoundCategory.BGS]: 4,
  [SoundCategory.SE]: 16,
  [SoundCategory.SYSTEM_SE]: 4,
};

function createDefaultCategoryVolumes(): Record<SoundCategory, number> {
  return {
    [SoundCategory.BGM]: 1,
    [SoundCategory.BGS]: 1,
    [SoundCategory.ME]: 1,
    [SoundCategory.SE]: 1,
    [SoundCategory.SYSTEM_SE]: 1,
  };
}

function createDefaultCategoryMutes(): Record<SoundCategory, boolean> {
  return {
    [SoundCategory.BGM]: false,
    [SoundCategory.BGS]: false,
    [SoundCategory.ME]: false,
    [SoundCategory.SE]: false,
    [SoundCategory.SYSTEM_SE]: false,
  };
}

/**
 * Static entry point for RMMZ-style sound playback.
 */
export class SoundManager {
  private static initialized = false;
  private static useFakeBackendOnNextInit = false;
  private static options: Required<SoundManagerInitOptions> =
    DEFAULT_INIT_OPTIONS;
  private static backend: AudioBackend = new FakeAudioBackend();
  private static registry = new PlaybackRegistry();
  private static catalog = new Catalog();
  private static resourceStore: ResourceStore | null = null;
  private static pools: Record<SoundCategory, ChannelPool> | null = null;
  private static readonly bgmPendingFadeOutByInstanceId = new Map<
    number,
    PlaybackEntry
  >();
  /** BGM handles paused internally because ME is active. */
  private static readonly bgmPausedByMe = new Set<PlaybackHandle>();
  /** Suppresses BGM resume while ME channel reuse is in progress. */
  private static mePlaybackTransactionDepth = 0;
  private static masterVolume = 1;
  private static masterMute = false;
  private static categoryVolumes: Record<SoundCategory, number> =
    createDefaultCategoryVolumes();
  private static categoryMutes: Record<SoundCategory, boolean> =
    createDefaultCategoryMutes();

  private constructor() {
    // Static API only.
  }

  static Initialize(options?: SoundManagerInitOptions): void {
    if (SoundManager.initialized) {
      throw new InvalidArgumentError("SoundManager is already initialized");
    }

    SoundManager.options = resolveInitOptions(options);
    SoundManager.backend = SoundManager.useFakeBackendOnNextInit
      ? new FakeAudioBackend()
      : new HowlerBackend();
    SoundManager.useFakeBackendOnNextInit = false;
    SoundManager.attachBackendLifecycleHandlers();
    SoundManager.registry = new PlaybackRegistry();
    SoundManager.catalog = new Catalog();
    SoundManager.resourceStore = new ResourceStore(
      SoundManager.catalog,
      SoundManager.backend,
      (soundId) => SoundManager.registry.hasActivePlaybackForSound(soundId),
    );
    SoundManager.pools = {
      [SoundCategory.BGM]: new ChannelPool(CATEGORY_POOL_SIZES[SoundCategory.BGM]),
      [SoundCategory.BGS]: new ChannelPool(CATEGORY_POOL_SIZES[SoundCategory.BGS]),
      [SoundCategory.ME]: new ChannelPool(SoundManager.options.meChannelCount),
      [SoundCategory.SE]: new ChannelPool(CATEGORY_POOL_SIZES[SoundCategory.SE]),
      [SoundCategory.SYSTEM_SE]: new ChannelPool(
        CATEGORY_POOL_SIZES[SoundCategory.SYSTEM_SE],
      ),
    };
    SoundManager.resetMixerState();
    SoundManager.initialized = true;
  }

  static SetMasterVolume(volume: number): void {
    SoundManager.assertInitialized();
    SoundManager.assertVolumeInRange(volume, "Master volume");
    SoundManager.masterVolume = volume;
    SoundManager.applyEffectiveVolumeToActivePlaybacks();
  }

  static GetMasterVolume(): number {
    SoundManager.assertInitialized();
    return SoundManager.masterVolume;
  }

  static SetMasterMute(muted: boolean): void {
    SoundManager.assertInitialized();
    SoundManager.masterMute = muted;
    SoundManager.applyEffectiveVolumeToActivePlaybacks();
  }

  static IsMasterMute(): boolean {
    SoundManager.assertInitialized();
    return SoundManager.masterMute;
  }

  static SetCategoryVolume(category: SoundCategory, volume: number): void {
    SoundManager.assertInitialized();
    SoundManager.assertVolumeInRange(volume, `Category volume (${category})`);
    SoundManager.categoryVolumes[category] = volume;
    SoundManager.applyEffectiveVolumeToActivePlaybacks(category);
  }

  static GetCategoryVolume(category: SoundCategory): number {
    SoundManager.assertInitialized();
    return SoundManager.categoryVolumes[category];
  }

  static SetCategoryMute(category: SoundCategory, muted: boolean): void {
    SoundManager.assertInitialized();
    SoundManager.categoryMutes[category] = muted;
    SoundManager.applyEffectiveVolumeToActivePlaybacks(category);
  }

  static IsCategoryMute(category: SoundCategory): boolean {
    SoundManager.assertInitialized();
    return SoundManager.categoryMutes[category];
  }

  static UnlockAudio(): Promise<void> {
    SoundManager.assertInitialized();
    return SoundManager.backend.unlockAudio();
  }

  static PlayBGM(
    attributes: BgmPlayAttributes | BgmPlayAttributesInput,
  ): PlaybackHandle {
    const params = toBgmPlayAttributes(attributes);
    SoundManager.assertInitialized();
    SoundManager.assertSoundPlayable(params.id);

    const activeEntries = SoundManager.getActiveBgmEntries();

    if (params.fadeSeconds === 0) {
      return SoundManager.playBgmImmediate(params, activeEntries);
    }

    if (activeEntries.length === 0) {
      return SoundManager.playBgmFirst(params);
    }

    return SoundManager.playBgmCrossfade(params, activeEntries);
  }

  static PlayBGS(
    attributes: BgsPlayAttributes | BgsPlayAttributesInput,
  ): PlaybackHandle {
    const params = toBgsPlayAttributes(attributes);
    return SoundManager.startPlaybackOnChannel(
      SoundCategory.BGS,
      params.channel,
      params.id,
      {
        soundId: params.id,
        volume: params.volume,
        pan: params.pan,
        loop: params.loop,
        initialAudioPosition: params.initialAudioPosition,
      },
    );
  }

  static PlayME(
    attributes: MePlayAttributes | MePlayAttributesInput,
  ): PlaybackHandle {
    const params = toMePlayAttributes(attributes);
    return SoundManager.startMePlayback({
      soundId: params.id,
      volume: params.volume,
      pan: params.pan,
      loop: params.loop,
      initialAudioPosition: params.initialAudioPosition,
    });
  }

  static PlaySE(
    attributes: SePlayAttributes | SePlayAttributesInput,
  ): PlaybackHandle {
    const params = toSePlayAttributes(attributes);
    return SoundManager.startPlayback(SoundCategory.SE, {
      soundId: params.id,
      volume: params.volume,
      pan: params.pan,
      initialAudioPosition: params.initialAudioPosition,
    });
  }

  static PlaySystemSE(
    attributes: SystemSePlayAttributes | SystemSePlayAttributesInput,
  ): PlaybackHandle {
    const params = toSystemSePlayAttributes(attributes);
    return SoundManager.startPlayback(SoundCategory.SYSTEM_SE, {
      soundId: params.id,
      volume: params.volume,
      pan: params.pan,
      initialAudioPosition: params.initialAudioPosition,
    });
  }

  static StopBGM(handle: PlaybackHandle): void {
    SoundManager.stopHandleInCategory(SoundCategory.BGM, handle);
  }

  static StopBGS(handleOrChannel: PlaybackHandle | number): void {
    SoundManager.assertInitialized();
    if (typeof handleOrChannel === "number") {
      SoundManager.stopChannel(SoundCategory.BGS, handleOrChannel);
      return;
    }
    SoundManager.stopHandleInCategory(SoundCategory.BGS, handleOrChannel);
  }

  static StopME(handle: PlaybackHandle): void {
    SoundManager.stopHandleInCategory(SoundCategory.ME, handle);
  }

  static StopSE(handle: PlaybackHandle): void {
    SoundManager.stopHandleInCategory(SoundCategory.SE, handle);
  }

  static StopSystemSE(handle: PlaybackHandle): void {
    SoundManager.stopHandleInCategory(SoundCategory.SYSTEM_SE, handle);
  }

  static Stop(handle: PlaybackHandle): void {
    SoundManager.assertInitialized();
    SoundManager.stopHandle(handle);
  }

  static Pause(handle: PlaybackHandle): void {
    SoundManager.assertInitialized();
    if (!handle.isActive()) {
      return;
    }

    const entry = SoundManager.registry.getByHandle(handle);
    if (!entry) {
      return;
    }

    SoundManager.backend.pause(entry.backendInstanceId);
    handle.setState(PlaybackState.PAUSED);
  }

  static Resume(handle: PlaybackHandle): void {
    SoundManager.assertInitialized();
    if (!handle.isActive()) {
      return;
    }

    const entry = SoundManager.registry.getByHandle(handle);
    if (!entry) {
      return;
    }

    SoundManager.backend.resume(entry.backendInstanceId);
    handle.setState(PlaybackState.PLAYING);
  }

  static LoadCatalog(catalogUrl: string): Promise<void> {
    SoundManager.assertInitialized();
    return SoundManager.catalog.loadFromUrl(catalogUrl);
  }

  static PreloadGroup(groupName: string): Promise<void> {
    SoundManager.assertInitialized();
    return SoundManager.resourceStore!.preloadGroup(groupName);
  }

  static UnloadGroup(groupName: string): Promise<void> {
    SoundManager.assertInitialized();
    return SoundManager.resourceStore!.unloadGroup(groupName);
  }

  static StopAll(): void {
    SoundManager.assertInitialized();
    SoundManager.StopAllBGM();
    SoundManager.StopAllBGS();
    SoundManager.StopAllME();
    SoundManager.StopAllSE();
    SoundManager.StopAllSystemSE();
  }

  static StopAllBGM(): void {
    SoundManager.stopAllInCategory(SoundCategory.BGM);
  }

  static StopAllBGS(): void {
    SoundManager.stopAllInCategory(SoundCategory.BGS);
  }

  static StopAllME(): void {
    SoundManager.stopAllInCategory(SoundCategory.ME);
  }

  static StopAllSE(): void {
    SoundManager.stopAllInCategory(SoundCategory.SE);
  }

  static StopAllSystemSE(): void {
    SoundManager.stopAllInCategory(SoundCategory.SYSTEM_SE);
  }

  /** @internal Test hook to inspect the fake backend. */
  static getBackendForTesting(): FakeAudioBackend | undefined {
    return SoundManager.backend instanceof FakeAudioBackend
      ? SoundManager.backend
      : undefined;
  }

  /** @internal Exposes backend instance ID for tests. */
  static getBackendInstanceIdForTesting(
    handle: PlaybackHandle,
  ): number | undefined {
    return SoundManager.registry.getByHandle(handle)?.backendInstanceId;
  }

  /** @internal Resets static state for isolated tests. */
  static resetForTesting(): void {
    SoundManager.initialized = false;
    SoundManager.useFakeBackendOnNextInit = true;
    SoundManager.options = DEFAULT_INIT_OPTIONS;
    SoundManager.backend = new FakeAudioBackend();
    SoundManager.registry = new PlaybackRegistry();
    SoundManager.catalog = new Catalog();
    SoundManager.resourceStore = null;
    SoundManager.pools = null;
    SoundManager.bgmPendingFadeOutByInstanceId.clear();
    SoundManager.bgmPausedByMe.clear();
    SoundManager.mePlaybackTransactionDepth = 0;
    SoundManager.resetMixerState();
  }

  /** @internal Registers catalog JSON without fetch for tests. */
  static registerCatalogForTesting(
    json: unknown,
    catalogUrl = "https://example.test/audio/catalog.json",
  ): void {
    SoundManager.assertInitialized();
    SoundManager.catalog.registerParsed(json, catalogUrl);
  }

  /** @internal Exposes resource store for tests. */
  static getResourceStoreForTesting(): ResourceStore | null {
    return SoundManager.resourceStore;
  }

  private static assertInitialized(): void {
    if (!SoundManager.initialized || !SoundManager.pools) {
      throw new NotInitializedError();
    }
  }

  private static assertSoundPlayable(soundId: string): void {
    if (!SoundManager.catalog.hasResource(soundId)) {
      throw new UnknownSoundIdError(soundId);
    }
    if (!SoundManager.resourceStore!.isLoaded(soundId)) {
      throw new SoundNotLoadedError(soundId);
    }
  }

  private static getActiveBgmEntries(): PlaybackEntry[] {
    return SoundManager.registry
      .entriesForCategory(SoundCategory.BGM)
      .filter((entry) => entry.handle.isActive());
  }

  private static playBgmFirst(params: BgmPlayAttributes): PlaybackHandle {
    const pool = SoundManager.pools![SoundCategory.BGM];
    const channel = pool.findFreeChannel();
    if (channel === undefined) {
      throw new InvalidArgumentError("BGM channel pool is full");
    }
    pool.acquire(channel);
    return SoundManager.createBgmPlayback(channel, params, 1);
  }

  private static playBgmImmediate(
    params: BgmPlayAttributes,
    activeEntries: PlaybackEntry[],
  ): PlaybackHandle {
    SoundManager.bgmPendingFadeOutByInstanceId.clear();
    SoundManager.resourceStore!.retain(params.id);
    try {
      for (const entry of activeEntries) {
        SoundManager.stopBgmEntry(entry);
      }
      return SoundManager.playBgmFirst(params);
    } finally {
      SoundManager.resourceStore!.releaseRetain(params.id);
    }
  }

  private static playBgmCrossfade(
    params: BgmPlayAttributes,
    activeEntries: PlaybackEntry[],
  ): PlaybackHandle {
    return SoundManager.withSoundRetain(params.id, () => {
      SoundManager.abortBgmOutgoingFades();

      const remainingActive = SoundManager.getActiveBgmEntries();
      const outgoingEntry = SoundManager.selectNewestActiveBgmEntry(remainingActive);
      if (!outgoingEntry) {
        return SoundManager.playBgmFirst(params);
      }

      const pool = SoundManager.pools![SoundCategory.BGM];
      const channel = pool.findFreeChannel();
      if (channel === undefined) {
        throw new InvalidArgumentError("BGM channel pool is full");
      }
      pool.acquire(channel);

      const incoming = SoundManager.createBgmPlayback(channel, params, 0);
      const incomingInstanceId = SoundManager.registry.getByHandle(incoming)!
        .backendInstanceId;

      SoundManager.backend.fade(incomingInstanceId, 1, params.fadeSeconds);
      SoundManager.backend.fade(outgoingEntry.backendInstanceId, 0, params.fadeSeconds);
      SoundManager.bgmPendingFadeOutByInstanceId.set(
        outgoingEntry.backendInstanceId,
        outgoingEntry,
      );

      return incoming;
    });
  }

  private static abortBgmOutgoingFades(): void {
    const outgoingEntries = [
      ...SoundManager.bgmPendingFadeOutByInstanceId.values(),
    ];
    SoundManager.bgmPendingFadeOutByInstanceId.clear();
    for (const entry of outgoingEntries) {
      if (entry.handle.isActive()) {
        SoundManager.stopBgmEntry(entry);
      }
    }
  }

  private static selectNewestActiveBgmEntry(
    entries: PlaybackEntry[],
  ): PlaybackEntry | undefined {
    if (entries.length === 0) {
      return undefined;
    }

    return entries.reduce((newest, entry) =>
      entry.handle.handleId > newest.handle.handleId ? entry : newest,
    );
  }

  private static createBgmPlayback(
    channel: number,
    params: BgmPlayAttributes,
    initialGain: number,
  ): PlaybackHandle {
    const handle = new PlaybackHandle(
      params.id,
      SoundCategory.BGM,
      channel,
      PlaybackState.PLAYING,
    );
    const instance = SoundManager.backend.play({
      soundId: params.id,
      volume: SoundManager.computeEffectiveVolume(
        SoundCategory.BGM,
        params.volume,
      ),
      gain: initialGain,
      pan: params.pan,
      loop: params.loop,
      initialAudioPosition: params.initialAudioPosition,
      fadeSeconds: params.fadeSeconds,
    });
    SoundManager.registry.register({
      handle,
      backendInstanceId: instance.backendInstanceId,
      category: SoundCategory.BGM,
      channel,
      playbackVolume: params.volume,
    });
    SoundManager.onBgmPlaybackStarted(handle);
    return handle;
  }

  private static stopBgmEntry(entry: PlaybackEntry): void {
    SoundManager.bgmPendingFadeOutByInstanceId.delete(entry.backendInstanceId);
    SoundManager.stopHandle(entry.handle);
  }

  private static finalizeBgmFadeOut(entry: PlaybackEntry): void {
    if (!entry.handle.isActive()) {
      SoundManager.bgmPendingFadeOutByInstanceId.delete(entry.backendInstanceId);
      return;
    }

    SoundManager.bgmPendingFadeOutByInstanceId.delete(entry.backendInstanceId);
    SoundManager.backend.stop(entry.backendInstanceId);
    entry.handle.setState(PlaybackState.STOPPED);
    SoundManager.pools![SoundCategory.BGM].release(entry.channel);
    SoundManager.registry.remove(entry);
    SoundManager.resourceStore?.notifyPlaybackReleased(entry.handle.soundId);
  }

  private static startMePlayback(
    backendOptions: AudioBackendPlayOptions,
  ): PlaybackHandle {
    SoundManager.assertInitialized();
    SoundManager.assertSoundPlayable(backendOptions.soundId);

    return SoundManager.withSoundRetain(backendOptions.soundId, () => {
      const activeMeBefore = SoundManager.getActiveMeCount();
      SoundManager.beginMePlaybackTransaction();
      try {
        const pool = SoundManager.pools![SoundCategory.ME];
        const { channel, reused } = pool.allocate();

        if (reused) {
          SoundManager.invalidateChannelPlayback(SoundCategory.ME, channel);
        }

        const handle = SoundManager.createPlayback(
          SoundCategory.ME,
          channel,
          backendOptions.soundId,
          backendOptions,
        );

        if (
          SoundManager.options.pauseBgmDuringMe &&
          activeMeBefore === 0
        ) {
          SoundManager.pausePlayingBgmForMe();
        }

        return handle;
      } finally {
        SoundManager.endMePlaybackTransaction();
      }
    });
  }

  private static startPlayback(
    category: SoundCategory,
    backendOptions: AudioBackendPlayOptions,
  ): PlaybackHandle {
    SoundManager.assertInitialized();
    SoundManager.assertSoundPlayable(backendOptions.soundId);

    return SoundManager.withSoundRetain(backendOptions.soundId, () => {
      const pool = SoundManager.pools![category];
      const { channel, reused } = pool.allocate();

      if (reused) {
        SoundManager.invalidateChannelPlayback(category, channel);
      }

      return SoundManager.createPlayback(
        category,
        channel,
        backendOptions.soundId,
        backendOptions,
      );
    });
  }

  private static startPlaybackOnChannel(
    category: SoundCategory,
    channel: number,
    soundId: string,
    backendOptions: AudioBackendPlayOptions,
  ): PlaybackHandle {
    SoundManager.assertInitialized();
    SoundManager.assertSoundPlayable(soundId);

    return SoundManager.withSoundRetain(soundId, () => {
      const pool = SoundManager.pools![category];
      const { reused } = pool.acquire(channel);

      if (reused) {
        SoundManager.invalidateChannelPlayback(category, channel);
      }

      return SoundManager.createPlayback(
        category,
        channel,
        soundId,
        backendOptions,
      );
    });
  }

  private static createPlayback(
    category: SoundCategory,
    channel: number,
    soundId: string,
    backendOptions: AudioBackendPlayOptions,
  ): PlaybackHandle {
    const handle = new PlaybackHandle(
      soundId,
      category,
      channel,
      PlaybackState.PLAYING,
    );
    const effectiveVolume = SoundManager.computeEffectiveVolume(
      category,
      backendOptions.volume,
    );
    const instance = SoundManager.backend.play({
      ...backendOptions,
      volume: effectiveVolume,
    });
    SoundManager.registry.register({
      handle,
      backendInstanceId: instance.backendInstanceId,
      category,
      channel,
      playbackVolume: backendOptions.volume,
    });
    return handle;
  }

  private static invalidateChannelPlayback(
    category: SoundCategory,
    channel: number,
  ): void {
    const previousEntry = SoundManager.registry.invalidateChannel(
      category,
      channel,
    );
    if (previousEntry) {
      SoundManager.backend.stop(previousEntry.backendInstanceId);
      SoundManager.resourceStore?.notifyPlaybackReleased(previousEntry.handle.soundId);
    }
  }

  private static stopHandle(handle: PlaybackHandle): void {
    if (!handle.isActive()) {
      return;
    }

    const entry = SoundManager.registry.getByHandle(handle);
    if (!entry) {
      return;
    }

    if (entry.category === SoundCategory.BGM) {
      SoundManager.bgmPendingFadeOutByInstanceId.delete(entry.backendInstanceId);
    }

    SoundManager.backend.stop(entry.backendInstanceId);
    handle.setState(PlaybackState.STOPPED);
    SoundManager.pools![entry.category].release(entry.channel);
    SoundManager.registry.remove(entry);
    SoundManager.resourceStore?.notifyPlaybackReleased(entry.handle.soundId);

    if (entry.category === SoundCategory.ME) {
      SoundManager.onMePlaybackRemoved();
    }
  }

  private static stopHandleInCategory(
    category: SoundCategory,
    handle: PlaybackHandle,
  ): void {
    SoundManager.assertInitialized();
    if (handle.category !== category) {
      return;
    }
    SoundManager.stopHandle(handle);
  }

  private static stopChannel(
    category: SoundCategory,
    channel: number,
  ): void {
    const handle = SoundManager.registry.getActiveHandleForChannel(
      category,
      channel,
    );
    if (!handle) {
      return;
    }
    SoundManager.stopHandle(handle);
  }

  private static stopAllInCategory(category: SoundCategory): void {
    SoundManager.assertInitialized();
    if (category === SoundCategory.BGM) {
      SoundManager.bgmPendingFadeOutByInstanceId.clear();
    }
    const entries = [...SoundManager.registry.entriesForCategory(category)];
    for (const entry of entries) {
      SoundManager.stopHandle(entry.handle);
    }
  }

  private static attachBackendLifecycleHandlers(): void {
    SoundManager.backend.onEnded((backendInstanceId) => {
      SoundManager.handleBackendEnded(backendInstanceId);
    });
    SoundManager.backend.onError((backendInstanceId) => {
      SoundManager.handleBackendError(backendInstanceId);
    });
    SoundManager.backend.onFadeComplete((backendInstanceId) => {
      SoundManager.handleBackendFadeComplete(backendInstanceId);
    });
  }

  private static handleBackendEnded(backendInstanceId: number): void {
    const entry = SoundManager.registry.getByBackendInstanceId(backendInstanceId);
    if (!entry || !entry.handle.isActive()) {
      return;
    }

    entry.handle.setState(PlaybackState.ENDED);
    SoundManager.pools![entry.category].release(entry.channel);
    SoundManager.registry.remove(entry);
    SoundManager.resourceStore?.notifyPlaybackReleased(entry.handle.soundId);

    if (entry.category === SoundCategory.ME) {
      SoundManager.onMePlaybackRemoved();
    }
  }

  private static handleBackendError(backendInstanceId: number): void {
    const entry = SoundManager.registry.getByBackendInstanceId(backendInstanceId);
    if (!entry || !entry.handle.isActive()) {
      return;
    }

    if (entry.category === SoundCategory.BGM) {
      SoundManager.bgmPendingFadeOutByInstanceId.delete(backendInstanceId);
    }

    entry.handle.setState(PlaybackState.ERROR);
    SoundManager.pools![entry.category].release(entry.channel);
    SoundManager.registry.remove(entry);
    SoundManager.resourceStore?.notifyPlaybackReleased(entry.handle.soundId);

    if (entry.category === SoundCategory.ME) {
      SoundManager.onMePlaybackRemoved();
    }
  }

  private static handleBackendFadeComplete(backendInstanceId: number): void {
    const entry = SoundManager.bgmPendingFadeOutByInstanceId.get(
      backendInstanceId,
    );
    if (!entry) {
      return;
    }

    SoundManager.finalizeBgmFadeOut(entry);
  }

  private static getActiveMeCount(): number {
    return SoundManager.registry
      .entriesForCategory(SoundCategory.ME)
      .filter((entry) => entry.handle.isActive()).length;
  }

  private static beginMePlaybackTransaction(): void {
    SoundManager.mePlaybackTransactionDepth += 1;
  }

  private static endMePlaybackTransaction(): void {
    SoundManager.mePlaybackTransactionDepth -= 1;
  }

  private static onMePlaybackRemoved(): void {
    if (SoundManager.mePlaybackTransactionDepth > 0) {
      return;
    }
    if (!SoundManager.options.pauseBgmDuringMe) {
      return;
    }
    if (SoundManager.getActiveMeCount() === 0) {
      SoundManager.resumeBgmPausedByMe();
    }
  }

  private static pausePlayingBgmForMe(): void {
    for (const entry of SoundManager.getActiveBgmEntries()) {
      if (entry.handle.state !== PlaybackState.PLAYING) {
        continue;
      }

      SoundManager.backend.pause(entry.backendInstanceId);
      entry.handle.setState(PlaybackState.PAUSED);
      SoundManager.bgmPausedByMe.add(entry.handle);
    }
  }

  private static resumeBgmPausedByMe(): void {
    for (const handle of SoundManager.bgmPausedByMe) {
      if (!handle.isActive() || handle.state !== PlaybackState.PAUSED) {
        continue;
      }

      const entry = SoundManager.registry.getByHandle(handle);
      if (!entry) {
        continue;
      }

      SoundManager.backend.resume(entry.backendInstanceId);
      handle.setState(PlaybackState.PLAYING);
    }
    SoundManager.bgmPausedByMe.clear();
  }

  private static onBgmPlaybackStarted(handle: PlaybackHandle): void {
    if (!SoundManager.options.pauseBgmDuringMe) {
      return;
    }
    if (SoundManager.getActiveMeCount() === 0) {
      return;
    }

    const entry = SoundManager.registry.getByHandle(handle);
    if (!entry || handle.state !== PlaybackState.PLAYING) {
      return;
    }

    SoundManager.backend.pause(entry.backendInstanceId);
    handle.setState(PlaybackState.PAUSED);
    SoundManager.bgmPausedByMe.add(handle);
  }

  private static resetMixerState(): void {
    SoundManager.masterVolume = 1;
    SoundManager.masterMute = false;
    SoundManager.categoryVolumes = createDefaultCategoryVolumes();
    SoundManager.categoryMutes = createDefaultCategoryMutes();
  }

  private static assertVolumeInRange(volume: number, label: string): void {
    if (Number.isNaN(volume) || volume < 0 || volume > 1) {
      throw new InvalidArgumentError(`${label} must be between 0.0 and 1.0`);
    }
  }

  private static isCategoryMuted(category: SoundCategory): boolean {
    return SoundManager.masterMute || SoundManager.categoryMutes[category];
  }

  private static computeEffectiveVolume(
    category: SoundCategory,
    playbackVolume: number,
  ): number {
    if (SoundManager.isCategoryMuted(category)) {
      return 0;
    }
    return (
      SoundManager.masterVolume *
      SoundManager.categoryVolumes[category] *
      playbackVolume
    );
  }

  private static withSoundRetain<T>(soundId: string, fn: () => T): T {
    SoundManager.resourceStore!.retain(soundId);
    try {
      return fn();
    } finally {
      SoundManager.resourceStore!.releaseRetain(soundId);
    }
  }

  private static resolveEffectiveVolumeForEntry(entry: PlaybackEntry): number {
    return SoundManager.computeEffectiveVolume(
      entry.category,
      entry.playbackVolume,
    );
  }

  private static applyEffectiveVolumeToActivePlaybacks(
    category?: SoundCategory,
  ): void {
    for (const entry of SoundManager.registry.allEntries()) {
      if (!entry.handle.isActive()) {
        continue;
      }
      if (category !== undefined && entry.category !== category) {
        continue;
      }
      SoundManager.backend.setVolume(
        entry.backendInstanceId,
        SoundManager.resolveEffectiveVolumeForEntry(entry),
      );
    }
  }
}
