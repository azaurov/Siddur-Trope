// Whisper.rn wrapper for offline Hebrew ASR.
// Loads the bundled ggml-base.bin model once, then transcribes user recordings.
//
// Why base (not tiny / small / medium)?
//   - tiny (75MB): Hebrew accuracy is poor — many word substitutions.
//   - base  (142MB): sweet spot for Hebrew on a phone. Recognizes nikud + troped reading.
//   - small (466MB): noticeably better but doubles APK size.
//   - medium (1.5GB): not shippable in an APK.
//
// Usage:
//   await ensureWhisperLoaded()      // idempotent; lazy-loads on first call
//   const text = await transcribeFile(wavPath)

import { initWhisper, releaseAllWhisper } from "whisper.rn";

// Top-level require so Metro's bundler resolves the asset at build time.
// Resolving it lazily inside resolveModelPath() made Metro treat it as a
// string path and fail to inline the asset id — hence "missing from bundle".
const WHISPER_MODEL_ASSET = require("../../assets/whisper/ggml-base.bin");

// Resolve a stable file path for the bundled ggml-base.bin.
// In a release build this asset is in the APK; on first run we copy it to the
// app's documents directory because whisper.cpp needs a real filesystem path
// (not a content:// URI) to mmap the model.
import * as FileSystem from "expo-file-system";

const MODEL_FILENAME = "ggml-base.bin";
let modelPath = null;
let context = null;
let loadPromise = null;

async function resolveModelPath() {
  if (modelPath) return modelPath;
  // expo-file-system v56+ exposes File/Directory classes from the main entry
  // point, and the legacy imperative API (FileSystem.*) under "/legacy".
  const { File } = await import("expo-file-system");
  const FileSystemLegacy = await import("expo-file-system/legacy");
  const destPath = `${FileSystemLegacy.documentDirectory}${MODEL_FILENAME}`;
  const dest = new File(destPath);
  if (!dest.exists || (dest.size && dest.size < 100_000_000)) {
    // Use expo-asset's Asset.fromModule with an explicit require so the
    // bundler recognizes the path at build time. The require must be at module
    // top level (not nested in a function) for Metro to inline the asset id.
    const Asset = (await import("expo-asset")).Asset;
    const asset = Asset.fromModule(WHISPER_MODEL_ASSET);
    await asset.downloadAsync();
    await FileSystemLegacy.copyAsync({ from: asset.localUri, to: destPath });
  }
  modelPath = destPath;
  return modelPath;
}

export async function ensureWhisperLoaded() {
  if (context) return context;
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    const path = await resolveModelPath();
    // 4 threads is a good default on modern octa-core phones; whisper.cpp
    // uses threadpool internally so more doesn't always help.
    context = await initWhisper({ filePath: path, useGpu: false });
    return context;
  })();
  try {
    return await loadPromise;
  } catch (e) {
    // Allow retry on next call.
    loadPromise = null;
    throw e;
  }
}

export async function transcribeFile(wavPath, { language = "he", onProgress } = {}) {
  const ctx = await ensureWhisperLoaded();
  const options = { language };
  if (onProgress) options.onProgress = onProgress;
  const { promise, stop } = ctx.transcribe(wavPath, options);
  const result = await promise;
  return (result?.result || "").trim();
}

export async function releaseWhisper() {
  if (context) {
    try { await releaseAllWhisper(); } catch {}
    context = null;
    modelPath = null;
    loadPromise = null;
  }
}

// Lightweight diagnostic for the home screen "Pronunciation judge status" indicator.
export async function whisperStatus() {
  try {
    await ensureWhisperLoaded();
    return { ready: true };
  } catch (e) {
    return { ready: false, error: String(e.message || e) };
  }
}
