import ExpoModulesCore
import AVFoundation

public class HarmonicaAudioModule: Module {
  private var audioEngine: AVAudioEngine?
  private var targetFrequencies: [Float] = []
  private var confidenceThresholds: [Float] = []

  public func definition() -> ModuleDefinition {
    Name("HarmonicaAudio")

    Events("onAudioFrame")

    // Starts microphone capture. Accepts the target frequencies and per-note
    // confidence thresholds from the JS vocabulary so detection runs natively
    // without sending raw PCM across the bridge.
    AsyncFunction("start") { (frequencies: [Double], thresholds: [Double]) throws -> [String: Any] in
      self.targetFrequencies = frequencies.map { Float($0) }
      self.confidenceThresholds = thresholds.map { Float($0) }
      let sampleRate = try self.startCapture()
      return ["sampleRate": sampleRate]
    }

    Function("stop") {
      self.stopCapture()
    }
  }

  // MARK: - Capture lifecycle

  private func startCapture() throws -> Double {
    stopCapture()

    let session = AVAudioSession.sharedInstance()
    try session.setCategory(.record, mode: .measurement, options: [])
    try session.setActive(true)

    let engine = AVAudioEngine()
    let inputNode = engine.inputNode
    // Use the hardware's native format — avoids an extra conversion step.
    let format = inputNode.outputFormat(forBus: 0)
    let sampleRate = format.sampleRate

    // bufferSize is a suggestion; the OS may give smaller or larger buffers.
    inputNode.installTap(onBus: 0, bufferSize: 4096, format: format) { [weak self] buffer, _ in
      guard let self = self,
            let channelData = buffer.floatChannelData?[0] else { return }
      let count = Int(buffer.frameLength)
      let samples = Array(UnsafeBufferPointer(start: channelData, count: count))
      let result = self.detectNote(samples: samples, sampleRate: sampleRate)
      // frequency is Double? — nil becomes null in JavaScript via NSNull bridging.
      self.sendEvent("onAudioFrame", [
        "frequency": result.frequency as Any,
        "confidence": result.confidence,
        "rms": result.rms,
      ])
    }

    try engine.start()
    self.audioEngine = engine
    return sampleRate
  }

  private func stopCapture() {
    audioEngine?.inputNode.removeTap(onBus: 0)
    audioEngine?.stop()
    audioEngine = nil
    try? AVAudioSession.sharedInstance().setActive(false)
  }

  // MARK: - Goertzel pitch detection
  //
  // Mirrors the algorithm in src/logic/fft-detector.ts exactly.
  // Only the fundamental is scored (no harmonic weighting) to avoid
  // sub-octave misdetection — see fft-detector.ts for the full rationale.

  private func goertzelPower(samples: [Float], targetFreq: Float, sampleRate: Float) -> Float {
    let omega = 2.0 * Float.pi * targetFreq / sampleRate
    let coeff = 2.0 * cos(omega)
    var s1: Float = 0
    var s2: Float = 0
    for sample in samples {
      let s = sample + coeff * s1 - s2
      s2 = s1
      s1 = s
    }
    return s2 * s2 + s1 * s1 - coeff * s1 * s2
  }

  private func detectNote(
    samples: [Float],
    sampleRate: Double
  ) -> (frequency: Double?, confidence: Double, rms: Double) {
    // Silence gate
    var sumSq: Float = 0
    for s in samples { sumSq += s * s }
    let rms = sqrt(sumSq / Float(samples.count))
    // Raw iOS microphone (no AGC) is ~3–5× quieter than browser getUserMedia.
    // Lower notes on a harmonica peak around 0.0015 RMS on device.
    guard rms >= 0.001 else { return (nil, 0, Double(rms)) }
    guard !targetFrequencies.isEmpty else { return (nil, 0, Double(rms)) }

    let sr = Float(sampleRate)
    let scores = targetFrequencies.map { freq in
      goertzelPower(samples: samples, targetFreq: freq, sampleRate: sr)
    }

    let totalScore = scores.reduce(0, +)
    guard totalScore > 0 else { return (nil, 0, Double(rms)) }

    var bestIdx = 0
    var bestScore: Float = scores[0]
    for i in 1..<scores.count {
      if scores[i] > bestScore {
        bestScore = scores[i]
        bestIdx = i
      }
    }

    let confidence = Double(bestScore / totalScore)
    guard confidence >= Double(confidenceThresholds[bestIdx]) else {
      return (nil, confidence, Double(rms))
    }

    return (Double(targetFrequencies[bestIdx]), confidence, Double(rms))
  }
}
