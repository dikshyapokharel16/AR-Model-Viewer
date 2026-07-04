// Compiles one or more marker images into a MindAR multi-target ".mind" file,
// entirely offline/scriptable (no browser GUI needed). MindAR's own compiler
// (mindar-image.prod.js, vendored in ./mindar-vendor/) is a browser-only
// bundle (Canvas/Image APIs, Web Workers) — this drives it headlessly via
// Puppeteer instead of node-canvas, since node-canvas's native build isn't
// set up on this machine and Puppeteer needs no compilation (just a bundled
// Chromium download).
//
// Usage:
//   node compile-targets.mjs <out.mind> <image0> <image1> ... <imageN>
// Images MUST be passed in the exact order that should map to targetIndex
// 0, 1, 2, ... in models.json — order determines which model shows on which
// marker.

import puppeteer from "puppeteer";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const [, , outPath, ...imagePaths] = process.argv;

if (!outPath || imagePaths.length === 0) {
  console.error("Usage: node compile-targets.mjs <out.mind> <image0> <image1> ...");
  process.exit(1);
}

const vendorDir = path.join(__dirname, "mindar-vendor");

const mime = (p) => {
  const ext = path.extname(p).toLowerCase();
  return { ".js": "text/javascript", ".html": "text/html", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png" }[ext] || "application/octet-stream";
};

const server = http.createServer((req, res) => {
  const reqPath = decodeURIComponent(req.url.split("?")[0]);
  let filePath;
  if (reqPath === "/") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`<!doctype html><html><body><script type="module" src="/mindar-image.prod.js"></script></body></html>`);
    return;
  } else if (reqPath.startsWith("/vendor/")) {
    filePath = path.join(vendorDir, reqPath.replace("/vendor/", ""));
  } else if (reqPath.startsWith("/images/")) {
    const idx = parseInt(reqPath.replace("/images/", ""), 10);
    filePath = imagePaths[idx];
  } else {
    filePath = path.join(vendorDir, reqPath.replace(/^\//, ""));
  }
  try {
    const data = fs.readFileSync(filePath);
    res.writeHead(200, { "Content-Type": mime(filePath) });
    res.end(data);
  } catch (e) {
    res.writeHead(404);
    res.end("not found: " + filePath);
  }
});

await new Promise((resolve) => server.listen(0, resolve));
const port = server.address().port;
console.log(`Local server on http://localhost:${port}`);

const browser = await puppeteer.launch({ headless: true });
const page = await browser.newPage();
page.on("console", (msg) => console.log("[page]", msg.text()));
page.on("pageerror", (err) => console.error("[page error]", err));

let resolveResult;
const resultPromise = new Promise((resolve) => { resolveResult = resolve; });
await page.exposeFunction("onMindArDone", (base64) => resolveResult(base64));
await page.exposeFunction("onMindArProgress", (p) => console.log(`compiling... ${p.toFixed(1)}%`));

await page.goto(`http://localhost:${port}/`, { waitUntil: "load" });

await page.evaluate(async (imageCount) => {
  // window.MINDAR.IMAGE.Compiler is set as a side effect of loading the
  // module script tag in index.html served above.
  while (!window.MINDAR?.IMAGE?.Compiler) {
    await new Promise((r) => setTimeout(r, 50));
  }
  const { Compiler } = window.MINDAR.IMAGE;

  const loadImage = (src) => new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });

  const images = [];
  for (let i = 0; i < imageCount; i++) {
    images.push(await loadImage(`/images/${i}`));
  }

  const compiler = new Compiler();
  await compiler.compileImageTargets(images, (p) => window.onMindArProgress(p));
  const buffer = compiler.exportData(); // ArrayBuffer

  // Return to Node as base64 via exposeFunction (binary-safe over the CDP bridge).
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  window.onMindArDone(btoa(binary));
}, imagePaths.length);

const base64 = await resultPromise;
const outBuffer = Buffer.from(base64, "base64");
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, outBuffer);
console.log(`Wrote ${outPath} (${(outBuffer.length / 1024).toFixed(1)}KB) from ${imagePaths.length} target image(s):`);
imagePaths.forEach((p, i) => console.log(`  targetIndex ${i}: ${p}`));

await browser.close();
server.close();
