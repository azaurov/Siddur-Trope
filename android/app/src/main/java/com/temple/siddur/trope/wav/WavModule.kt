package com.temple.siddur.trope.wav

import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.util.Log
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File
import java.io.FileOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.min

/**
 * Converts an audio file (AAC .m4a, .aac, or anything Android's MediaExtractor can
 * open) into a 16kHz mono PCM WAV file that whisper.cpp can decode directly.
 *
 * Pipeline:
 *   1. MediaExtractor finds the audio track.
 *   2. MediaCodec decodes compressed audio frames to raw PCM.
 *   3. If source is stereo, downmix to mono by averaging channels.
 *   4. If source sample rate != 16000, simple linear resample.
 *   5. Write a 44-byte WAV header, then interleaved 16-bit LE PCM samples.
 *
 * Output is little-endian 16-bit signed PCM, 16kHz, mono, which matches
 * whisper.cpp's expected input format.
 */
class WavModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "WavModule"

    @ReactMethod
    fun convertToWav(inputPath: String, outputPath: String, promise: Promise) {
        Thread {
            try {
                val pcm = decodeToPcm16kMono(inputPath)
                writeWav(outputPath, pcm, 16000, 1)
                promise.resolve(outputPath)
            } catch (t: Throwable) {
                Log.e("WavModule", "convertToWav failed", t)
                promise.reject("WAV_CONVERT_FAILED", t.message ?: "unknown error", t)
            }
        }.start()
    }

    /**
     * Returns interleaved signed 16-bit little-endian PCM at 16kHz mono.
     */
    private fun decodeToPcm16kMono(inputPath: String): ShortArray {
        val extractor = MediaExtractor()
        extractor.setDataSource(inputPath)
        val trackIndex = selectAudioTrack(extractor)
        if (trackIndex < 0) throw IllegalArgumentException("No audio track in $inputPath")
        extractor.selectTrack(trackIndex)
        val format = extractor.getTrackFormat(trackIndex)

        val srcSampleRate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE)
        val srcChannels = format.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
        val mime = format.getString(MediaFormat.KEY_MIME) ?: "audio/mp4a-latm"

        val codec = MediaCodec.createDecoderByType(mime)
        codec.configure(format, null, null, 0)
        codec.start()

        val info = MediaCodec.BufferInfo()
        var sawInputEos = false
        var sawOutputEos = false
        val pcm = ArrayList<Short>(16384)

        while (!sawOutputEos) {
            if (!sawInputEos) {
                val inIdx = codec.dequeueInputBuffer(10_000)
                if (inIdx >= 0) {
                    val inBuf = codec.getInputBuffer(inIdx)!!
                    val sampleSize = extractor.readSampleData(inBuf, 0)
                    if (sampleSize < 0) {
                        codec.queueInputBuffer(inIdx, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                        sawInputEos = true
                    } else {
                        codec.queueInputBuffer(inIdx, 0, sampleSize, extractor.sampleTime, 0)
                        extractor.advance()
                    }
                }
            }
            val outIdx = codec.dequeueOutputBuffer(info, 10_000)
            if (outIdx >= 0) {
                val outBuf = codec.getOutputBuffer(outIdx)!!
                outBuf.position(info.offset)
                outBuf.limit(info.offset + info.size)
                val chunk = ByteBuffer.allocate(info.size).order(ByteOrder.LITTLE_ENDIAN)
                chunk.put(outBuf)
                chunk.flip()
                if (srcChannels == 1) {
                    while (chunk.remaining() >= 2) pcm.add(chunk.short)
                } else {
                    // Stereo → mono by averaging left/right (16-bit LE samples).
                    while (chunk.remaining() >= 4) {
                        val l = chunk.short.toInt()
                        val r = chunk.short.toInt()
                        pcm.add(((l + r) / 2).toShort())
                    }
                }
                codec.releaseOutputBuffer(outIdx, false)
                if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) sawOutputEos = true
            }
        }

        codec.stop()
        codec.release()
        extractor.release()

        if (srcSampleRate == 16000) return pcm.toShortArray()

        // Linear resample to 16kHz. Cheap and good enough for short utterances.
        val ratio = srcSampleRate.toDouble() / 16000.0
        val outLen = (pcm.size / ratio).toInt()
        val out = ShortArray(outLen)
        for (i in 0 until outLen) {
            val srcPos = i * ratio
            val i0 = srcPos.toInt().coerceAtMost(pcm.size - 1)
            val i1 = min(i0 + 1, pcm.size - 1)
            val frac = (srcPos - i0).toFloat()
            out[i] = (pcm[i0] * (1 - frac) + pcm[i1] * frac).toInt().toShort()
        }
        return out
    }

    private fun selectAudioTrack(ex: MediaExtractor): Int {
        for (i in 0 until ex.trackCount) {
            val mime = ex.getTrackFormat(i).getString(MediaFormat.KEY_MIME) ?: continue
            if (mime.startsWith("audio/")) return i
        }
        return -1
    }

    private fun writeWav(path: String, pcm: ShortArray, sampleRate: Int, channels: Int) {
        val byteRate = sampleRate * channels * 2
        val dataSize = pcm.size * 2
        FileOutputStream(path).use { out ->
            // RIFF header
            out.write("RIFF".toByteArray(Charsets.US_ASCII))
            out.write(intToLe(36 + dataSize))
            out.write("WAVE".toByteArray(Charsets.US_ASCII))
            // fmt chunk
            out.write("fmt ".toByteArray(Charsets.US_ASCII))
            out.write(intToLe(16))           // fmt chunk size
            out.write(shortToLe(1))          // PCM
            out.write(shortToLe(channels.toShort()))
            out.write(intToLe(sampleRate))
            out.write(intToLe(byteRate))
            out.write(shortToLe((channels * 2).toShort())) // block align
            out.write(shortToLe(16))         // bits per sample
            // data chunk
            out.write("data".toByteArray(Charsets.US_ASCII))
            out.write(intToLe(dataSize))
            // PCM samples
            val buf = ByteBuffer.allocate(pcm.size * 2).order(ByteOrder.LITTLE_ENDIAN)
            for (s in pcm) buf.putShort(s)
            out.write(buf.array())
        }
    }

    private fun intToLe(v: Int): ByteArray = ByteBuffer.allocate(4).order(ByteOrder.LITTLE_ENDIAN).putInt(v).array()
    private fun shortToLe(v: Short): ByteArray = ByteBuffer.allocate(2).order(ByteOrder.LITTLE_ENDIAN).putShort(v).array()
}