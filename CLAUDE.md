# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install        # install dependencies
npm start          # start Expo dev server (scan QR with Expo Go app)
npm run android    # launch on Android emulator/device
npm run ios        # launch on iOS simulator (macOS only)
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

The app lives primarily in `App.js`, with content split into editable data files under `assets/data/`.

### Screen flow

```
home → unit detail → lesson → result
home → trope-catalog → trope-detail
home → prayer-catalog → prayer-recite (record + judge)
home → achievements
```

Root state in `App` (the only stateful owner):
- `screen` — which screen is visible
- `activeUnit` / `activeExercise` — selected unit/exercise
- `stats` — XP, streak, lessons, per-unit XP

### Audio

- `expo-speech` for Hebrew TTS (locale `he-IL`). Some Android devices don't ship Hebrew voice — the app detects this via `Speech.getAvailableVoicesAsync()` and falls back to romanized text.
- `expo-av` `Audio.Recording` for the Record+Judge exercise. Records to m4a (Android). The judge stage currently compares recording duration vs expected (a real STT/spectral match would need a backend or on-device model).
- `expo-audio` is available for playing short trope chant clips if/when added under `assets/audio/tropes/`.

### Content

All workbook content lives in `assets/data/`:
- `units.js` — array of `{id, title, emoji, color, desc, topic}` matching the workbook's unit list
- `tropes.js` — catalog of trope marks
- `prayers.js` — Hebrew + transliteration + English for prayer texts
- `exercises.js` — quiz items generated from the workbook's exercise section

Edit these files to add/update content. `App.js` reads from them at startup.

## Conventions

- All styles in one `StyleSheet.create({})` block at the bottom of `App.js`.
- No TypeScript. No router. No state-management library.
- Single-file pattern is intentional — fast to hack on, matches SilkRoadDuo.
