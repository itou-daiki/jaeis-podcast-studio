import { mkdir, copyFile } from "node:fs/promises";
// Same-origin, single-threaded WASM: no COOP/COEP headers needed on GitHub Pages.
await mkdir("public/vendor", { recursive: true });
for (const file of ["ffmpeg-core.js", "ffmpeg-core.wasm"]) {
  await copyFile(
    `node_modules/@ffmpeg/core/dist/esm/${file}`,
    `public/vendor/${file}`,
  );
}
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
