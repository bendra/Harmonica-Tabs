package expo.modules.harmonicaaudio

import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
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
  private val fundamentalRecoveryHarmonics = floatArrayOf(2f, 3f)
  private val fundamentalRecoveryMaxDeviationCents = 35f
  private val fundamentalRecoveryMinFundamentalRatio = 0.1f
  private val fundamentalRecoveryMinAdvantage = 1.1f

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

  // MARK: - Goertzel pitch detection
  //
  // Mirrors the algorithm in src/logic/fft-detector.ts exactly.
  // Only the fundamental is scored (no harmonic weighting) to avoid
  // sub-octave misdetection — see fft-detector.ts for the full rationale.

  private fun goertzelPower(samples: FloatArray, count: Int, targetFreq: Float): Float {
    val omega = (2.0 * PI * targetFreq / sampleRate).toFloat()
    val coeff = 2.0f * cos(omega)
    var s1 = 0f
    var s2 = 0f
    for (i in 0 until count) {
      val s = samples[i] + coeff * s1 - s2
      s2 = s1
      s1 = s
    }
    return s2 * s2 + s1 * s1 - coeff * s1 * s2
  }

  private data class DetectionResult(
    val frequency: Double?,
    val confidence: Double,
    val rms: Double,
  )

  private data class WinnerSelection(
    val noteIndex: Int,
    val supportScore: Float,
  )

  private fun centsBetween(a: Float, b: Float): Float {
    return 1200.0f * log2(a / b)
  }

  private fun isNearHarmonic(baseFrequency: Float, candidateFrequency: Float, harmonic: Float): Boolean {
    val expectedFrequency = baseFrequency * harmonic
    return abs(centsBetween(candidateFrequency, expectedFrequency)) <= fundamentalRecoveryMaxDeviationCents
  }

  private fun chooseWinningNote(scores: List<Float>): WinnerSelection {
    val winnerIndex = scores.indices.maxByOrNull { scores[it] } ?: 0
    val winnerScore = scores[winnerIndex]
    var selectedIndex = winnerIndex
    var selectedSupportScore = winnerScore

    for (candidateIndex in 0 until winnerIndex) {
      val candidateScore = scores[candidateIndex]
      if (candidateScore < winnerScore * fundamentalRecoveryMinFundamentalRatio) {
        continue
      }

      val candidateFrequency = targetFrequencies[candidateIndex]
      val winnerLooksLikeHarmonic = fundamentalRecoveryHarmonics.any { harmonic ->
        isNearHarmonic(candidateFrequency, targetFrequencies[winnerIndex], harmonic)
      }
      if (!winnerLooksLikeHarmonic) {
        continue
      }

      var familySupportScore = candidateScore
      for (higherIndex in (candidateIndex + 1) until scores.size) {
        if (scores[higherIndex] < candidateScore) {
          continue
        }

        val supportsCandidate = fundamentalRecoveryHarmonics.any { harmonic ->
          isNearHarmonic(candidateFrequency, targetFrequencies[higherIndex], harmonic)
        }
        if (supportsCandidate) {
          familySupportScore += scores[higherIndex]
        }
      }

      if (familySupportScore < winnerScore * fundamentalRecoveryMinAdvantage) {
        continue
      }

      if (familySupportScore > selectedSupportScore ||
        (familySupportScore == selectedSupportScore && candidateFrequency < targetFrequencies[selectedIndex])
      ) {
        selectedIndex = candidateIndex
        selectedSupportScore = familySupportScore
      }
    }

    return WinnerSelection(selectedIndex, selectedSupportScore)
  }

  private fun detectNote(samples: FloatArray, count: Int): DetectionResult {
    // Silence gate
    var sumSq = 0f
    for (i in 0 until count) sumSq += samples[i] * samples[i]
    val rms = sqrt(sumSq / count)
    if (rms < 0.005f) return DetectionResult(null, 0.0, rms.toDouble())
    if (targetFrequencies.isEmpty()) return DetectionResult(null, 0.0, rms.toDouble())

    val scores = targetFrequencies.map { goertzelPower(samples, count, it) }
    val totalScore = scores.sum()
    if (totalScore <= 0f) return DetectionResult(null, 0.0, rms.toDouble())

    val selection = chooseWinningNote(scores)
    val confidence = selection.supportScore.toDouble() / totalScore.toDouble()

    if (confidence < confidenceThresholds[selection.noteIndex].toDouble()) {
      return DetectionResult(null, confidence, rms.toDouble())
    }

    return DetectionResult(targetFrequencies[selection.noteIndex].toDouble(), confidence, rms.toDouble())
  }
}
