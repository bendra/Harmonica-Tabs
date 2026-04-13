package expo.modules.harmonicaaudio

import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.log2
import kotlin.math.sqrt

class HarmonicaAudioModule : Module() {
  private var audioRecord: AudioRecord? = null
  private var captureThread: Thread? = null
  @Volatile private var isCapturing = false

  private var targetFrequencies: FloatArray = FloatArray(0)
  private var confidenceThresholds: FloatArray = FloatArray(0)

  private val sampleRate = 44100
  private val bufferFrames = 4096

  override fun definition() = ModuleDefinition {
    Name("HarmonicaAudio")

    Events("onAudioFrame")

    // Starts microphone capture. Accepts the target frequencies and per-note
    // confidence thresholds from the JS vocabulary so detection runs natively
    // without sending raw PCM across the bridge.
    AsyncFunction("start") { frequencies: List<Double>, thresholds: List<Double> ->
      targetFrequencies = frequencies.map { it.toFloat() }.toFloatArray()
      confidenceThresholds = thresholds.map { it.toFloat() }.toFloatArray()
      startCapture()
      mapOf("sampleRate" to sampleRate)
    }

    Function("stop") {
      stopCapture()
    }
  }

  // MARK: - Capture lifecycle

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

    captureThread = Thread {
      val samples = FloatArray(bufferFrames)
      while (isCapturing) {
        val read = audioRecord?.read(samples, 0, bufferFrames, AudioRecord.READ_BLOCKING) ?: break
        if (read > 0) {
          val (frequency, confidence, rms) = detectNote(samples, read)
          sendEvent("onAudioFrame", mapOf(
            "frequency" to frequency,
            "confidence" to confidence,
            "rms" to rms,
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

  // MARK: - YIN pitch detection
  //
  // Mirrors the algorithm in src/logic/fft-detector.ts exactly.
  // YIN finds the shortest repeating period of the waveform (the true
  // fundamental) rather than scoring energy at known frequencies. This
  // avoids the sub-harmonic octave errors that plagued Goertzel.

  private val yinThreshold = 0.10f

  /** Step 1: difference function d[τ] = Σ (x[j] - x[j+τ])² */
  private fun yinDifference(samples: FloatArray, count: Int, maxLag: Int): FloatArray {
    val W = count / 2
    val d = FloatArray(maxLag + 1)
    for (tau in 1..maxLag) {
      var sum = 0f
      for (j in 0 until W) {
        val delta = samples[j] - samples[j + tau]
        sum += delta * delta
      }
      d[tau] = sum
    }
    return d
  }

  /**
   * Step 2: cumulative mean normalized difference.
   * d'[τ] = d[τ] × τ / Σ_{j=1}^{τ} d[j]
   * Suppresses sub-octave peaks so the true fundamental wins.
   */
  private fun yinCmnd(d: FloatArray): FloatArray {
    val cmnd = FloatArray(d.size)
    cmnd[0] = 1f
    var runningSum = 0f
    for (tau in 1 until d.size) {
      runningSum += d[tau]
      cmnd[tau] = if (runningSum == 0f) 0f else d[tau] * tau / runningSum
    }
    return cmnd
  }

  /** Step 4: parabolic interpolation for sub-sample lag precision. */
  private fun parabolicInterp(cmnd: FloatArray, tau: Int): Float {
    if (tau <= 0 || tau >= cmnd.size - 1) return tau.toFloat()
    val prev = cmnd[tau - 1]; val curr = cmnd[tau]; val next = cmnd[tau + 1]
    val denom = 2 * (prev - 2 * curr + next)
    return if (denom == 0f) tau.toFloat() else tau + (prev - next) / denom
  }

  /** Returns the detected fundamental frequency in Hz, or null if none found. */
  private fun yinDetect(samples: FloatArray, count: Int, minFreq: Float, maxFreq: Float): Float? {
    val minLag = (sampleRate / maxFreq).toInt()
    val maxLag = (sampleRate / minFreq).toInt()
    if (count < maxLag * 2) return null

    val d = yinDifference(samples, count, maxLag)
    val cmnd = yinCmnd(d)

    var tau = minLag
    while (tau <= maxLag) {
      if (cmnd[tau] < yinThreshold) {
        while (tau + 1 <= maxLag && cmnd[tau + 1] < cmnd[tau]) tau++
        val refined = parabolicInterp(cmnd, tau)
        return sampleRate / refined
      }
      tau++
    }
    return null
  }

  private data class DetectionResult(
    val frequency: Double?,
    val confidence: Double,
    val rms: Double,
  )

  private fun detectNote(samples: FloatArray, count: Int): DetectionResult {
    // Silence gate
    var sumSq = 0f
    for (i in 0 until count) sumSq += samples[i] * samples[i]
    val rms = sqrt(sumSq / count)
    if (rms < 0.005f) return DetectionResult(null, 0.0, rms.toDouble())
    if (targetFrequencies.isEmpty()) return DetectionResult(null, 0.0, rms.toDouble())

    // 10% margin gives parabolic interpolation room at the edges.
    val minFreq = targetFrequencies.first() * 0.9f
    val maxFreq = targetFrequencies.last()  * 1.1f

    val fundamental = yinDetect(samples, count, minFreq, maxFreq)
      ?: return DetectionResult(null, 0.0, rms.toDouble())

    // Convert to fractional MIDI for cent-accurate distance comparisons.
    val detectedMidi = 69.0 + 12.0 * log2(fundamental / 440.0)

    // Find the nearest vocabulary note by MIDI distance.
    var nearestIdx = 0
    var nearestCents = Float.MAX_VALUE
    for (i in targetFrequencies.indices) {
      val noteMidi = 69.0 + 12.0 * log2(targetFrequencies[i] / 440.0)
      val cents = abs((detectedMidi - noteMidi) * 100.0).toFloat()
      if (cents < nearestCents) { nearestCents = cents; nearestIdx = i }
    }

    // Acceptance window — mirrors centsTolerance() in fft-detector.ts.
    val threshold = confidenceThresholds[nearestIdx]
    val tolerance = (50.0f * (1.0f - threshold)) / 0.7f
    if (nearestCents > tolerance) return DetectionResult(null, 0.0, rms.toDouble())

    val confidence = (1.0 - nearestCents / tolerance).toDouble()
    return DetectionResult(targetFrequencies[nearestIdx].toDouble(), confidence, rms.toDouble())
  }
}
