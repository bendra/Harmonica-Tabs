import ExpoModulesCore
import AVFoundation

public class HarmonicaAudioModule: Module {
  private var audioEngine: AVAudioEngine?
  private var sampleAccumulator: [Float] = []
  private let targetFrameCount = 4096

  // Throttle: emit at most one frame every 150 ms so the JS bridge event queue
  // never builds up. The JS thread (React + YIN detection) runs on the same
  // thread as the bridge dispatcher; if we emit faster than JS can process,
  // events queue up and latency grows unboundedly over time.
  private let minFrameIntervalSeconds: TimeInterval = 0.04
  private var lastFrameSentAt: Date = .distantPast

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
  }

  // MARK: - Capture lifecycle

  private func startCapture() throws -> Double {
    stopCapture()

    let session = AVAudioSession.sharedInstance()
    try session.setCategory(.record, mode: .measurement, options: [])
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

      if self.sampleAccumulator.count >= self.targetFrameCount {
        let now = Date()
        guard now.timeIntervalSince(self.lastFrameSentAt) >= self.minFrameIntervalSeconds else {
          // Too soon — drop older samples, keeping the freshest audio so the
          // next emitted frame isn't stale.
          let keepCount = self.targetFrameCount - 1
          if self.sampleAccumulator.count > keepCount {
            self.sampleAccumulator = Array(self.sampleAccumulator.suffix(keepCount))
          }
          return
        }
        self.lastFrameSentAt = now

        var frame = Array(self.sampleAccumulator.prefix(self.targetFrameCount))
        self.sampleAccumulator.removeFirst(self.targetFrameCount)

        // AVAudioEngine in .measurement mode delivers samples ~5× quieter than
        // browser getUserMedia (no automatic gain). Scale up so the TypeScript
        // RMS gate (MIN_RMS = 0.005) sees comparable levels to the web path.
        let gain: Float = 5.0
        for i in 0..<frame.count { frame[i] *= gain }

        self.sendEvent("onAudioFrame", [
          "samples": frame,
          "sampleRate": sampleRate,
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
    lastFrameSentAt = .distantPast
    try? AVAudioSession.sharedInstance().setActive(false)
  }
}
