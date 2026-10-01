// Builds the FAST version of nokribook.in into ../_site
//
// You keep editing the normal, readable index.html in the repo root.
// This script (run automatically by GitHub on every push to main):
//   1. pulls the images that are embedded as text (data:image/...;base64)
//      out into small compressed files in /assets
//   2. translates the app's JSX once, here, instead of on every phone
//      (removes the 3 MB Babel download + several seconds of work)
//   3. minifies the result
//   4. copies the other site files (icons, manifest, service worker, ...)
//
// Babel settings are the same ones the in-browser Babel used
// (react + env for ES modules), so the app behaves exactly the same.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import babel from "@babel/core";
import { minify } from "terser";
import sharp from "sharp";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const OUT = path.join(ROOT, "_site");
const ASSETS = path.join(OUT, "assets");

// Files/folders in the repo root that are NOT part of the website.
const SKIP = new Set([".git", ".github", "android", "build", "node_modules", "_site", "README.md", ".gitignore", "firestore.rules", "index.html"]);

const kb = (n) => (n / 1024).toFixed(0) + " KB";
const fail = (msg) => { console.error("BUILD FAILED: " + msg); process.exit(1); };

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(ASSETS, { recursive: true });

let html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const originalSize = Buffer.byteLength(html);

// ---------- 1. embedded images -> /assets ----------
const IMG_RE = /data:image\/(png|jpe?g|webp|gif);base64,([A-Za-z0-9+/=]+)/g;
const MAX_SIDE = 384; // largest on-screen use is ~100px; 384 keeps it sharp on 3x screens
const seen = new Map();
let imgBefore = 0, imgAfter = 0;
for (const m of html.matchAll(IMG_RE)) {
  const full = m[0];
  if (seen.has(full)) continue;
  const input = Buffer.from(m[2], "base64");
  const meta = await sharp(input).metadata();
  const small = Math.max(meta.width || 0, meta.height || 0) <= 160; // tiny icons / textures: keep lossless
  let pipeline = sharp(input);
  if (Math.max(meta.width, meta.height) > MAX_SIDE) pipeline = pipeline.resize({ width: MAX_SIDE, height: MAX_SIDE, fit: "inside" });
  let out = await pipeline.webp(small ? { lossless: true } : { quality: 88 }).toBuffer();
  let ext = "webp";
  if (out.length >= input.length) { out = input; ext = m[1] === "jpg" ? "jpeg" : m[1]; }
  const name = "img-" + crypto.createHash("sha1").update(out).digest("hex").slice(0, 10) + "." + ext;
  fs.writeFileSync(path.join(ASSETS, name), out);
  seen.set(full, "/assets/" + name);
  imgBefore += full.length; imgAfter += out.length;
  console.log(`  image ${meta.width}x${meta.height} ${kb(full.length)} -> assets/${name} ${kb(out.length)}`);
}
for (const [dataUri, url] of seen) html = html.split(dataUri).join(url);

// ---------- 2 + 3. compile + minify the app script ----------
const OPEN = '<script type="text/babel" data-type="module">';
const start = html.indexOf(OPEN);
if (start === -1) fail("could not find the app's <script type=\"text/babel\"> block");
const bodyStart = start + OPEN.length;
const end = html.indexOf("</script>", bodyStart);
const jsx = html.slice(bodyStart, end);

const compiled = babel.transformSync(jsx, {
  babelrc: false,
  configFile: false,
  sourceType: "module",
  presets: [
    ["@babel/preset-react"],
    ["@babel/preset-env", { modules: false, targets: { esmodules: true } }],
  ],
  compact: false,
});
if (!compiled || !compiled.code) fail("Babel produced no output");

const min = await minify(compiled.code, {
  module: true,
  compress: { passes: 1 },
  mangle: true,
  keep_fnames: true,
  keep_classnames: true,
  format: { comments: false, preamble: "/* © 2026 Harshvardhan Rathod P. All rights reserved. Nokri Book — built from index.html. */" },
});
if (!min.code) fail("minifier produced no output");
// never let "</script" inside a string end the <script> tag early
const js = min.code.replace(/<\/(script)/gi, "<\\/$1");

html = html.slice(0, start) + '<script type="module">' + js + html.slice(end);

// the in-browser translator is no longer needed
const BABEL_TAG_RE = /<script src="https:\/\/unpkg\.com\/@babel\/standalone[^"]*"[^>]*><\/script>\r?\n?/;
if (!BABEL_TAG_RE.test(html)) fail("could not find the Babel <script> tag to remove");
html = html.replace(BABEL_TAG_RE, "");
if (html.includes("text/babel")) fail("a text/babel script is still in the page");

fs.writeFileSync(path.join(OUT, "index.html"), html);

// ---------- 4. the rest of the site ----------
for (const entry of fs.readdirSync(ROOT, { withFileTypes: true })) {
  if (SKIP.has(entry.name)) continue;
  const from = path.join(ROOT, entry.name), to = path.join(OUT, entry.name);
  fs.cpSync(from, to, { recursive: true });
}

const finalSize = Buffer.byteLength(html);
console.log(`\nindex.html  ${kb(originalSize)} -> ${kb(finalSize)}`);
console.log(`images      ${kb(imgBefore)} (as text) -> ${kb(imgAfter)} (files)`);
console.log(`no more in-browser Babel (${"~3 MB"} download + compile on every open)`);
console.log(`\nBuilt into ${path.relative(ROOT, OUT)}/`);
