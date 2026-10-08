# 内蔵音源の記録

2026-10-09、プロジェクト所有者から「JAEIS音源も公開同梱してよい（権利確認済み）」との確認を得て、次の3素材を同梱しました。JAEISポッドキャスト制作で共有された音源です。出演者の収録音声・会話は含みません。

| 固定ID / ファイル | 提供された元ファイル | 変換後の長さ |
| --- | --- | --- |
| `jaeis-opening-v1` / `jaeis-opening-v1.wav` | `2026_オープニング.mp3` | 12.819841秒 |
| `jaeis-ending-v1` / `jaeis-ending-v1.wav` | `2026_エンディング.mp3` | 13.080340秒 |
| `jaeis-jingle-v1` / `jaeis-jingle-v1.wav` | `JAEIS_ジングル.wav` | 3.834376秒 |

FFmpegで44.1 kHz・ステレオ・16bit PCM WAVへ変換し、ファイルのメタデータを除去しました。切り詰め・音量正規化はしていません。ブラウザ間のMP3デコード差を避け、保存した挿入時刻を再現するためWAVを採用しています。元ファイルは変更していません。

この記録は、本アプリへの公開同梱の承認記録です。音源をソフトウェアのライセンスやCreative Commonsとして再許諾するものではありません。

標準BGM `studio-calm-v1` は本アプリ用のオリジナル合成音です。外部の録音・サンプル・生成AIを使わず、`src/music-synthesis.ts` で16秒の音を端末内で作ります。JAEISの共有BGMではありません。

## 更新時の注意

同じIDの音を差し替えないでください。音源を更新するときは `v2` などの新しいIDとファイルを追加し、既存のIDは以前の編集ファイルを復元するため維持します。出所・許諾確認のない音声をこのフォルダに置かないでください。

SHA-256:

```text
4c21d43e082e5f807062cfcf620c9c7e49f33c8d28e580ea642bb1dd2baf7941  jaeis-opening-v1.wav
0b35b43947d3dd9fb47dbfa03d781a12b078cb0e746cd11f7ba785d8f893a291  jaeis-ending-v1.wav
5fce6f673f5eb6048a049bb71c3ce9e824e1ef8a88eee96cbb74ddbb02626d26  jaeis-jingle-v1.wav
```
