// Thin wrapper around the Kotlin WavModule that converts AAC recordings into
// 16kHz mono PCM WAV files for whisper.rn.
//
// Usage:
//   const wavPath = await convertM4aToWav(m4aUri);   // uri like "file:///..."
//   const text = await transcribeFile(wavPath);        // see whisper.js

import { NativeModules } from "react-native";
import * as FileSystem from "expo-file-system";

const { WavModule } = NativeModules;

if (!WavModule) {
  // Visible error early — better than silent failure during a recording submit.
  console.warn("[wav] WavModule native module not linked. Check MainApplication.kt.");
}

function stripFileScheme(p) {
  return p.startsWith("file://") ? p.slice(7) : p;
}

/**
 * Convert an .m4a (AAC) recording at `inputUri` into a 16kHz mono PCM WAV
 * at `outputPath`. Returns the absolute filesystem path to the WAV.
 *
 * If conversion fails, throws — caller should fall back to the duration heuristic.
 */
export async function convertM4aToWav(inputUri) {
  if (!WavModule) {
    throw new Error("WavModule native module not linked. Did you rebuild the APK after adding MainApplication.kt?");
  }
  const inPath = stripFileScheme(inputUri);
  const outPath = `${FileSystem.cacheDirectory}recording-${Date.now()}.wav`;
  // Make sure the destination directory exists.
  const outDir = outPath.substring(0, outPath.lastIndexOf("/"));
  await FileSystem.makeDirectoryAsync(outDir, { intermediates: true }).catch(() => {});
  const finalOutPath = await WavModule.convertToWav(inPath, outPath);
  return finalOutPath;
}