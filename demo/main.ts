import {
  PlaybackHandle,
  SoundCategory,
  SoundManager,
} from "../src/index.js";

const statusEl = document.querySelector<HTMLElement>("#status")!;
const initBtn = document.querySelector<HTMLButtonElement>("#btn-init")!;
const loadCommonBtn =
  document.querySelector<HTMLButtonElement>("#btn-load-common")!;
const loadForestBtn =
  document.querySelector<HTMLButtonElement>("#btn-load-forest")!;
const unloadForestBtn =
  document.querySelector<HTMLButtonElement>("#btn-unload-forest")!;

const playBgmBtn = document.querySelector<HTMLButtonElement>("#btn-play-bgm")!;
const stopBgmBtn = document.querySelector<HTMLButtonElement>("#btn-stop-bgm")!;
const playBgsBtn = document.querySelector<HTMLButtonElement>("#btn-play-bgs")!;
const stopBgsBtn = document.querySelector<HTMLButtonElement>("#btn-stop-bgs")!;
const playMeBtn = document.querySelector<HTMLButtonElement>("#btn-play-me")!;
const stopMeBtn = document.querySelector<HTMLButtonElement>("#btn-stop-me")!;
const playSeBtn = document.querySelector<HTMLButtonElement>("#btn-play-se")!;
const playSystemSeBtn =
  document.querySelector<HTMLButtonElement>("#btn-play-system-se")!;
const stopAllSeBtn =
  document.querySelector<HTMLButtonElement>("#btn-stop-all-se")!;
const stopAllBtn = document.querySelector<HTMLButtonElement>("#btn-stop-all")!;

const masterVolumeInput =
  document.querySelector<HTMLInputElement>("#master-volume")!;
const masterVolumeLabel =
  document.querySelector<HTMLElement>("#master-volume-label")!;
const masterMuteInput =
  document.querySelector<HTMLInputElement>("#master-mute")!;

const categoryControls = [
  {
    category: SoundCategory.BGM,
    volumeInput: document.querySelector<HTMLInputElement>("#bgm-volume")!,
    muteInput: document.querySelector<HTMLInputElement>("#bgm-mute")!,
  },
  {
    category: SoundCategory.BGS,
    volumeInput: document.querySelector<HTMLInputElement>("#bgs-volume")!,
    muteInput: document.querySelector<HTMLInputElement>("#bgs-mute")!,
  },
  {
    category: SoundCategory.ME,
    volumeInput: document.querySelector<HTMLInputElement>("#me-volume")!,
    muteInput: document.querySelector<HTMLInputElement>("#me-mute")!,
  },
  {
    category: SoundCategory.SE,
    volumeInput: document.querySelector<HTMLInputElement>("#se-volume")!,
    muteInput: document.querySelector<HTMLInputElement>("#se-mute")!,
  },
  {
    category: SoundCategory.SYSTEM_SE,
    volumeInput:
      document.querySelector<HTMLInputElement>("#system-se-volume")!,
    muteInput: document.querySelector<HTMLInputElement>("#system-se-mute")!,
  },
] as const;

let initialized = false;
let commonLoaded = false;
let forestLoaded = false;
let bgmHandle: PlaybackHandle | null = null;
let bgsHandle: PlaybackHandle | null = null;
let meHandle: PlaybackHandle | null = null;

function setStatus(message: string): void {
  statusEl.textContent = message;
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

async function runAsync(
  label: string,
  action: () => Promise<void>,
): Promise<void> {
  try {
    await action();
  } catch (error) {
    setStatus(`${label} 失敗: ${formatError(error)}`);
  }
}

function enableAfterInit(): void {
  for (const button of [
    loadCommonBtn,
    loadForestBtn,
    unloadForestBtn,
    playBgmBtn,
    stopBgmBtn,
    playBgsBtn,
    stopBgsBtn,
    playMeBtn,
    stopMeBtn,
    playSeBtn,
    playSystemSeBtn,
    stopAllSeBtn,
    stopAllBtn,
  ]) {
    button.disabled = false;
  }
}

function sliderToVolume(value: string): number {
  return Number(value) / 100;
}

async function ensureInitialized(): Promise<void> {
  if (initialized) {
    return;
  }

  SoundManager.Initialize({ meChannelCount: 1, pauseBgmDuringMe: true });
  await SoundManager.UnlockAudio();
  initialized = true;
  enableAfterInit();
  setStatus("Initialize + UnlockAudio 完了");
}

initBtn.addEventListener("click", () => {
  void runAsync("Initialize", ensureInitialized);
});

loadCommonBtn.addEventListener("click", () => {
  void runAsync("common プリロード", async () => {
    await ensureInitialized();
    if (!commonLoaded) {
      await SoundManager.LoadCatalog("/catalog.json");
      await SoundManager.PreloadGroup("common");
      commonLoaded = true;
    }
    setStatus("common グループをプリロードしました");
  });
});

loadForestBtn.addEventListener("click", () => {
  void runAsync("forest プリロード", async () => {
    await ensureInitialized();
    if (!commonLoaded) {
      await SoundManager.LoadCatalog("/catalog.json");
      await SoundManager.PreloadGroup("common");
      commonLoaded = true;
    }
    await SoundManager.PreloadGroup("forest");
    forestLoaded = true;
    setStatus("forest グループをプリロードしました");
  });
});

unloadForestBtn.addEventListener("click", () => {
  void runAsync("forest アンロード", async () => {
    await ensureInitialized();
    await SoundManager.UnloadGroup("forest");
    forestLoaded = false;
    setStatus("forest グループをアンロードしました");
  });
});

playBgmBtn.addEventListener("click", () => {
  void runAsync("BGM 再生", async () => {
    await ensureInitialized();
    if (!forestLoaded) {
      setStatus("先に forest グループをプリロードしてください");
      return;
    }
    bgmHandle = SoundManager.PlayBGM({
      id: "demo-bgm",
      volume: 0.8,
      fadeSeconds: 1,
    });
    setStatus(`BGM 再生中: ${bgmHandle.soundId}`);
  });
});

stopBgmBtn.addEventListener("click", () => {
  if (bgmHandle) {
    SoundManager.StopBGM(bgmHandle);
    bgmHandle = null;
    setStatus("BGM を停止しました");
  }
});

playBgsBtn.addEventListener("click", () => {
  void runAsync("BGS 再生", async () => {
    await ensureInitialized();
    if (!forestLoaded) {
      setStatus("先に forest グループをプリロードしてください");
      return;
    }
    bgsHandle = SoundManager.PlayBGS({
      channel: 0,
      id: "demo-bgs",
      volume: 0.7,
    });
    setStatus(`BGS 再生中: ${bgsHandle.soundId} (ch ${bgsHandle.channel})`);
  });
});

stopBgsBtn.addEventListener("click", () => {
  SoundManager.StopBGS(0);
  bgsHandle = null;
  setStatus("BGS ch0 を停止しました");
});

playMeBtn.addEventListener("click", () => {
  void runAsync("ME 再生", async () => {
    await ensureInitialized();
    if (!forestLoaded) {
      setStatus("先に forest グループをプリロードしてください");
      return;
    }
    meHandle = SoundManager.PlayME({ id: "demo-me", volume: 1 });
    setStatus(`ME 再生中: ${meHandle.soundId}`);
  });
});

stopMeBtn.addEventListener("click", () => {
  if (meHandle) {
    SoundManager.StopME(meHandle);
    meHandle = null;
    setStatus("ME を停止しました");
  }
});

playSeBtn.addEventListener("click", () => {
  void runAsync("SE 再生", async () => {
    await ensureInitialized();
    if (!commonLoaded) {
      setStatus("先に common グループをプリロードしてください");
      return;
    }
    const handle = SoundManager.PlaySE({ id: "demo-se", volume: 1 });
    setStatus(`SE 再生中: ${handle.soundId}`);
  });
});

playSystemSeBtn.addEventListener("click", () => {
  void runAsync("SYSTEM SE 再生", async () => {
    await ensureInitialized();
    if (!commonLoaded) {
      setStatus("先に common グループをプリロードしてください");
      return;
    }
    const handle = SoundManager.PlaySystemSE({
      id: "demo-system-se",
      volume: 1,
    });
    setStatus(`SYSTEM SE 再生中: ${handle.soundId}`);
  });
});

stopAllSeBtn.addEventListener("click", () => {
  SoundManager.StopAllSE();
  setStatus("StopAllSE 実行（SYSTEM SE は継続）");
});

stopAllBtn.addEventListener("click", () => {
  SoundManager.StopAll();
  bgmHandle = null;
  bgsHandle = null;
  meHandle = null;
  setStatus("StopAll 実行");
});

masterVolumeInput.addEventListener("input", () => {
  if (!initialized) {
    return;
  }
  const volume = sliderToVolume(masterVolumeInput.value);
  SoundManager.SetMasterVolume(volume);
  masterVolumeLabel.textContent = volume.toFixed(2);
});

masterMuteInput.addEventListener("change", () => {
  if (!initialized) {
    return;
  }
  SoundManager.SetMasterMute(masterMuteInput.checked);
});

for (const control of categoryControls) {
  control.volumeInput.addEventListener("input", () => {
    if (!initialized) {
      return;
    }
    SoundManager.SetCategoryVolume(
      control.category,
      sliderToVolume(control.volumeInput.value),
    );
  });

  control.muteInput.addEventListener("change", () => {
    if (!initialized) {
      return;
    }
    SoundManager.SetCategoryMute(control.category, control.muteInput.checked);
  });
}
