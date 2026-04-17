package expo.modules.harmonicaaudio

import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class HarmonicaAudioModule : Module() {
  private var audioRecord: AudioRecord? = null
  private var captureThread: Thread? = null
  @Volatile private var isCapturing = false

  private val sampleRate = 44100
  private val bufferFrames = 4096

  override fun definition() = ModuleDefinition {
    Name("HarmonicaAudio")

    Events("onAudioFrame")

    // Starts microphone capture. Returns the sample rate so JS can pass it to
    // the pitch detector. No frequencies or thresholds needed here — all
    // detection logic runs in TypeScript.
    AsyncFunction("start") { ->
      startCapture()
      mapOf("sampleRate" to sampleRate)
    }

    Function("stop") {
      stopCapture()
    }
  }

  private fun startCapture() {
    stopCapture()

    val minBuffer = AudioRecord.getMinBufferSize(
      sampleRate,
      AudioFormat.CHANNEL_IN_MONO,
      AudioFormat.ENCODING_PCM_FLOAT,
    )
    // Allocate at least 2× bufferFrames worth of bytes to avoid overruns.
    val bufferBytes = maxOf(minBuffer, bufferFrames * Float.SIZE_BYTES * 2)

    audioRecord = AudioRecord(
      MediaRecorder.AudioSource.MIC,
      sampleRate,
      AudioFormat.CHANNEL_IN_MONO,
      AudioFormat.ENCODING_PCM_FLOAT,
      bufferBytes,
    )

    audioRecord?.startRecording()
    isCapturing = true

    // Android reads exactly bufferFrames samples per call, so no accumulation
    // is needed — each read produces one complete 4096-sample frame for JS.
    captureThread = Thread {
      val samples = FloatArray(bufferFrames)
      while (isCapturing) {
        val read = audioRecord?.read(samples, 0, bufferFrames, AudioRecord.READ_BLOCKING) ?: break
        if (read > 0) {
          sendEvent("onAudioFrame", mapOf(
            "samples" to samples.toList(),
            "sampleRate" to sampleRate,
          ))
        }
      }
    }.also {
      it.name = "HarmonicaAudioCapture"
      it.start()
    }
  }

  private fun stopCapture() {
    isCapturing = false
    audioRecord?.stop()
    audioRecord?.release()
    audioRecord = null
    captureThread?.join(500)
    captureThread = null
  }
}
