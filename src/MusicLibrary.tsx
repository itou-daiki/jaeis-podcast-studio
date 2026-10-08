import { Check, Pause, Play, Plus } from "lucide-react";
import { builtInMusic } from "./music-catalog";
import type { MusicClip } from "./types";

export function MusicLibrary({
  music,
  pendingSource,
  previewing,
  onPreview,
  onAdd,
}: {
  music: MusicClip[];
  pendingSource?: MusicClip;
  previewing?: string;
  onPreview: (id: string) => void;
  onAdd: (id: string, forScript?: boolean) => void;
}) {
  return (
    <details className="music-library" open>
      <summary>内蔵音源から選ぶ</summary>
      <p className="hint">
        アップロード不要。まず試聴し、使いたい音を追加してください。
      </p>
      <ul className="music-library-list">
        {builtInMusic.map((asset) => {
          const added =
            asset.role !== "jingle" &&
            music.some(
              (m) => m.builtinId === asset.id && m.role === asset.role,
            );
          const prepared = pendingSource?.builtinId === asset.id;
          const label =
            asset.role === "jingle"
              ? "今の位置に挿入"
              : asset.role === "bgm" && music.some((m) => m.role === "bgm")
                ? "BGMを入れ替える"
                : "追加";
          return (
            <li key={asset.id}>
              <strong>{asset.name}</strong>
              <small>
                {asset.description} · {asset.seconds.toFixed(1)}秒
                {asset.role === "bgm" ? "ループ" : ""}
              </small>
              <div className="music-library-actions">
                <button
                  className="secondary"
                  aria-label={`${asset.name}を${previewing === asset.id ? "試聴停止" : "試聴"}`}
                  aria-pressed={previewing === asset.id}
                  onClick={() => onPreview(asset.id)}
                >
                  {previewing === asset.id ? (
                    <Pause size={14} />
                  ) : (
                    <Play size={14} />
                  )}{" "}
                  {previewing === asset.id ? "停止" : "試聴"}
                </button>
                <button
                  className="secondary"
                  disabled={added}
                  aria-label={`${asset.name}を${added ? "追加済み" : label}`}
                  onClick={() => onAdd(asset.id)}
                >
                  {added ? <Check size={14} /> : <Plus size={14} />}{" "}
                  {added ? "追加済み" : label}
                </button>
              </div>
              {asset.role === "jingle" ? (
                <button
                  className="secondary full"
                  disabled={prepared}
                  onClick={() => onAdd(asset.id, true)}
                >
                  {prepared ? "原稿用に準備済み" : "原稿に合わせて使う"}
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
      <p className="hint">
        JAEISの3音源は公開同梱の許可を確認済みです。標準BGMはアプリ用の合成音です。原稿用ジングルは、配置するまでは音声に入りません。
      </p>
    </details>
  );
}
