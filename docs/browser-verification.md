# ブラウザー確認記録

更新日: 2026-09-06

## 確認済み

| 項目 | 結果 |
| --- | --- |
| 環境 | Chromium 系（Cursor IDE 内蔵ブラウザー） |
| デモ | `bun run demo` → `http://localhost:5173/` |
| Initialize + UnlockAudio | ユーザー操作後に完了 |
| LoadCatalog + Preload common | 成功（相対 URL は `response.url` 基準） |
| Preload forest | 成功 |
| Play SE / SYSTEM SE / BGM / BGS / ME | UI 状態が再生中になり、例外なし |
| Stop BGM / StopAll | 成功 |
| Master mute | UI から設定可能 |
| UnloadGroup forest | 操作可能（再生中の保持は仕様どおり） |

実際のスピーカー出力は自動操作環境では聴取確認していない。Howler のロード・再生 API が例外なく完了し、UI 上の状態が更新されることを確認した。実音、パン、音量差、BGM クロスフェードの聴感は本記録の確認対象に含めない。

## 未検証

- Safari
- Firefox
- 実機モバイルブラウザー
- スピーカーによる実音の聴取
