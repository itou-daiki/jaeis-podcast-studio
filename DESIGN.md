---
name: JAEIS Podcast Studio
description: 現行の音声編集画面から抽出した、手順と試聴を中心にしたデザインシステム。
colors:
  indigo: "#3444a5"
  teal: "#177f79"
  ink: "#25324b"
  muted: "#59677d"
  line: "#e2e6ef"
  canvas: "#f3f5f9"
  surface: "#fff"
  transport: "#27344f"
  recovery: "#edf1fc"
  focus: "#8794ee"
  warning-bg: "#fff3df"
  warning-ink: "#80541a"
  error-bg: "#fff9f7"
  error-ink: "#a24038"
typography:
  body:
    fontFamily: '"Hiragino Kaku Gothic ProN", "BIZ UDPGothic", "Yu Gothic", system-ui, sans-serif'
    fontSize: "14px"
  brand:
    fontFamily: '"Avenir Next", system-ui, sans-serif'
    fontSize: "19px"
    letterSpacing: "-0.5px"
  title:
    fontSize: "21px"
    fontWeight: 700
    letterSpacing: "-0.03em"
  section:
    fontSize: "14px"
    fontWeight: 700
  label:
    fontSize: "13px"
  hint:
    fontSize: "12px"
    lineHeight: 1.85
  time:
    fontFamily: 'ui-monospace, "SFMono-Regular", monospace'
    fontSize: "20px"
    letterSpacing: "-0.02em"
rounded:
  compact: "4px"
  icon: "5px"
  field: "6px"
  button: "7px"
  banner: "8px"
  toast: "9px"
  panel: "12px"
  modal: "13px"
spacing:
  inline: "8px"
  compact: "12px"
  section: "16px"
  panel: "18px"
  spacious: "20px"
components:
  button-primary:
    backgroundColor: "{colors.indigo}"
    textColor: "{colors.surface}"
    rounded: "{rounded.button}"
    padding: "11px 15px"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.button}"
    padding: "11px 15px"
  button-text:
    backgroundColor: "transparent"
    textColor: "{colors.indigo}"
    rounded: "0"
    padding: "6px 0"
  number-field:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.field}"
    padding: "7px"
    width: "80px"
  work-panel:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.panel}"
  workflow-step:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    padding: "14px 16px"
  workflow-step-current:
    backgroundColor: "transparent"
    textColor: "{colors.indigo}"
    padding: "14px 16px"
---

# Design System: JAEIS Podcast Studio

## Overview

校務の合間に音声編集を担当する先生が、現在の作業と次の操作を見分けられる画面。白い作業面、寒色の淡い背景、インディゴの操作色を基調とし、波形と試聴操作を中心に据える。情報のまとまりは境界線と余白で示す。

これは `src/style.css`、`src/App.tsx`、`src/Workflow.tsx` と既存の完成画面から抽出した現行実装の記録である。利用者像は `PRODUCT.md` の確認済み前提に基づく。新たな美的承認、比喩、ユーザー調査結果は含まない。

**Key Characteristics:**

- 日本語の操作名と番号で手順を示す。
- 波形の作業面と、その工程に必要な詳細操作を分ける。
- 状態は文字、下線、形状を伴って示し、色だけに依存しない。

## Colors

インディゴとティールを、青みのあるニュートラルで支える。正規値は上のトークンを参照する。

### Primary

`indigo` は主要ボタン、現在の工程、選択中タブ、操作リンク、チェックボックスに使用する。

### Secondary

`teal` は端末内処理の表示と通常通知のアイコンに使用する。話者の波形色はトラック固有の色であり、操作色とは別の役割を持つ。

### Neutral

`canvas` はページ背景、`surface` は作業面、`ink` は本文、`muted` は補足、`line` は区切り。`transport` は再生・時刻表示の濃色帯。`recovery` は前回の編集や必要素材の案内に使用する。

警告は淡い黄系、エラー通知は淡い赤系の背景と説明文を組み合わせる。フォーカスは専用の明るいインディゴで示す。

## Typography

本文は日本語ゴシックのシステムフォント。ブランド表記のみ Avenir Next 系、時刻・素材番号は等幅を使用する。Webフォントの読み込みはない。

エピソード名と空状態の見出しは `title`、セクション見出しは `section`、説明文は主に `hint`。本文全体を一律の倍率で拡大するタイプスケールはない。時刻や補助メタデータには小さい文字（9–11px）も残る。エピソード名は幅1200px以下で23px、ブランドは幅800px以下で16px、再生時刻は18pxになる。

## Layout

現行の編集画面は、上からブランドバー、エピソード名と保存操作、4工程ナビゲーション、作業領域の順。工程は「素材を読み込む」「不要な部分をカット」「音量・音楽を整える」「確認して書き出す」。これはこの編集画面の構成であり、別画面に一律に適用するテンプレートではない。

メイン領域は最大1740px、通常の余白は20px 28px 16px。デスクトップは伸縮する波形・再生領域と350pxの詳細領域を18px間隔で配置する。1500px以上では詳細370px／間隔22px、1200px以下では詳細325px／間隔14pxになる。

800px以下では1列、メイン左右余白14px、工程ナビゲーションは2列×2行。編集・音量・書き出し工程では詳細領域が波形の下に続く。素材工程では素材一覧が波形より先に並ぶ。再生帯、範囲指定、ボタン群は必要に応じて折り返す。

音声未読込時は詳細領域を表示せず、最大960pxの読込面に主要な素材選択ボタンを1つ置く。前回の編集がある場合はその上に再開案内を表示する。

## Elevation & Depth

常設の作業面は影を付けず、白い面と1pxの境界で分離する。影は主要ボタン、固定通知、ヘルプダイアログに限られる。主要ボタンは `0 2px 3px #273b8414`、通知は `0 8px 40px #26385820`、ダイアログは `0 25px 80px #13213e33`。ダイアログの背景は半透明色と3pxのぼかしを使用する。

## Shapes

作業領域は `panel`、通常ボタンは `button`、入力欄は `field` の角丸。タイムラインの上下は同じ作業面の一部として接続する。素材、候補、字幕、音楽の項目は主に横罫で区切り、個別の装飾カードにはしない。再生ボタンのみ円形（37px四方）。

## Components

### Buttons and fields

主要・副ボタンは最小高40px、太さ600。主要操作はインディゴ塗り、副操作は白地と境界線。テキストボタンは軽い試聴・補助操作に使用する。ホバーは明度0.96、無効時は不透明度0.4と操作不可カーソル。背景と文字色の遷移は0.15秒。リンク、入力、選択欄、ボタン、詳細の見出しには3pxのフォーカス輪郭と3pxの外側余白がある。

数値入力・選択欄は白地、1px境界、控えめな角丸。字幕欄は通常時に境界を透明にし、ホバーで表示する。スライダーとチェックボックスのアクセントは操作色に揃える。

### Navigation and detail panels

工程ナビゲーションは番号と動詞を組み合わせる。現在地は `aria-current="step"`、太字、3px下線で表示する。音声がない間と復元素材待ちの間は後続工程を無効にし、準備が整うと工程間を自由に移動できる。デスクトップの工程ボタンは最小高54px、800px以下では48px。

詳細領域は現在工程の操作を表示する作業パネル。カット工程内の候補／文字起こし切替は2px下線と `aria-pressed` で選択状態を示す。詳細条件は開閉できるネイティブの `details` に収める。最後の工程以外には次工程へのボタンがある。

### Timeline and transport

再生帯は通常70px高。元音声の現在時刻、編集後の試聴切替、書き出し時間を区別する。波形は各94px高、目盛は30px高。選択は半透明インディゴと縦線、確定したカットは赤系の斜線、再生位置は橙の線と菱形で表す。波形ドラッグに加え、開始・終了の数値入力で範囲を指定できる。カット前後の試聴とカット履歴の取消を同じ作業面に置く。

### Recovery, review, and feedback

再開案内は音声が自動保存されないことと、元素材の選び直しを明示する。素材照合中は必要な収録音声・音楽の名前を案内する。

書き出し工程は先頭からの試聴、3項目の確認メモ、未判断候補の注意、出力設定の順。確認チェックは書き出しの必須条件ではなく、音声編集が変わると解除される。未採用候補は音声に残る旨、書き出し後に出演者へ確認してもらう旨を表示する。

通常通知は `role="status"`、エラー通知は `role="alert"`。処理中は上部の進捗帯を表示し、作業領域の操作を無効にする。スピナーは1秒の線形回転。動きを減らす設定ではアニメーションと遷移を停止する。

## Do's and Don'ts

### Do

- Do 操作結果が分かる日本語と、現在の工程を示す番号・下線を維持する。
- Do 波形、再生、選択範囲を一つの作業面として扱い、詳細操作は工程に応じて表示する。
- Do 復元に必要な素材、保存の制約、未判断候補、出力条件を具体的な文章で示す。
- Do フォーカス表示、数値による範囲指定、折り返し、動きを減らす設定を維持する。

### Don't

- Don't 装飾用カードや無関係な指標を増やして作業領域を圧迫しない。
- Don't 自動提案を承認済みの編集として見せたり、確認メモを機械による公開承認として扱ったりしない。
- Don't この記録を新しい配色・比喩・利用者調査の承認と解釈しない。
