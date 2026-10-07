import { mkdir, copyFile, readFile, writeFile } from "node:fs/promises";
// Same-origin, single-threaded WASM: no COOP/COEP headers needed on GitHub Pages.
await mkdir("public/vendor", { recursive: true });
for (const file of ["ffmpeg-core.js", "ffmpeg-core.wasm"]) {
  await copyFile(
    `node_modules/@ffmpeg/core/dist/esm/${file}`,
    `public/vendor/${file}`,
  );
}

// Notices for the lazily bundled Word parser and its browser dependencies.
const wordNotices = [];
for (const [pkg, file] of [
  ["mammoth", "LICENSE"],
  ["@xmldom/xmldom", "LICENSE"],
  ["base64-js", "LICENSE"],
  ["dingbat-to-unicode", "LICENSE"],
  ["jszip", "LICENSE.markdown"],
  ["lop", "LICENSE"],
  ["underscore", "LICENSE"],
  ["xmlbuilder", "LICENSE"],
  ["pako", "LICENSE"],
  ["readable-stream", "LICENSE"],
  ["lie", "license.md"],
  ["immediate", "LICENSE.txt"],
  ["setimmediate", "LICENSE.txt"],
  ["core-util-is", "LICENSE"],
  ["inherits", "LICENSE"],
  ["isarray", "README.md"],
  ["process-nextick-args", "license.md"],
  ["string_decoder", "LICENSE"],
  ["util-deprecate", "LICENSE"],
  ["safe-buffer", "LICENSE"],
])
  wordNotices.push(
    `${pkg}\n${await readFile(`node_modules/${pkg}/${file}`, "utf8")}`,
  );
await mkdir("public/licenses", { recursive: true });
await writeFile(
  "public/licenses/word-notices.txt",
  wordNotices.join("\n\n--------------------\n\n"),
);
await mkdir("public/vendor/onnx", { recursive: true });
for (const extension of ["mjs", "wasm"]) {
  const file = `ort-wasm-simd-threaded.asyncify.${extension}`;
  await copyFile(
    `node_modules/onnxruntime-web/dist/${file}`,
    `public/vendor/onnx/${file}`,
  );
}
await mkdir("public/licenses", { recursive: true });
for (const pkg of [
  "react",
  "react-dom",
  "scheduler",
  "lucide-react",
  "@huggingface/transformers",
]) {
  await copyFile(
    `node_modules/${pkg}/LICENSE`,
    `public/licenses/${pkg.replaceAll("/", "-").replace("@", "")}.txt`,
  );
}
