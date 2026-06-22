# Siddur & Trope

An Android app built with React Native + Expo, designed to teach **Siddur** (Jewish prayer), **Trope** (biblical cantillation), and **correct Hebrew pronunciation** — content drawn from *Siddur & Trope Workbook (Expanded Edition)* by Alex Zaurov.

## Quick Start

```bash
npm install
npx expo start         # scan QR with Expo Go on Android
npm run android        # launch on emulator / connected device
```

## What it teaches

- **Unit-based workbook** — all 21 units from the PDF, organized into a home screen with per-unit progress
- **Trope catalog** — full Ta'amei HaMikra inventory (disjunctive + conjunctive, with shape/name/function/frequency)
- **Pronunciation practice** — record your voice reciting verses / trope marks, get a waveform/score, compare to the reference
- **TTS for Hebrew** — every prayer and trope has 🔊 playback using the device's Hebrew voice
- **MCQ + match + fill-blank + ordering** exercises, drawn from the workbook's own practice section
- **Gamification** — hearts, XP, streaks, achievements (similar to SilkRoadDuo)

## Architecture

Same shape as SilkRoadDuo — **single `App.js`** with all screens, navigation, audio, and styles. Data lives in `assets/data/*.js` so it's editable without touching UI code.

- `App.js` — root, navigation, screens, styles
- `assets/data/units.js` — workbook content
- `assets/data/tropes.js` — trope catalog
- `assets/data/prayers.js` — full Hebrew + transliteration for prayer texts
- `assets/data/exercises.js` — quiz items from the workbook's Exercise section

## Audio

- TTS via `expo-speech` for Hebrew reference pronunciation (locale `he-IL`)
- Recording via `expo-av` `Audio.Recording` (Android)
- Native trope chant audio clips would be added under `assets/audio/tropes/*.mp3` — placeholder structure included

## Building APK

```bash
npx eas build -p android --profile preview      # sideload APK
npx eas build -p android --profile production   # Play Store AAB
```

See SilkRoadDuo's CLAUDE.md for the local Gradle recipe if you don't want cloud builds.
