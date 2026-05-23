import ExpoModulesCore
import AVFoundation

public class HarmonicaAudioModule: Module {
  private var audioEngine: AVAudioEngine?
  private var sampleAccumulator: [Float] = []
  private let targetFrameCount = 4096

  // Producer-side rate limit. The Expo event bridge is an unbounded FIFO; if we
  // emit faster than JS can drain, the queue compounds and latency grows without
  // recovering. Capping emit rate here bounds the queue regardless of JS speed.
  private var lastSentAtMs: Double = 0
  private var minSendIntervalMs: Double = 50

  public func definition() -> ModuleDefinition {
    Name("HarmonicaAudio")

    Events("onAudioFrame")

    // Starts microphone capture. Returns the hardware sample rate so JS can
    // pass it to the pitch detector. No frequencies or thresholds needed here —
    // all detection logic runs in TypeScript.
    AsyncFunction("start") { () throws -> [String: Any] in
      let sampleRate = try self.startCapture()
      return ["sampleRate": sampleRate]
    }

    Function("stop") {
      self.stopCapture()
    }

    // Temporary debug control: live-tunable producer-side rate limit so the
    // floor can be found without a native rebuild per candidate value.
    Function("setMinSendIntervalMs") { (ms: Double) in
      self.minSendIntervalMs = ms
    }
  }

  // MARK: - Capture lifecycle

  private func startCapture() throws -> Double {
    stopCapture()

    let session = AVAudioSession.sharedInstance()
    try session.setCategory(.record, mode: .default, options: [])
    try session.setActive(true)

    let engine = AVAudioEngine()
    let inputNode = engine.inputNode
    let format = inputNode.outputFormat(forBus: 0)
    let sampleRate = format.sampleRate

    // AVAudioEngine may deliver buffers smaller than requested (256–1024 samples
    // is common). We accumulate into a fixed-size frame before sending to JS so
    // the TypeScript YIN detector always receives exactly 4096 samples —
    // matching the buffer size used by the web audio path.
    inputNode.installTap(onBus: 0, bufferSize: 4096, format: format) { [weak self] buffer, _ in
      guard let self = self,
            let channelData = buffer.floatChannelData?[0] else { return }
      let count = Int(buffer.frameLength)
      let incoming = Array(UnsafeBufferPointer(start: channelData, count: count))

      self.sampleAccumulator.append(contentsOf: incoming)

      let nowMs = Date().timeIntervalSince1970 * 1000
      if self.sampleAccumulator.count >= self.targetFrameCount,
         nowMs - self.lastSentAtMs >= self.minSendIntervalMs {
        self.lastSentAtMs = nowMs
        let frame = Array(self.sampleAccumulator.suffix(self.targetFrameCount))
        self.sampleAccumulator.removeAll(keepingCapacity: true)

        self.sendEvent("onAudioFrame", [
          "samples": frame,
          "sampleRate": sampleRate,
          "capturedAt": nowMs,
        ])
      }
    }

    try engine.start()
    self.audioEngine = engine
    return sampleRate
  }

  private func stopCapture() {
    audioEngine?.inputNode.removeTap(onBus: 0)
    audioEngine?.stop()
    audioEngine = nil
    sampleAccumulator = []
    lastSentAtMs = 0
    try? AVAudioSession.sharedInstance().setActive(false)
  }
}
