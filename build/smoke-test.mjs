// Safety check run by GitHub before the fast build goes live.
// Serves ../_site locally, opens it in headless Chromium and fails the
// deploy if the page throws an error or the sign-in screen doesn't
// appear, or if any image or the service worker file is missing.
// If this fails, nothing is published and the current site stays live.

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.resolve(HERE, "..", "_site");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml" };

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  let file = path.join(SITE, decodeURIComponent(url.pathname));
  if (!file.startsWith(SITE)) { res.writeHead(403); return res.end(); }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
  if (!fs.existsSync(file)) file = path.join(SITE, "index.html"); // SPA fallback
  res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

const problems = [];
const html = fs.readFileSync(path.join(SITE, "index.html"), "utf8");
if (html.includes("text/babel")) problems.push("page still contains a text/babel script");
if (!fs.existsSync(path.join(SITE, "service-worker.js"))) problems.push("service-worker.js missing");
for (const m of html.matchAll(/\/assets\/(img-[a-f0-9]+\.\w+)/g)) {
  if (!fs.existsSync(path.join(SITE, "assets", m[1]))) problems.push("missing image " + m[1]);
}

const browser = await chromium.launch();
try {
  for (const route of ["/", "/app/leave"]) {
    const page = await browser.newPage();
    // Offline testing only (not used on GitHub): NB_CDN_MAP points to a
    // JSON {"file-name.js": "/local/path"} to serve CDN scripts locally.
    if (process.env.NB_CDN_MAP) {
      const map = JSON.parse(fs.readFileSync(process.env.NB_CDN_MAP, "utf8"));
      await page.route(/^https:\/\//, (r) => {
        const name = new URL(r.request().url()).pathname.split("/").pop();
        return map[name] ? r.fulfill({ body: fs.readFileSync(map[name]), contentType: "text/javascript", headers: { "access-control-allow-origin": "*" } }) : r.abort();
      });
    }
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(base + route, { waitUntil: "load", timeout: 60000 });
    try {
      await page.waitForFunction(() => /Login|Sign Up|Welcome/i.test(document.body.innerText), null, { timeout: 45000 });
    } catch (e) {
      problems.push(`${route}: sign-in screen did not appear`);
    }
    // the logo on the sign-in screen must actually load
    const brokenImgs = await page.$$eval("img", (imgs) => imgs.filter((i) => i.src.includes("/assets/") && !(i.complete && i.naturalWidth > 0)).map((i) => i.src));
    brokenImgs.forEach((s) => problems.push(`${route}: image did not load ${s}`));
    errors.forEach((e) => problems.push(`${route}: page error: ${e}`));
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}

if (problems.length) {
  console.error("SMOKE TEST FAILED — the new version will NOT be published:\n - " + problems.join("\n - "));
  process.exit(1);
}
console.log("Smoke test passed: sign-in screen renders, images load, no page errors.");
