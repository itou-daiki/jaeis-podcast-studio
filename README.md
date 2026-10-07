# JAEIS Podcast Studio

JAEISポッドキャストの編集担当者向け、ブラウザ内で動く音声編集アプリです。
GitHub Pagesに静的ファイルだけを公開します。バックエンド、APIキー、音声のアップロードは不要です。

## 使い方

1. ZoomのMP4、M4A、MP3、WAVを読み込みます。混合音声と話者別ファイルは二重に重ねないでください。
2. 波形をドラッグ、または開始・終了の秒数を入力してカットします。全トラックが同じ元時刻でカットされ、取り消し・やり直しができます。
3. 「不要な部分をカット」の「文字起こし」で、日本語の文字起こし、またはZoom VTT / SRT / Whisper JSONを読み込みます。原稿は不要です。
4. 「カット候補」で長い静かな区間・明示的なやり直し・近接する類似発言を探します。候補は自動採用しません。波形の下でカット前・編集後を聞き比べ、履歴から各つなぎ目を試聴できます。
5. 使用許可のあるOP・ED・ジングルを追加します。音楽は会話に重ねず、前後・指定位置に挿入します。
6. 「確認して書き出す」で試聴・確認し、MP3（192 kbps）またはWAV（44.1 kHz / 16 bit / stereo）を書き出します。確認チェックは任意で、音声を編集すると解除されます。全体の音量調整は−16 LUFS目標の単一パス処理です。
7. カット・文字起こし・素材設定は、このブラウザのlocalStorageに最新1プロジェクトを自動保存します。音声は含みません。再開時は「前回の編集を再開」を押して、画面に表示される素材を選び直します。
8. 「編集を保存」で `.studio.json` をファイルにも保管できます。別のPCでは「編集ファイルを開く」を先に押し、案内に沿って声・音楽の素材を選びます。すべて揃うと編集を復元します。

## 編集者に合わせた画面構成

主利用者は「音声編集に不慣れで、校務の合間に輪番で担当する先生」（2026-10-08ユーザー確認済み）。未実施のユーザー調査を事実として扱わず、設計上の想定を `PRODUCT.md` に記録しています。

- 上部の4工程から自由に移動し、右側にその工程の操作だけを表示します。
- 常設の素材サイドバーをなくし、中央の波形と再生操作に幅を使います。
- 検出条件・書き出しの専門設定は、必要なときに展開します。
- 初回は読み込み操作に絞り、使えない再生操作や空の履歴を表示しません。
- 見栄えのための波形・キャッチコピー・重複した手順説明は削除しました。

## モデルとプライバシー

Transformers.js 4.3.1、Whisperの多言語ONNXモデルを使用します。すべて `q8` / WASM単一スレッドで動作し、WebGPUやcross-origin isolationを必須にしません。

| モデル | モデル本体の概算容量 | 用途 |
| --- | ---: | --- |
| [Whisper Tiny](https://huggingface.co/onnx-community/whisper-tiny) | 41 MB | 動作確認・軽負荷 |
| [Whisper Base](https://huggingface.co/onnx-community/whisper-base) | 77 MB | 初期選択、軽量な日本語文字起こし |
| [Whisper Small](https://huggingface.co/onnx-community/whisper-small) | 249 MB | 精度を優先して試す選択肢 |

容量は2026-10-08確認のencoderとmerged decoderの量子化モデル合計。設定・トークナイザー・推論エンジンは別途必要です。精度・速度は音声と端末に依存します。

- モデルは文字起こしボタンを押した時だけHugging Faceから取得します。モデル・トークナイザーはブラウザにキャッシュされる場合があります。
- ONNXとFFmpegの実行エンジンは同一サイトから取得します。第三者CDNへのコード依存を避けています。
- 音声・字幕・編集内容を送るAPIや解析サービスはありません。GitHub Pagesやモデル配信元へのアクセス自体は各提供元に記録され得ます。
- 非公開の素材・ジングル・文字起こし・プロジェクトファイルをGitに含めないでください。テスト用実音声も `output/` に置き、公開しません。
- 音声がない箇所でWhisperが発言を生成することがあります。人名や専門用語も確認が必要です。リテイク候補は判定結果ではなく、試聴用の提案です。

## 制限

- PC版Chrome / Edge推奨。モバイルやメモリの少ない端末での長時間編集は非推奨。
- 声は8トラックまで。1ファイル350 MB / 45分、読み込み後PCM合計850 MB、書き出しPCM650 MBまで。上限内でも端末によって処理できない場合があります。
- 音楽は20本、1本3分まで。BGMの重ね合わせ・ダッキングは未実装です。
- 話者別音声は同じ開始時刻として並べます。録音開始時刻が異なる場合は手動で位置を調整してください。位置変更や素材削除ではカット・字幕をリセットします。
- 話者の自動識別、意味理解によるリテイク確定、生成要約は未実装。文字起こしは検索・修正・候補検出・字幕保存に利用できます。
- 自動保存・編集ファイルは音声を含みません。元音声は保管してください。ブラウザのデータ消去・容量不足・利用制限で自動保存できない場合があります。共有PCでは他の利用者が保存済みの字幕等を参照できる場合があります。
- 自動保存は同じブラウザの最新1プロジェクトです。同時に複数のタブで別々の編集をせず、各エピソードの `.studio.json` を保存してください。操作デモは自動保存しません。再生位置・候補の判断・確認チェック・取り消し履歴は再開時に復元しません。
- 選択範囲を文字起こしした場合も字幕全体を置き換えます。現在の字幕を残したい場合は先に保存してください。
- 編集後SRTでは、カットやジングル挿入位置をまたぐ発言を省略します。単語時刻がないため、不正確な字幕を複製しないための仕様です。
- 再生と書き出しは同じ編集計画を使います。ただし音量の正規化とピーク保護は書き出し時のみです。つなぎ目には5ms、音楽の端には50msのフェードを入れます。

## 開発

Node.js 24を使用します。

```sh
npm ci
npm run dev
npm test
npm run build
npm run preview
```

ローカルURLは `http://127.0.0.1:5173/jaeis-podcast-studio/` です。

`scripts/vendor.mjs` がインストール済みパッケージから音声エンジンを `public/vendor/` にコピーします。生成物はGitに含めず、CIでも同じ処理を行います。

## GitHub Pages

リポジトリ Settings → Pages → Source を **GitHub Actions** にします。
`main` のpushで `.github/workflows/pages.yml` がテスト・型検査・ビルド後に公開します。PRでは検証だけ実行します。

公開先: <https://itou-daiki.github.io/jaeis-podcast-studio/>

`vite.config.ts` の `base` は `/jaeis-podcast-studio/`。別リポジトリ名や独自ドメインで使う場合はここを変更してください。

## 設計・検証

- `editing.ts`: 元時刻ベースの非破壊カット、音楽を含む共通の再生・出力計画。
- `media.ts`: ブラウザ内デコード、波形・RMS、再生、WAV。
- `conversion.ts`: 遅延読み込みのFFmpeg.wasm。MP4フォールバック、MP3、ラウドネス調整。
- `asr.worker.ts`: 明示起動・中止可能なブラウザ内Whisper。日本語指定、30秒分割・5秒重複。
- `transcript.ts`: 字幕、保守的なリテイク候補、編集時刻への変換。
- `project.ts`: バージョン付き編集ファイルの検証。

Vitest / fast-checkで、重複カットの正規化、元音声の分割不変条件、全トラックの同期、字幕の往復、候補の誤削除防止、プロジェクト保存、WAVヘッダーを検証します。

## 一次資料

- [GitHub Pages workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)
- [Vite deployment](https://vite.dev/guide/static-deploy.html#github-pages)
- [Web Audio decodeAudioData](https://developer.mozilla.org/en-US/docs/Web/API/BaseAudioContext/decodeAudioData)
- [Transformers.js](https://huggingface.co/docs/transformers.js)
- [FFmpeg.wasm usage](https://ffmpegwasm.netlify.app/docs/getting-started/usage/)
