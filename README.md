# AmpOhm — Expo App (source for the real APK)

This is the native React Native / Expo version of AmpOhm, structured to
mirror the web build (`app.js`) exactly — same calculators, same
translations, same formulas — but with a real AdMob banner wired in
(only works in a native build, not in a browser).

## What's in here
```
ampohm-app/
  App.js              — all screens, calculators, UI
  src/translations.js — English + Hindi text (synced from the web app)
  src/ads.js           — AdMob banner unit ID (test ads in dev, real ID in production)
  src/storage.js        — saves the user's language choice on-device
  app.json              — Expo config + AdMob app ID
  eas.json              — cloud build profiles
  package.json
  babel.config.js
```

## 1. Set up the project locally
I can't run `npm install` or build an APK inside this sandbox (no
internet access here), so this last mile happens on your computer.

```bash
# 1. Install dependencies
cd ampohm-app
npm install

# 2. Auto-fix any version mismatches for your installed Expo SDK
#    (package.json pins versions that were current when this was
#    written — Expo releases often, so this command self-corrects)
npx expo install --fix
```

## 2. Test it on your phone (fast, no build needed)
AdMob is a **native module** — it will NOT work in the regular Expo Go
app. Use a **development build** instead (still fast, still no local
Android Studio needed):

```bash
npx eas login          # free Expo account — sign up at expo.dev if you don't have one
npx eas build:configure
eas build -p android --profile development
```

This gives you an installable "dev client" APK. Install it on your
phone, then run:
```bash
npx expo start --dev-client
```
and scan the QR code — the app opens with live-reload, and the AdMob
banner shows Google's **test ad** (safe to tap, won't get your account
flagged).

## 3. Build the real, shareable APK
When you're happy with it:
```bash
eas build -p android --profile preview
```
This builds in the cloud (10–20 min) and gives you a download link for
a real, installable `.apk` — this is the one to test fully and share
before Play Store submission.

For the **Play Store** itself, use:
```bash
eas build -p android --profile production
```
This produces an `.aab` (Android App Bundle), which is what Play
Console expects.

## Notes
- **Real ads only appear in `preview`/`production` builds** — `src/ads.js`
  automatically uses Google's test ad unit during development (`__DEV__`)
  and your real ID (`ca-app-pub-2773244009790944/5511256639`) otherwise.
  Never tap your own real ads while testing — that risks an AdMob
  policy strike.
- The `iosAppId` in `app.json` is Google's public **placeholder/test**
  ID — you don't have an iOS app yet, so it's unused unless you build
  for iOS later, at which point replace it with a real one from AdMob.
- Update `android.package` in `app.json` (currently
  `com.audioxpert.ampohm`) if you want a different package name — it
  can't be changed after your first Play Store upload.
- Before submitting to Play Store, host `privacy-policy.html` (from
  the web build) somewhere public and add that link in Play Console —
  required because the app shows ads.
