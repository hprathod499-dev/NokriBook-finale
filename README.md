# Nokri Book

Fair, automatic duty-rotation console for police staff scheduling. Single-file
React PWA (Firebase Auth + Firestore backend, bilingual English/Gujarati,
offline-capable, installable).

## Structure

- `index.html` — the entire web app. This is what's deployed to
  [nokribook.in](https://nokribook.in) via Netlify.
- `android/` — Android WebView wrapper project (wraps `index.html` as an
  installable APK). Built via GitHub Actions — see `android/.github/workflows/`.

## Deploying

`index.html` stays the readable master copy — edit or upload it as usual.
Every push to `main` runs `.github/workflows/deploy-site.yml`, which:

1. builds a fast version into `_site/` (`build/build.mjs`): JSX compiled
   ahead of time (no in-browser Babel), code minified, embedded images
   moved to small files in `/assets`;
2. runs a safety test (`build/smoke-test.mjs`) in a headless browser;
3. publishes to GitHub Pages (nokribook.in) only if the test passes.

Needs Settings → Pages → Source = **GitHub Actions** (one-time).
To build locally: `cd build && npm ci && npm run build && npm test`.

## Local development

`index.html` is a single self-contained file (React + Babel Standalone
loaded from CDN, no build step). Open it directly in a browser, or serve it
with any static file server, to test locally. Firebase config, Google Drive
OAuth client ID, and EmailJS keys are set near the top of the file's
`<script>` section.
