import { MAX_SCRIPT_LENGTH } from "./speakers";

export async function readScriptFile(
  name: string,
  bytes: ArrayBuffer,
): Promise<string> {
  if (bytes.byteLength > 10_000_000)
    throw new Error("原稿ファイルは10 MBまでです。");
  let text: string;
  if (/\.docx$/i.test(name)) {
    // Extract plain text only. Never insert converted Word HTML into the page.
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ arrayBuffer: bytes });
    text = result.value;
  } else if (/\.(txt|md)$/i.test(name)) {
    const view = new Uint8Array(bytes);
    if (view[0] === 0xff && view[1] === 0xfe)
      text = new TextDecoder("utf-16le").decode(bytes);
    else if (view[0] === 0xfe && view[1] === 0xff)
      text = new TextDecoder("utf-16be").decode(bytes);
    else {
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        text = new TextDecoder("shift_jis", { fatal: true }).decode(bytes);
      }
    }
  } else
    throw new Error(
      "Wordは.docx形式で保存してください。.txt・.md、または貼り付けにも対応しています。",
    );
  text = text.replace(/^\uFEFF/, "").trim();
  if (!text)
    throw new Error(
      "原稿の本文を読み取れませんでした。文字のある原稿を選ぶか、本文を貼り付けてください。",
    );
  if (text.length > MAX_SCRIPT_LENGTH)
    throw new Error("原稿は10万文字までです。今回の収録分に分けてください。");
  return text;
}
