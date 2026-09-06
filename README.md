# reusable_ts_howler_sound_manager

TypeScript 製 HTML5 ゲーム向けの、Howler.js 2.2.4 を利用した RMMZ 様式のサウンドマネージャーです。BGM / BGS / ME / SE / SYSTEM SE の 5 区分を扱います。

## 導入

```bash
bun install
bun run build
```

パッケージ管理には bun を使用します。アプリからは ESM と型定義（`dist/`）を import します。

```ts
import {
  SoundCategory,
  SoundManager,
} from "reusable_ts_howler_sound_manager";
```

## 開発コマンド

```bash
bun run typecheck   # 型チェック
bun run build       # dist/ へビルド
bun run test        # 単体テスト
bun run generate-demo-audio  # デモ用正弦波 WAV を生成
bun run demo        # ブラウザーデモ（http://localhost:5173）
```

## API 概要

利用前に `SoundManager.Initialize(options?)` を呼びます。続いてカタログを登録し、グループをプリロードしてから再生します。未初期化での操作と、未ロード音源の再生はエラーです。

```ts
SoundManager.Initialize({ meChannelCount: 1, pauseBgmDuringMe: true });
await SoundManager.UnlockAudio(); // ユーザー操作後に AudioContext を再開

await SoundManager.LoadCatalog("audio/catalog.json");
await SoundManager.PreloadGroup("forest");

const bgm = SoundManager.PlayBGM({ id: "forest-bgm", volume: 0.8 });
SoundManager.SetMasterVolume(0.8);
SoundManager.SetCategoryMute(SoundCategory.SE, true);
SoundManager.Stop(bgm);

await SoundManager.UnloadGroup("forest");
```

- `Initialize` / `UnlockAudio`
- `LoadCatalog` / `PreloadGroup` / `UnloadGroup`
- `PlayBGM` / `PlayBGS` / `PlayME` / `PlaySE` / `PlaySystemSE`
- ハンドル単位の `Stop` / `Pause` / `Resume` と、区分別・全区分の一括停止
- `SetMasterVolume` / `GetMasterVolume` / `SetMasterMute` / `IsMasterMute`
- `SetCategoryVolume` / `GetCategoryVolume` / `SetCategoryMute` / `IsCategoryMute`

各再生 API は再生ハンドルを返します。BGM は初曲を即時に開始し、2 曲目以降を 2 枠でクロスフェードします。既定では ME 再生中に BGM を一時停止し、ME がなくなると、ME 連動で一時停止した BGM だけを再開します。SYSTEM SE は通常 SE と独立しています。

実効音量はマスター × 区分 × 再生 `volume` の積で、ミュート時は 0 です。

詳細は [サウンドマネージャー基本仕様](docs/sound-manager-spec.md) を参照してください。

## デモ

1. 音源生成（初回または再生成時）:

   ```bash
   bun run generate-demo-audio
   ```

2. デモサーバー起動:

   ```bash
   bun run demo
   ```

3. ブラウザーで `http://localhost:5173` を開き、「Initialize + UnlockAudio」から操作を開始します。

音源の周波数・生成方法は [docs/demo-audio.md](docs/demo-audio.md) に記載しています。

## 初版の対象外

- CommonJS 配布
- プリロード進捗コールバック
- 個別音源のロード・解放 API
- 実行中のチャンネル数変更と再初期化
- 公開の区分一括 Pause / Resume

`resetForTesting` などのテスト用フックと内部 backend は、公開ゲーム API ではありません。

## 制約と確認環境

- 未ロード音源への再生要求はエラーです。再生時の自動ロードは行いません。
- 自動再生制限があるため、実アプリ・デモともユーザー操作後に `UnlockAudio()` を呼んでください。
- Chromium 系（Cursor IDE 内蔵ブラウザー）でデモ操作を確認済みです。
- スピーカーによる実音の聴取、Safari、Firefox、実機モバイルブラウザーは未検証です。

## 関連ドキュメント

- [サウンドマネージャー基本仕様](docs/sound-manager-spec.md)
- [実装計画書](docs/implementation-plan.md)
- [実装進捗](docs/implementation-progress.md)
- [ブラウザー確認記録](docs/browser-verification.md)
- [デモ音源](docs/demo-audio.md)
