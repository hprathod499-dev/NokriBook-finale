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

This repo is connected to Netlify for continuous deployment: pushing to
`main` triggers an automatic build and deploy to nokribook.in. No manual
upload needed.

## Local development

`index.html` is a single self-contained file (React + Babel Standalone
loaded from CDN, no build step). Open it directly in a browser, or serve it
with any static file server, to test locally. Firebase config, Google Drive
OAuth client ID, and EmailJS keys are set near the top of the file's
`<script>` section.
