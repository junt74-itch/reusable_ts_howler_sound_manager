# 実装進捗

更新日: 2026-09-06

## 運用確認

| 項目 | 結果 |
| --- | --- |
| 進行管理 | Cursor Grok 4.6（本セッション） |
| 実装サブエージェント | Cursor Compose 2.5（コード）。ドキュメントは GPT-5.6 Sol medium（`gpt-5.6-sol-medium`） |
| 委譲 | 利用可能なモデル一覧に `composer-2.5` があり、工程ごとに1体へ委譲する |
| 既存変更 | 開始時点で `README.md` の未コミット変更と未追跡の `docs/` を保持する。公開・push・コミットは依頼があるまで行わない |

本ファイルは進行管理の記録である。実装者の完了報告だけで工程を完了としない。

## タスク

| ID | 状態 | 担当 | 依存 | 変更箇所 | 検証結果 | 未解決事項 |
| --- | --- | --- | --- | --- | --- | --- |
| P0 | 完了 | Compose2.5 | なし | package.json, bun.lock, tsconfig*, vitest.config.ts, src/*, tests/placeholder.test.ts, .gitignore, README 追記。package-lock.json 削除 | bun 1.3.3 で typecheck / build / test 成功（進行管理が再実行） | なし |
| P1 | 完了 | Compose2.5 | P0・D1 | src 公開型・属性・ハンドル・ChannelPool・AudioBackend・SoundManager、tests 4ファイル | bun typecheck / build / test 16件成功のち P2 で増加 | — |
| P2 | 完了 | Compose2.5 | P1・D2 | catalog.ts, resource-store.ts, LoadCatalog/Preload/Unload、再生前検査、tests/resource-management.test.ts | bun typecheck / build / test 33件成功。未ロード再生は割当前にエラー | — |
| P3 | 完了 | Compose2.5 | P2 | howler-backend.ts、AudioBackend 終了/失敗通知、SoundManager ライフサイクル、playback-lifecycle / howler-backend テスト | bun typecheck / build / test 47件成功。終了で枠解放、古いイベント無視、ロード失敗の再試行を確認 | 実発音は P7 |
| P4 | 完了 | Compose2.5 | P3・D3 | FakeAudioBackend の無限ループ emitEnd 抑止、tests/category-se-bgs.test.ts | bun typecheck / build / test 65件成功。SE/SYSTEM SE 独立、BGS 指定再生・停止を確認 | — |
| P5 | 完了 | Compose2.5 | P4・D4 | sound-manager BGM クロスフェード、AudioBackend onFadeComplete、Howler fade イベント、tests/bgm-crossfade.test.ts | bun typecheck / build / test 75件成功。初曲即再生、2曲目クロスフェード、0秒即時切替、フェード中断、片側停止を確認 | — |
| P6 | 完了 | Compose2.5 | P5・D5 | sound-manager ME トランザクションと BGM 連動 pause/resume、tests/me-bgm.test.ts | bun typecheck / build / test 86件成功。1枠置き換え中の誤再開なし、2枠は両方終了まで停止、ユーザー Pause は再開しない | — |
| P7 | 完了 | Compose2.5 | P6・D6 | ミキサー API、UnlockAudio、Vite デモ、README、demo-audio.md。相対カタログ URL は response.url 基準 | bun test 97件成功。Chromium デモでプリロードから各区分再生・停止まで確認。Safari/Firefox 未検証 | 実スピーカー聴取は未確認 |
| P8 | 完了 | Compose2.5（公開面） / GPT-5.6 Sol medium（文書） | P7 | index 公開面の限定、NotImplementedError 削除、README・仕様・確認記録の整合 | bun typecheck / build / test 97件成功。package.json exports は `dist/index` のみ。Safari/Firefox/実音聴取は未検証のまま文書化 | 公開・push は対象外 |

## 仕様判断

ゲーム側から見える選択は、推奨案を提示してユーザー判断を待つ。内部構成は進行管理が決め、理由をここに書く。

| 判断ID | 状態 | 決定内容 | 根拠 | 関連タスク |
| --- | --- | --- | --- | --- |
| I1 | 決定（修正） | パッケージ管理と検証コマンドは bun。公開パッケージは TypeScript ソースから ESM をビルドする。テストランナーは Vitest を `bun run test` で実行する。Howler.js は実行時依存。npm / package-lock.json は使わない | ユーザー指示（2026-09-06）で npm ではなく bun を採用 | P0 |
| I2 | 決定 | 音源ID・公開再生ハンドル・Howler 内部再生ID・チャンネル番号を別識別子として扱う。Howler の内部プール設定を本ライブラリの同時再生数にしない | 基本仕様と実装計画の推奨内部構成 | P1 以降 |
| I5 | 決定 | ME 連動で pause した BGM ハンドルだけを再開する。ユーザーが先に Pause した BGM は触らない。ME 置き換え（旧停止→新開始）の途中では再開しない。ME 再生中の新規 BGM は開始直後に内部 Pause する | D5 と I3。誤再開を防ぐ | P6 |
| I7 | 決定 | パッケージ公開エントリはゲーム向け API（SoundManager、属性、ハンドル、区分/状態、InitOptions、エラー）に限定する。AudioBackend / FakeAudioBackend / HowlerBackend / ChannelPool は index から外す。未使用の NotImplementedError は公開しない | P8 の公開面整理。テストは内部モジュールから import する | P8 |
| I8 | 決定 | グループプリロードは開始時に保持を付け、Unload で要求世代を無効化する。解放済み要求は完了時にグループを復活させない。再生置き換えは音源を一時ピンしてから旧再生を解放する。フェードは envelope とミキサー音量を分離する。Howler の end/playerror/fade タイマーは終端で解除する | レビュー指摘 4 件（同時プリロード中の解放、置き換え時 unload、volume による fade 中断、リスナー蓄積） | P8 後 |
| D1 | 決定 | 明示 `Initialize`、静的 API。volume 0〜1、pan −1〜1、loop は BGM/BGS 既定 −1・ME 既定 0、SE/SYSTEM SE に loop なし。位置は秒。チャンネルは 0 始まり。ハンドルは再生要求単位。終端 Stop は no-op。同期不正は例外、非同期失敗は Promise 拒否 | ユーザーが推奨案の採用を指示（2026-09-06） | P1 |
| D2 | 決定 | 相対 URL はカタログ基準。形式検証と未知 ID は登録時拒否。重複 ID/グループ名はエラー。プリロード共有。部分失敗は拒否しつつ成功分は残す。未ロード再生はエラー。`UnloadGroup` は冪等。ロード中解放は保持解除し完了後に発音しない | 同上 | P2 |
| D3 | 決定 | BGS は指定枠置き換え。SE/SYSTEM SE は自動割り当てワンショット、満杯は最古停止。SYSTEM SE は再生時にカタログ ID を渡す | 同上 | P4 |
| D4 | 決定 | `fadeSeconds` 既定 1。フェード中再要求は打ち切って新規クロスフェード。同じ曲も新規再生。リピートは先頭へ戻る。ハンドル停止はその側のみ | 同上 | P5 |
| D5 | 決定 | ME 同時再生数の既定 1。満杯は最古停止。既定で ME 中は BGM を内部一時停止。`pauseBgmDuringMe: false` で無効化 | 同上 | P6 |
| D6 | 決定 | マスター＋区分音量/ミュート（SYSTEM SE は独立）。`StopAll` と区分別一括停止。`StopAllSE` は SYSTEM SE を含めない。配布は ESM + 型定義。デモ必須確認は Chromium 系 | 同上 | P7 |

確定内容は基本仕様へ反映済み。以下の「推奨案」表は決定時の原文である。

### D1 推奨案（決定済み）

| 項目 | 推奨 | 代替 | 影響 |
| --- | --- | --- | --- |
| 初期化 | `SoundManager.Initialize(options?)` を先に呼ぶ。未初期化の再生・ロードはエラー | 初回 API で暗黙初期化 | 明示初期化はテストと ME 同時再生数の設定がしやすい |
| 公開面 | 仕様例どおり静的メソッド | インスタンスを返すファクトリ | ゲーム側の記述が仕様例と一致する |
| volume | `0.0`〜`1.0`、範囲外はエラー、デフォルト `1.0` | クランプ | 不正値を隠さない |
| pan | `-1.0`〜`1.0`（左〜右）、デフォルト `0.0` | `0.0`〜`1.0` | 仕様例の `pan: 0.5` は右寄りになる |
| loop | `-1` 無限、`0` 追加リピートなし、正の整数は追加回数。BGM/BGS デフォルト `-1`、ME/SE/SYSTEM SE は `0`。SE/SYSTEM SE の属性に loop は出さない | 全区分で loop を共通化 | ワンショット区分の誤ループを防ぐ |
| 位置 | `initialAudioPosition` は秒、デフォルト `0` | ミリ秒 | Howler の seek と揃えやすい |
| チャンネル番号 | 0始まり。BGM は `0..n-1`、BGS は `0..3` | 1始まり | 仕様の仮表記と一致 |
| ハンドル | 再生要求を識別するオブジェクト。`soundId` / `category` / `channel` / `state` を参照可能。終端は `stopped` / `ended` / `error`。終端への Stop は何もしない | チャンネル番号をハンドル代わりにする | チャンネル再利用時の誤操作を防げる |
| エラー | 同期の不正引数は例外。カタログ・プリロード失敗は Promise 拒否。失敗音源IDを列挙できる型を公開する | コールバックのみ | 仕様の `await` 例と一致する |

### D2 推奨案（決定済み）

| 項目 | 推奨 | 代替 | 影響 |
| --- | --- | --- | --- |
| URL 基準 | カタログ JSON の URL を基準に `src` の相対パスを解決する | アプリの document 基準 | カタログを `audio/` 配下に置ける |
| 検証 | `version === 1`、resources/groups の形、グループ内の未知 ID は登録時に拒否 | 緩い検証 | 実行時の未知 ID 再生より早く失敗する |
| 複数カタログ | 音源 ID・グループ名の重複はエラー | 後勝ち上書き | 意図しない差し替えを防ぐ |
| 繰り返しプリロード | 済なら即成功、実行中なら Promise 共有 | 毎回再フェッチ | 仕様の共有要求に一致 |
| 繰り返し解放 | 未ロードなら何もしない（冪等） | エラー | シーン遷移で扱いやすい |
| 部分失敗 | Promise 拒否。失敗 ID を列挙。成功分はロード済みのまま残す。再試行は `PreloadGroup` 再呼び出し | 全ロールバック | 共通音が落ちてもステージ音だけやり直せる |
| ロード中の解放 | そのグループの保持を外す。他グループと再生が参照していなければロード完了後に破棄。完了後に発音しない | 解放をロード完了まで遅延 | 遷移中の遅延発音を防ぐ |
| 未ロード再生 | エラー（自動ロードしない） | 再生時に自動ロード | 明示プリロード運用と一致。ロード待ち停止後の誤発音も起きない |

解放 API 名は `UnloadGroup(name)`、戻りは `Promise<void>` を推奨する。

### D3 推奨案（決定済み）

| 項目 | 推奨 |
| --- | --- |
| BGS | 指定チャンネルの既存音を停止して置き換え。ループデフォルトは無限 |
| SE 満杯 | 最古の再生を停止して新しい SE を鳴らす |
| SYSTEM SE | `PlaySystemSE` / `StopSystemSE`。空き枠へ自動割り当て、ワンショット、終了で枠解放。満杯は最古停止 |
| SYSTEM SE 設定 | 初版は音源カタログ ID を再生時に渡すだけ。専用の番号付きスロット API は作らない |

### D4 推奨案（決定済み）

| 項目 | 推奨 |
| --- | --- |
| フェード | `PlayBGM` の属性に `fadeSeconds`（デフォルト `1`）。`0` は即時切り替え |
| フェード中の再要求 | 進行中フェードを打ち切り、空き枠（または先に空ける枠）で新しいクロスフェードを開始 |
| 同じ曲の再要求 | 新しい再生として扱い、クロスフェードする（no-op にしない） |
| 初期位置とループ | D1 どおり。リピート時は先頭へ戻る（`initialAudioPosition` は初回のみ） |
| フェード対象の停止 | そのハンドル側だけ停止。相手側のフェードは継続 |

### D5 推奨案（決定済み）

| 項目 | 推奨 |
| --- | --- |
| 初期同時再生数 | `1`（`Initialize` で変更可。実行中変更は初版対象外） |
| 満杯 | 最古の ME を停止して新規を鳴らす |
| BGM 連動 | 既定で有効。最初の ME 開始で BGM を一時停止し、ME が 0 件になったら再開。置き換え途中では再開しない。`Initialize({ pauseBgmDuringMe: false })` で無効化 |

### D6 推奨案（決定済み）

| 項目 | 推奨 |
| --- | --- |
| 音量 | マスター + 区分（BGM/BGS/ME/SE/SYSTEM SE は独立）+ 再生ごとの volume。実効音量は積 |
| ミュート | マスターと区分ミュート。SYSTEM SE は SE と独立 |
| 一括停止 | `StopAll()` と区分別 `StopAllBGM` 等。SYSTEM SE は `StopAllSE` に含めない |
| 一時停止 | ハンドル単位の `Pause` / `Resume`。区分一括は初版に `PauseAllBGM` 程度を置くかは実装時に必要なら追加 |
| ブラウザー | デモは Chromium 系で必須確認。Safari / Firefox は確認できれば記録し、未検証なら明記 |
| 配布 | ESM + 型定義（`dist/`）。CJS は初版対象外 |

## 工程メモ

### P0

- 2026-09-06: 作業ツリー確認。`README.md` 変更と `docs/` 未追跡。実装ファイルは未作成。Compose2.5 へ基盤構築を委譲。
- 2026-09-06: レビュー。ESM + Vitest + Howler 2.2.4 / `@types/howler` 2.2.13。公開 API は空の `SoundManager` のみ。`docs/` は保持。当初は npm で typecheck / build / test が成功。
- 2026-09-06: ユーザー指示によりパッケージ管理を bun へ変更。`package-lock.json` 削除、`bun.lock` 追加、`packageManager` は `bun@1.3.3`。README の開発コマンドを bun に更新。進行管理が `bun run typecheck` / `build` / `test` を再実行し成功。P0 を再完了。

### 次工程

- 2026-09-06: ユーザー指示により D1〜D6 を推奨案どおり確定。基本仕様へ反映。I3（公開一括 Pause なし）を追加。P1 を Compose2.5 へ委譲。
- 2026-09-06: P1 レビュー。仕様 API 例が型検査可能。ハンドルとチャンネルを区別。ChannelPool の割当・解放・最古奪取を確認。`bun run typecheck` / `build` / `test`（16件）成功。受け入れ。カタログ本実装は P2。

### P1

- 公開静的 API、属性検証、PlaybackHandle、FakeAudioBackend、ChannelPool、PlaybackRegistry。
- LoadCatalog / PreloadGroup / UnloadGroup は未初期化チェック後に NotImplementedError（P2 で置換）。

### P2

- 2026-09-06: D2 確定済みのため Compose2.5 へ委譲。
- 2026-09-06: 初回実装後、カタログ未登録時の再生許可と割当後検査を指摘。修正後に再検証し受け入れ。次は P3（Howler 連携）。

### P3

- 2026-09-06: ユーザー指示により P3 へ進む。Compose2.5 へ委譲。
- 2026-09-06: レビュー。Play→終了で ended とチャンネル解放、Stop 後の遅延 end が新再生に影響しないこと、終了後 UnloadGroup で破棄できることを確認。HowlerBackend の load 失敗が map に残る点を修正させた。再検証 47 件成功。受け入れ。次は P4（SE・SYSTEM SE・BGS）。

### P4

- 2026-09-06: ユーザー指示により P4 へ進む。Compose2.5 へ委譲。枠の骨格は P1〜P3 にあるため、D3 の区分規則と受け入れテストを完成させる。
- 2026-09-06: レビュー。SE 終了で枠復帰、SYSTEM SE 4枠独立、BGS 4同時・同一枠置き換え・番号/ハンドル停止、StopAllSE が SYSTEM SE を止めないことを確認。Fake の loop -1 は Howler と同様に ended しない。受け入れ。次は P5（BGM クロスフェード）。

### P5

- 2026-09-06: ユーザー指示により P5 へ進む。I4（A/B 固定にしない、最初の1曲は即開始）を追加して Compose2.5 へ委譲。
- 2026-09-06: レビュー。ChannelPool の空き枠探索を使い A/B 専用にしていない。未ロード検査は切替より前。フェード完了で outgoing を stopped。受け入れ。次は P6（ME と BGM 連動）。

### P6

- 2026-09-06: ユーザー指示により P6 へ進む。I5 を追加して Compose2.5 へ委譲。
- 2026-09-06: レビュー。ME 置き換え中は BGM を再開しない。Stop/終了/失敗/StopAllME で最後の ME が消えたら連動 pause した BGM だけ再開。PauseAllBGM は非公開。受け入れ。次は P7（音量・デモ・ブラウザー）。

### P7

- 2026-09-06: ユーザー指示により P7 へ進む。I6 と仕様の音量/`UnlockAudio` を反映して Compose2.5 へ委譲。ブラウザー確認は進行管理が行う。
- 2026-09-06: 初回デモで相対 `LoadCatalog("/catalog.json")` が `sound-manager.local` に落ち、プリロードが沈黙失敗。`response.url` 基準へ修正。Chromium で Initialize・common/forest プリロード・SE/SYSTEM SE/BGM/BGS/ME 再生・停止・ミュートを再確認。受け入れ。次は P8。

### P8

- 2026-09-06: ユーザー指示により P8 へ進む。コード公開面は Compose2.5、ドキュメントは GPT-5.6 Sol medium。I7（公開エントリの限定）を追加。
- 2026-09-06: 公開 `index.ts` から AudioBackend / Fake / HowlerBackend / ChannelPool を除外。テストは内部 import。仕様・README を実装済み API に合わせ、対象外と未検証を分離。進行管理が `bun run typecheck && bun run build && bun run test`（97件）を再実行して受け入れ。P0〜P8 完了。
- 2026-09-06: レビュー指摘 4 件を修正（I8）。グループ保持の世代管理、置き換え時のリソースピン、フェード envelope とミキサー分離、Howler リスナー解除。`bun run typecheck && bun run build && bun run test` 104件成功。実音・聴感は未確認。
- 2026-09-06: 残件 2。ロード完了時に参照を再確認して破棄判定。クロスフェード再要求でも abort 前から新再生登録まで retain。
