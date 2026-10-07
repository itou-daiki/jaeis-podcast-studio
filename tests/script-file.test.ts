import { expect, test, vi } from "vitest";
import JSZip from "jszip";
import { readScriptFile } from "../src/script-file";

// Node uses Buffer input; the browser worker uses ArrayBuffer. The actual DOCX
// parser is exercised here, with only that environment adapter replaced.
vi.mock("mammoth", async (original) => {
  const real = await original<typeof import("mammoth")>();
  return {
    extractRawText: ({ arrayBuffer }: { arrayBuffer: ArrayBuffer }) =>
      real.extractRawText({ buffer: Buffer.from(arrayBuffer) }),
  };
});

test("Word paragraphs and table cells retain speaker headings, comments are not read as speech", async () => {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  zip.file(
    "word/document.xml",
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>【田中先生】</w:t></w:r><w:commentRangeStart w:id="0"/></w:p><w:p><w:r><w:t>スライドを公開しています。</w:t></w:r><w:r><w:commentReference w:id="0"/></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>佐藤先生：</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>学び方を選べる環境を作ります。</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>`,
  );
  zip.file(
    "word/comments.xml",
    '<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:comment w:id="0"><w:p><w:r><w:t>これは編集者への指示です。</w:t></w:r></w:p></w:comment></w:comments>',
  );
  const text = await readScriptFile(
    "test.docx",
    await zip.generateAsync({ type: "arraybuffer" }),
  );
  expect(text).toContain("【田中先生】");
  expect(text).toContain("佐藤先生：");
  expect(text).not.toContain("これは編集者への指示です");
});

test("text handles UTF-8 and rejects unsupported Word and empty files", async () => {
  const buffer = new TextEncoder().encode(
    "【田中先生】\n授業の原稿です。",
  ).buffer;
  expect(await readScriptFile("script.txt", buffer)).toBe(
    "【田中先生】\n授業の原稿です。",
  );
  await expect(readScriptFile("old.doc", buffer)).rejects.toThrow(/docx/);
  await expect(
    readScriptFile("empty.txt", new ArrayBuffer(0)),
  ).rejects.toThrow();
  await expect(
    readScriptFile(
      "large.txt",
      new TextEncoder().encode("a".repeat(100001)).buffer,
    ),
  ).rejects.toThrow();
});
