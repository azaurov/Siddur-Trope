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
//
// Web/PWA note: whisper.rn is a native module that links to whisper.cpp's
// JNI bindings. It cannot run in a browser. We use `eval('require')` to load
// it lazily AND hide the call from Metro's static analyzer so the web bundle
// doesn't try to resolve it (and fail because whisper.rn has no .web entry).
// Callers that hit this on web get a clear "not available on web" error.

// `eval('require')` defeats Metro's static analyzer. On native this behaves
// identically to a regular require(); on web the require call is never made
// because we short-circuit on Platform.OS first.
const dynamicRequire = (mod) => eval('require')(mod);

let _native = null;
let _nativeLoadError = null;
async function getNative() {
  if (_native) return _native;
  if (_nativeLoadError) throw _nativeLoadError;
  try {
    const { Platform } = dynamicRequire("react-native");
    if (Platform.OS !== "android" && Platform.OS !== "ios") {
      throw new Error("Whisper is not available on web — use the mobile app for recording.");
    }
    _native = dynamicRequire("whisper.rn");
    return _native;
  } catch (e) {
    _nativeLoadError = e;
    throw e;
  }
}

// Top-level require so Metro's bundler resolves the asset at build time.
// Resolving it lazily inside resolveModelPath() made Metro treat it as a
// string path and fail to inline the asset id — hence "missing from bundle".
// The require itself is benign: it's just the LFS pointer (134 bytes), and
// Metro only inlines the asset reference — no fetch happens until the user
// actually runs a recording flow.
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
  const native = await getNative();
  if (context) return context;
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    const path = await resolveModelPath();
    // 4 threads is a good default on modern octa-core phones; whisper.cpp
    // uses threadpool internally so more doesn't always help.
    context = await native.initWhisper({ filePath: path, useGpu: false });
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
    try {
      const native = await getNative();
      await native.releaseAllWhisper();
    } catch {}
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