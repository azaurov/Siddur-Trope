# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install        # install dependencies
npm start          # start Expo dev server (scan QR with Expo Go app)
npm run android    # launch on Android emulator/device
npm run ios        # launch on iOS simulator (macOS only)
npm run build:web  # export PWA to dist/ (runs expo export then patches index.html for PWA)
```

### EAS Builds

```bash
npx eas build -p android --profile preview     # installable APK for sideloading
npx eas build -p android --profile production  # .aab for Play Store submission
```

### Local Android Builds

Follow the SilkRoadDuo recipe in `/home/azaurov/SilkRoadDuo/CLAUDE.md` — Java 17, restore keystore after `expo prebuild --clean`, etc.

### Wireless ADB pairing

Same as SilkRoadDuo.

## Architecture

The app is a single-file React Native app (`App.js` ~2100 lines) with content in `assets/data/` and library helpers in `assets/lib/`. No router, no TypeScript, no state-management library.

### Screen flow

```
home → unit-detail → lesson → result
home → tropes (TropeCatalogScreen)
home → prayers → prayer-detail → recitation → result
home → vocabulary
home → achievements
```

Root state lives entirely in the top-level `App` component:
- `screen` — which screen is visible (string enum)
- `activeUnit` / `activeLesson` / `activeRecite` / `activePrayer` — current items
- `stats` / `profile` — active user profile with XP, streak, achievements

### Profile system (`assets/lib/profiles.js`)

Multi-profile support backed by `@react-native-async-storage/async-storage`. Two keys:
- `@siddur-trope:profiles` — JSON array of profile objects
- `@siddur-trope:activeId` — UUID of the last-selected profile

The `updateProfileAtomic` helper performs read-modify-write under a simple mutex to prevent race-condition clobbers when two async flows update the profile simultaneously.

UI lives in `assets/lib/profiles_ui.js` (`ProfileSelectScreen`, `ProfileCreateScreen`, `ProfileSwitcherModal`).

### Audio

- `expo-speech` — Hebrew TTS (locale `he-IL`). Detects missing Hebrew voice via `Speech.getAvailableVoicesAsync()` and falls back to romanized text. Result cached in module-level `_hebrewVoiceCached` to avoid per-tap TTS engine startup flicker.
- `expo-audio` — recording (`useAudioRecorder`) and playback (`useAudioPlayer`). Replaced the older `expo-av` API. Records to m4a/wav.
- `whisper.rn` — offline Hebrew ASR using a bundled `ggml-base.bin` (142 MB). Loaded lazily via `assets/lib/whisper.js`. The model file is at `assets/whisper/ggml-base.bin` (Git LFS). Whisper is Android/iOS only — the module is loaded via `eval('require')` to prevent Metro from bundling it for web.

### Scoring (`scorePronunciation`)

After Whisper transcribes audio, the app scores pronunciation by:
1. Stripping niqqud (Hebrew diacritics) and normalizing both the expected transliteration and the transcript.
2. Word-level recall: how many expected words have a Levenshtein match (≤ 2 edits) in the transcript.
3. Overall edit-distance score on joined strings.
Final score = 60% recall + 40% edit-distance, scaled to 0–100.

### Web / PWA

`npm run build:web` runs `expo export --platform web` then `scripts/patch-web-pwa.js` injects manifest link, Apple PWA meta tags, and service-worker registration into `dist/index.html`. The `public/` directory holds `manifest.json` and `sw.js` that are copied into `dist/`.

Whisper and microphone recording are not available in the web/PWA build — guarded by `Platform.OS` checks throughout.

### Content

All workbook content lives in `assets/data/`:
- `units.js` — `UNITS` array `{id, part, title, hebrewTitle, emoji, color, shadow, pale, desc, topic}` + `TIPS`
- `tropes.js` — `TROPES`, `TROPE_TIER_NAMES`, `TROPE_SYSTEMS`, `TROPE_MNEMONIC`, `TROPE_VERSES`
- `prayers.js` — `PRAYERS` (Hebrew + transliteration + English) + `HEBREW_VOCAB`
- `exercises.js` — `UNIT_EXERCISES` (quiz items per unit) + `TROPE_ID_QUIZ`

Edit these files to add/update content; `App.js` imports them at startup.

## Conventions

- All styles in one `StyleSheet.create({})` block at the bottom of `App.js`.
- Screen components are plain functions in `App.js`; the `App` component owns all mutable state.
- Single-file pattern is intentional — fast to iterate, matches SilkRoadDuo.
- Android package: `com.temple.siddur.trope`; EAS project ID is a placeholder (`11111111-...`).
