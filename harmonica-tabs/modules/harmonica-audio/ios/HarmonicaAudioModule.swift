import ExpoModulesCore
import AVFoundation

public class HarmonicaAudioModule: Module {
  private var audioEngine: AVAudioEngine?
  private var targetFrequencies: [Float] = []
  private var confidenceThresholds: [Float] = []
  private var hasLoggedFirstFrame = false

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
      if !self.hasLoggedFirstFrame {
        self.hasLoggedFirstFrame = true
        print("[HarmonicaAudio] first frame — sampleRate: \(sampleRate), bufferSize: \(count)")
      }
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
    hasLoggedFirstFrame = false
    try? AVAudioSession.sharedInstance().setActive(false)
  }

  // MARK: - YIN pitch detection
  //
  // Mirrors the algorithm in src/logic/fft-detector.ts exactly.
  // YIN finds the shortest repeating period of the waveform (the true
  // fundamental) rather than scoring energy at known frequencies. This
  // avoids the sub-harmonic octave errors that plagued Goertzel.

  private let yinThreshold: Float = 0.10

  /// Step 1: difference function d[τ] = Σ (x[j] - x[j+τ])²
  private func yinDifference(samples: [Float], maxLag: Int) -> [Float] {
    let W = samples.count / 2
    var d = [Float](repeating: 0, count: maxLag + 1)
    for tau in 1...maxLag {
      var sum: Float = 0
      for j in 0..<W {
        let delta = samples[j] - samples[j + tau]
        sum += delta * delta
      }
      d[tau] = sum
    }
    return d
  }

  /// Step 2: cumulative mean normalized difference.
  /// d'[τ] = d[τ] × τ / Σ_{j=1}^{τ} d[j]
  /// Suppresses sub-octave peaks so the true fundamental wins.
  private func yinCmnd(d: [Float]) -> [Float] {
    var cmnd = [Float](repeating: 0, count: d.count)
    cmnd[0] = 1
    var runningSum: Float = 0
    for tau in 1..<d.count {
      runningSum += d[tau]
      cmnd[tau] = runningSum == 0 ? 0 : (d[tau] * Float(tau)) / runningSum
    }
    return cmnd
  }

  /// Step 4: parabolic interpolation for sub-sample lag precision.
  private func parabolicInterp(cmnd: [Float], tau: Int) -> Float {
    guard tau > 0 && tau < cmnd.count - 1 else { return Float(tau) }
    let prev = cmnd[tau - 1], curr = cmnd[tau], next = cmnd[tau + 1]
    let denom = 2 * (prev - 2 * curr + next)
    guard denom != 0 else { return Float(tau) }
    return Float(tau) + (prev - next) / denom
  }

  /// Returns the detected fundamental frequency in Hz, or nil if none found.
  private func yinDetect(samples: [Float], sampleRate: Float, minFreq: Float, maxFreq: Float) -> Float? {
    let minLag = Int(sampleRate / maxFreq) // shortest period = highest freq
    let maxLag = Int(sampleRate / minFreq) // longest  period = lowest  freq
    guard samples.count >= maxLag * 2 else { return nil }

    let d = yinDifference(samples: samples, maxLag: maxLag)
    let cmnd = yinCmnd(d: d)

    var tau = minLag
    while tau <= maxLag {
      if cmnd[tau] < yinThreshold {
        while tau + 1 <= maxLag && cmnd[tau + 1] < cmnd[tau] { tau += 1 }
        let refined = parabolicInterp(cmnd: cmnd, tau: tau)
        return sampleRate / refined
      }
      tau += 1
    }
    return nil
  }

  private func detectNote(
    samples: [Float],
    sampleRate: Double
  ) -> (frequency: Double?, confidence: Double, rms: Double) {
    // Silence gate — raw iOS mic is ~3–5× quieter than browser getUserMedia.
    var sumSq: Float = 0
    for s in samples { sumSq += s * s }
    let rms = sqrt(sumSq / Float(samples.count))
    guard rms >= 0.001 else { return (nil, 0, Double(rms)) }
    guard !targetFrequencies.isEmpty else { return (nil, 0, Double(rms)) }

    let sr = Float(sampleRate)
    // 10% margin gives parabolic interpolation room at the edges.
    let minFreq = targetFrequencies.first! * 0.9
    let maxFreq = targetFrequencies.last!  * 1.1

    guard let fundamental = yinDetect(samples: samples, sampleRate: sr, minFreq: minFreq, maxFreq: maxFreq) else {
      return (nil, 0, Double(rms))
    }

    // Convert to fractional MIDI for cent-accurate distance comparisons.
    let detectedMidi = 69.0 + 12.0 * log2(fundamental / 440.0)

    // Find the nearest vocabulary note by MIDI distance.
    var nearestIdx = 0
    var nearestCents = Float.infinity
    for i in 0..<targetFrequencies.count {
      let noteMidi = 69.0 + 12.0 * log2(targetFrequencies[i] / 440.0)
      let cents = abs((detectedMidi - noteMidi) * 100.0)
      if cents < nearestCents {
        nearestCents = cents
        nearestIdx = i
      }
    }

    // Acceptance window — mirrors centsTolerance() in fft-detector.ts.
    // Higher threshold (bends/overblows) → tighter window.
    let threshold = confidenceThresholds[nearestIdx]
    let tolerance = (50.0 * (1.0 - threshold)) / 0.7
    guard nearestCents <= tolerance else { return (nil, 0, Double(rms)) }

    let confidence = Double(1.0 - nearestCents / tolerance)
    return (Double(targetFrequencies[nearestIdx]), confidence, Double(rms))
  }
}
