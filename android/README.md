# Nokri Book — Android app (self-contained WebView build)

This version bundles your app's HTML/JS directly inside the APK (in
`app/src/main/assets/`) — it does **not** depend on hosting the app
anywhere first. Install it and it just works immediately, using the
version of the app as of when this was built. Firebase Auth, Firestore,
Google sign-in, WhatsApp sharing, etc. all still work normally since
those go out over the real internet — only the initial page load is
bundled locally.

(Trade-off vs. the other project I gave you, the TWA one: that one loads
live from your hosted URL, so every future change to the app appears
instantly for anyone with it installed. This one is a snapshot — updating
the app later means rebuilding and reinstalling this APK. Good for
"let me see it working on my phone right now"; the TWA + hosting route is
the better long-term setup once you're ready for it.)

## I can't build the .apk file myself in this chat

Compiling an Android app requires the Android SDK's build tools, which
need to be downloaded from the internet — neither of those exist in this
chat environment. But you don't need to install Android Studio either.
**GitHub will build it for you, for free, in the cloud** — that's what the
`.github/workflows/build-debug-apk.yml` file in this project does.

## Get the .apk — no Android Studio required

1. **Create a free GitHub account** at github.com, if you don't have one.
2. **Create a new repository** (github.com → the `+` in the top right →
   New repository). Any name, Public or Private both work.
3. **Upload this whole folder's contents** to that repository. Easiest
   way with no command line: on the repo's page, click **Add file →
   Upload files**, then drag this entire folder in and commit.
   (If you're comfortable with git instead: `git init`, `git add .`,
   `git commit -m "first"`, `git remote add origin <your repo URL>`,
   `git push -u origin main`.)
4. Click the **Actions** tab at the top of your repository. The build
   should already be running (it starts automatically on every push). If
   it isn't, click **Build debug APK** on the left, then **Run workflow**.
5. Wait a few minutes for the green checkmark. Click into that finished
   run, scroll down to **Artifacts**, and download
   **nokri-book-debug-apk** — that's a .zip containing `app-debug.apk`.

## Install it on your phone

1. Get `app-debug.apk` onto your phone (email it to yourself, save to
   Google Drive and open on the phone, or plug the phone in via USB and
   copy it over — any of these work).
2. Tap the file on your phone to open it. Android will likely block it
   the first time and ask you to allow installs from whichever app you
   opened it with (Files, Gmail, Drive, etc.) — go into that one-time
   permission prompt, allow it, then try opening the file again.
3. Tap **Install**. It'll show up as "Nokri Book" with your icon like any
   other app.

This is a **debug build** — signed with a generic placeholder key, not
your own. That's completely fine for installing on your own device, but
it's not the file you'd upload to the Play Store (that needs the signed
release build from the TWA project, with your own signing key — see that
project's README when you're ready for that step).
