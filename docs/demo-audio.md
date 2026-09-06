# デモ音源の生成方法

デモ用の WAV ファイルは第三者素材を使わず、短い正弦波をスクリプトで生成しています。

## 生成コマンド

```bash
bun run generate-demo-audio
```

`demo/audio/` 配下に以下のファイルが出力されます。

| ファイル | 用途 | 周波数 | 長さ |
| --- | --- | --- | --- |
| `demo-bgm.wav` | BGM | 440 Hz | 2.0 秒 |
| `demo-bgs.wav` | BGS | 220 Hz | 1.5 秒 |
| `demo-me.wav` | ME | 880 Hz | 0.8 秒 |
| `demo-se.wav` | SE | 660 Hz | 0.25 秒 |
| `demo-system-se.wav` | SYSTEM SE | 550 Hz | 0.2 秒 |

## スクリプト

生成ロジックは [`scripts/generate-demo-audio.ts`](../scripts/generate-demo-audio.ts) にあります。

- モノラル 16-bit PCM WAV
- サンプルレート 44100 Hz
- 振幅は音源ごとに 0.2〜0.35（クリッピング回避のため最大 1 未満）

再生成してもカタログ ID（`demo-bgm` など）は変わりません。

## デモでの確認

生成後に `bun run demo` を実行し、`http://localhost:5173/` を開きます。最初に「Initialize + UnlockAudio」を操作し、必要なグループをプリロードしてから各音源を再生します。

Chromium 系で操作完了と UI 状態を確認済みです。スピーカーによる実音の聴取は未確認です。
