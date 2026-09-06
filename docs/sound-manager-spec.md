# サウンドマネージャー初版仕様

更新日: 2026-09-06

## 目的と位置づけ

TypeScript 製 HTML5 ゲーム向けに、Howler.js 2.2.4 を利用した RPG ツクール MZ（RMMZ）様式のサウンドマネージャーを提供する。

本書は、ユーザー要件と実装計画の判断 D1〜D6 に基づく初版の確定仕様であり、記載した公開 API は実装済みである。コード例はゲーム側から利用する公開 API の形を示す。工程ごとの記録は [実装進捗](implementation-progress.md) を参照する。

## 確定事項

### 初期化と公開面

- 公開 API は `SoundManager` の静的メソッドとする。
- 利用前に `SoundManager.Initialize(options?)` を呼ぶ。未初期化での再生・カタログ操作・プリロード・解放はエラーとする。
- 初版では実行中の再初期化と、ME 以外のチャンネル数の実行中変更は行わない。

```ts
SoundManager.Initialize({
  meChannelCount: 1,
  pauseBgmDuringMe: true,
});
```

| オプション | 意味 | デフォルト |
| --- | --- | --- |
| `meChannelCount` | ME の同時再生数。1以上の整数 | `1` |
| `pauseBgmDuringMe` | ME 再生中に BGM を一時停止する | `true` |

### サウンド区分とチャンネル数

本書でいうチャンネルは、左右のステレオではなく、同時再生のための枠を意味する。番号は 0 始まり。

| 区分 | 初期・デフォルト構成 | 要件 |
| --- | --- | --- |
| BGM | 2チャンネル | 2チャンネル間のクロスフェードに対応。将来、複数チャンネルの同時再生へ拡張できる余地を残す |
| BGS | 4チャンネル | 重なり合う環境音を同時再生する |
| ME | `Initialize` で指定。デフォルト 1 | 複数同時再生に対応し、同時再生数1では新しい要求で現在の音を置き換える使い方にも対応する |
| SE | 16チャンネル | 空きチャンネルを自動割り当てし、ワンショット再生する |
| SYSTEM SE | 4チャンネル | ゲーム世界とは別の、アプリ側で使う効果音を管理する |

BGM の枠は配列や共通プールで管理し、固定の A/B 専用設計に閉じない。Howler.js の内部プール設定を、本ライブラリの同時再生数として扱わない。

### 再生属性

`id` はカタログ登録済みの音源 ID で必須。範囲外の数値は例外とする（クランプしない）。

| 属性 | 意味 | デフォルト |
| --- | --- | --- |
| `id` | 登録済み音源ID | 必須 |
| `volume` | `0.0`〜`1.0` | `1.0` |
| `pan` | `-1.0`＝左、`0.0`＝中央、`1.0`＝右 | `0.0` |
| `loop` | `-1`＝無限、`0`＝追加リピートなし、正の整数＝追加リピート回数 | BGM/BGS は `-1`、ME は `0` |
| `initialAudioPosition` | 初回の再生開始位置。秒単位。リピート時は先頭へ戻る | `0` |
| `fadeSeconds` | BGM クロスフェード秒。`0` は即時切り替え | BGM のみ。`1` |
| `channel` | BGS の枠番号 `0..3` | BGS では必須 |

SE と SYSTEM SE の属性に `loop` は持たせない。`pan: 0.5` は右寄りである。

### 全区分共通の再生ハンドル

- ハンドルはチャンネルそのものではなく、1回の再生要求を識別する。
- すべての区分の再生 API は再生ハンドルを返す。
- すべての区分で、再生ハンドルを指定して停止できる。
- BGS ではチャンネル指定での再生・停止も提供する。
- チャンネルが再利用されても、古いハンドルの操作は新しい再生に影響しない。
- 停止・終了・エラー済みハンドルへの `Stop` は何もしない。
- ハンドルから `soundId`、区分、チャンネル、状態を参照できる。
- 状態は `loading`、`playing`、`paused`、`stopped`、`ended`、`error`。`loading` は公開状態として定義するが、初版はプリロード後に同期的に再生を開始するため、通常の `Play` 戻り値は `playing` から始まる。
- 再生終了後も呼び出し側が保持するハンドルは `ended` を参照できる。
- クロスフェード中の旧 BGM と新 BGM は別ハンドルで管理する。
- 区分共通の `Stop(handle)`、`Pause(handle)`、`Resume(handle)` を提供する。終端状態への Pause/Resume は何もしない。

```ts
const bgm = SoundManager.PlayBGM(bgmParams);
const bgs = SoundManager.PlayBGS(bgsParams);
const me = SoundManager.PlayME(meParams);
const se = SoundManager.PlaySE(seParams);
const systemSe = SoundManager.PlaySystemSE(systemSeParams);

SoundManager.StopBGM(bgm);
SoundManager.StopBGS(bgs);
SoundManager.StopME(me);
SoundManager.StopSE(se);
SoundManager.StopSystemSE(systemSe);
SoundManager.Stop(bgm);
```

### BGM

`BgmPlayAttributes` に再生属性をまとめ、`PlayBGM` に渡す。

```ts
const bpa = new BgmPlayAttributes({
  id: "that-music",
  volume: 1.0,
  pan: 0.5,
  loop: -1,
  initialAudioPosition: 0,
  fadeSeconds: 1,
});

const bgm = SoundManager.PlayBGM(bpa);
```

- 通常は1曲をループし、曲変更時に空き側で新曲を開始してクロスフェードする。
- 初曲はフェードインせず、指定音量で即時に再生を開始する。2曲目以降でクロスフェードする。
- `PlayBGM` は常に新しい再生として扱う。同じ曲の再要求も no-op にせずクロスフェードする。
- フェード中の再要求は進行中フェードを打ち切り、空き枠（必要なら先に空ける枠）で新しいクロスフェードを開始する。
- フェード対象ハンドルの停止は、そのハンドル側だけを止める。相手側のフェードは継続する。

### BGS

- `PlayBGS` はチャンネルを指定して再生する。同じチャンネルへの再生は既存音を停止して置き換える。
- 各チャンネルでループ可能。デフォルトは無限ループ。
- `StopBGS` はハンドル指定とチャンネル番号指定の両方に対応する。

```ts
const bgsp = SoundManager.PlayBGS({
  channel: 0,
  id: "rain",
  volume: 0.8,
});

SoundManager.StopBGS(bgsp);
SoundManager.StopBGS(0);
```

### ME

- 同時再生数のデフォルトは 1。`Initialize({ meChannelCount })` で変更できる。
- 満杯時は最古の ME を停止して新しい音を鳴らす。同時再生数 1 では新しい要求が現在の音を置き換える。
- 個々の再生ハンドルを取得し、指定して停止できる。
- `pauseBgmDuringMe` が有効なとき、最初の ME 開始で BGM を一時停止し、ME が 0 件になったら再開する。置き換え途中では BGM を再開しない。
- この連動の BGM 一時停止は内部処理とする。公開の区分一括 Pause API は初版に置かない。

### SE

- ワンショット音源を、原則として再生終了まで鳴らす。
- `PlaySE(params)` は空いている SE チャンネルへ自動割り当てする。16 枠使用中は最古の再生を停止して新しい SE を鳴らす。
- 再生ハンドルを返すが、呼び出し側が保持せずに鳴らす使い方を可能にする。
- 再生終了時に内部の再生ハンドル管理を解放し、チャンネルを空きに戻す。
- 保持した再生ハンドルを指定した途中停止にも対応する。

```ts
SoundManager.PlaySE({ id: "hit", volume: 1.0 });

const se = SoundManager.PlaySE({ id: "explosion" });
SoundManager.StopSE(se);
```

ここでいうハンドルの解放は内部管理からの除去を意味する。呼び出し側が保持する JavaScript オブジェクトの参照を強制的に消去することはできない。音源キャッシュの破棄とは区別する。

### SYSTEM SE

- ゲーム世界とは別の、アプリ側の効果音を通常 SE とは独立した 4 枠で管理する。
- `PlaySystemSE` / `StopSystemSE` を用いる。空き枠へ自動割り当てし、ワンショット再生、終了時に枠を解放する。
- 満杯時は最古の再生を停止して新しい音を鳴らす。
- 初版はカタログの音源 ID を再生時に渡す。専用の番号付きスロット設定 API は置かない。

想定用途の例は決定、キャンセル、カーソル移動、通知など。

### リソースカタログとグループ管理

音源リソースを JSON 形式のカタログで登録し、グループ単位でプリロードする。カタログは音源定義 `resources` とグループ定義 `groups` を分離する。

```json
{
  "version": 1,
  "resources": {
    "ui-confirm": {
      "src": ["audio/ui/confirm.ogg", "audio/ui/confirm.mp3"]
    },
    "forest-bgm": {
      "src": ["audio/bgm/forest.ogg"]
    },
    "rain": {
      "src": ["audio/bgs/rain.ogg"]
    }
  },
  "groups": {
    "common": ["ui-confirm"],
    "forest": ["forest-bgm", "rain"],
    "rainy-town": ["rain"]
  }
}
```

- `version` はカタログ形式のバージョンを示す。初期形式は `1`。それ以外は登録時に拒否する。
- `resources` のキーを音源 ID とし、再生パラメーターの `id` から参照する。
- `src` は同一音源の形式別候補 URL の配列。同時再生する音源の一覧ではない。相対 URL は、`fetch` が返した `response.url` をカタログ JSON の URL として、その URL を基準に解決する（リダイレクト後の URL を含む）。
- `groups` のキーはグループ名、値は音源 ID の配列とする。同じ音源 ID を複数グループに所属させられる。グループ内の未知 ID は登録時に拒否する。
- 複数カタログを登録できる。音源 ID またはグループ名の重複はエラーとし、後勝ち上書きしない。
- グループは読み込み・解放の単位とし、再生区分とは分離する。1 グループに複数区分で使用する音源を含められる。
- 音量・パンなどの再生属性は、再生要求時に指定する。

### カタログ登録とプリロード

```ts
await SoundManager.LoadCatalog("audio/catalog.json");

await SoundManager.PreloadGroup("common");
await SoundManager.PreloadGroup("forest");

const bgm = SoundManager.PlayBGM(
  new BgmPlayAttributes({ id: "forest-bgm" })
);
```

- `LoadCatalog` は JSON を読み込んで音源定義とグループ定義を登録する。登録だけでは音源ファイルを読み込まない。
- `PreloadGroup` は指定グループの音源を読み込む。全対象の読み込み成功で返却 Promise が完了する。
- 失敗時は Promise を拒否し、失敗した音源 ID を呼び出し側が取得できる。成功した音源はロード済みのまま残す。再試行は `PreloadGroup` の再呼び出しとする。
- 同じ ID が読み込み済みなら再利用し、読み込み中なら同じ読み込み処理を共有する。グループが異なっても重複ロードしない。繰り返しプリロードは、済なら即成功、実行中なら Promise を共有する。
- 未ロード音源への再生要求はエラーとする。自動ロードしない。

### リソースの共有と解放

```ts
await SoundManager.UnloadGroup("forest");
```

- 音源リソース、再生ハンドル、チャンネルは別々に管理する。
- 再生終了によるハンドル・チャンネルの解放だけでは、ロード済み音源を破棄しない。
- `UnloadGroup(name)` は `Promise<void>` を返す。対象グループが未ロードでも成功する（冪等）。
- グループ解放時も、別のロード済みグループや再生中のハンドルが使用している音源は保持する。一時停止中の再生も使用中とみなす。
- ロード中に解放した場合、そのグループの保持を外す。他グループと再生が参照していなければ、ロード完了後に破棄し、完了後に発音しない。
- 保持が不要になった音源は、グループと再生の参照が無くなった時点で破棄する。

### エラー通知

- 同期の不正引数・未初期化・未知 ID・未ロード再生は例外とする。
- カタログ読み込み失敗とプリロード失敗は Promise 拒否とする。プリロード失敗では失敗した音源 ID を列挙できる公開型を使う。

### 音量・ミュート・一括停止

実効再生音量は、マスター音量 × 区分音量 × 当該再生の `volume` の積とする。いずれかのミュートが有効なら無音とする。

- マスターと、BGM / BGS / ME / SE / SYSTEM SE の区分ごとに音量・ミュートを持つ。
- SYSTEM SE の音量・ミュート・一括停止は通常 SE から独立する。
- `StopAll()` と区分別の `StopAllBGM` / `StopAllBGS` / `StopAllME` / `StopAllSE` / `StopAllSystemSE` を提供する。`StopAllSE` は SYSTEM SE を止めない。
- 初版の公開一時停止はハンドル単位の `Pause` / `Resume` のみとする。

```ts
SoundManager.SetMasterVolume(0.8);
SoundManager.SetMasterMute(false);
SoundManager.SetCategoryVolume(SoundCategory.BGM, 0.5);
SoundManager.SetCategoryMute(SoundCategory.SE, true);
```

| メソッド | 意味 |
| --- | --- |
| `SetMasterVolume` / `GetMasterVolume` | マスター音量 `0.0`〜`1.0`。範囲外は例外。初期値 `1.0` |
| `SetMasterMute` / `IsMasterMute` | マスターミュート。初期値 `false` |
| `SetCategoryVolume` / `GetCategoryVolume` | 区分音量。初期値 `1.0` |
| `SetCategoryMute` / `IsCategoryMute` | 区分ミュート。初期値 `false` |

変更は再生中の音にも即時反映する。

### 自動再生制限

ブラウザーではユーザー操作のあとに AudioContext を再開する。`SoundManager.UnlockAudio()` は `Promise<void>` を返し、許可後に完了する。デモは最初のボタン操作で Initialize と UnlockAudio を行う。

### 配布形式

パッケージ管理には bun を使用する。初版の公開パッケージは ESM と型定義（`dist/`）とし、実行時依存には Howler.js 2.2.4 を使用する。

## 初版の対象外・将来拡張

- CommonJS 配布。
- プリロード進捗のコールバック。
- 個別音源単位のロード・解放 API。
- 実行中のチャンネル数変更と再初期化。
- 公開の区分一括 Pause/Resume。
- BGS 以外のチャンネル番号指定操作。
- BGM の複数曲同時再生（クロスフェード以外）。枠の持ち方は拡張可能な構造までとする。

`resetForTesting` などのテスト用フックと、`AudioBackend`、`FakeAudioBackend`、`HowlerBackend` などの内部 backend は、ゲーム向け公開 API ではない。

## 確認環境と未検証事項

Chromium 系（Cursor IDE 内蔵ブラウザー）でデモの操作を確認済みである。Howler のロード・再生 API が例外なく完了し、UI 上の状態が更新されることを確認した。自動操作環境のため、スピーカーからの実音は聴取確認していない。

Safari、Firefox、実機モバイルブラウザーは未検証である。詳細は [ブラウザー確認記録](browser-verification.md) を参照する。

## 参考

RMMZの標準音声区分はBGM・BGS・ME・SE。本プロジェクトではSYSTEM SEを独立した管理区分として追加する。

- [RPG Maker MZ公式ヘルプ：音声ツール](https://rpgmakerofficial.com/product/MZ_help-en/01_05.html)
- [RPG Maker MZ公式ヘルプ：音声・動画イベントコマンド](https://rpgmakerofficial.com/product/MZ_help-en/01_10_11.html)
- [Howler.js公式ドキュメント](https://github.com/goldfire/howler.js#documentation)
