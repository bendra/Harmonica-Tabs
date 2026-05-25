import ExpoModulesCore
import WebKit

private let detectorBaseURL = URL(string: "https://harmonica-tabs.local/")

class HarmonicaAudioView: ExpoView, WKScriptMessageHandler {
  let webView: WKWebView
  let onLoad = EventDispatcher()
  let onWebViewDetectorReady = EventDispatcher()
  let onWebViewDetectorError = EventDispatcher()
  let onWebViewPitchUpdate = EventDispatcher()
  var delegate: WebViewDelegate?
  private var active = false
  private var vocabularyJson = ""
  private var loaded = false
  private var detectorLoadError: String?

  required init(appContext: AppContext? = nil) {
    let contentController = WKUserContentController()
    let configuration = WKWebViewConfiguration()
    configuration.userContentController = contentController
    configuration.allowsInlineMediaPlayback = true
    webView = WKWebView(frame: .zero, configuration: configuration)

    super.init(appContext: appContext)

    clipsToBounds = true
    contentController.add(self, name: "harmonicaAudio")
    delegate = WebViewDelegate(
      onUrlChange: { [weak self] url in
        self?.onLoad(["url": url])
      },
      onLoaded: { [weak self] in
        self?.loaded = true
        self?.applyDetectorState()
      }
    )
    webView.navigationDelegate = delegate
    webView.uiDelegate = delegate
    addSubview(webView)

    if let detectorHtml = Self.loadDetectorHtml() {
      webView.loadHTMLString(detectorHtml, baseURL: detectorBaseURL)
    } else {
      detectorLoadError = "Missing bundled WebView detector resource."
    }
  }

  deinit {
    webView.configuration.userContentController.removeScriptMessageHandler(forName: "harmonicaAudio")
  }

  override func layoutSubviews() {
    webView.frame = bounds
  }

  func setActive(_ nextActive: Bool) {
    active = nextActive
    applyDetectorState()
  }

  func setVocabularyJson(_ nextVocabularyJson: String) {
    vocabularyJson = nextVocabularyJson
    applyDetectorState()
  }

  private static func loadDetectorHtml() -> String? {
    for bundle in candidateResourceBundles() {
      let urls = [
        bundle.url(forResource: "webview-detector", withExtension: "html"),
        bundle.url(forResource: "webview-detector", withExtension: "html", subdirectory: "Resources")
      ]

      for url in urls {
        guard let url = url,
              let contents = try? String(contentsOf: url, encoding: .utf8) else {
          continue
        }
        return contents
      }
    }
    return nil
  }

  private static func candidateResourceBundles() -> [Bundle] {
    let baseBundles = [Bundle(for: HarmonicaAudioView.self), Bundle.main] + Bundle.allBundles
    var bundles = baseBundles

    for bundle in baseBundles {
      for resourceBundleName in ["HarmonicaAudio", "HarmonicaAudioResources"] {
        guard let url = bundle.url(forResource: resourceBundleName, withExtension: "bundle"),
              let resourceBundle = Bundle(url: url) else {
          continue
        }
        bundles.append(resourceBundle)
      }
    }

    return bundles
  }

  private func escapedJavaScriptString(_ value: String) -> String {
    guard let data = try? JSONSerialization.data(withJSONObject: [value], options: []),
          let encoded = String(data: data, encoding: .utf8) else {
      return "''"
    }
    return String(encoded.dropFirst().dropLast())
  }

  private func applyDetectorState() {
    if active, let detectorLoadError = detectorLoadError {
      onWebViewDetectorError(["message": detectorLoadError])
      return
    }

    guard loaded else { return }
    let vocabulary = escapedJavaScriptString(vocabularyJson)
    webView.evaluateJavaScript("window.HarmonicaDetector && window.HarmonicaDetector.updateVocabulary(\(vocabulary));")
    webView.evaluateJavaScript("window.HarmonicaDetector && window.HarmonicaDetector.\(active ? "start" : "stop")();")
  }

  func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
    guard let body = message.body as? [String: Any],
          let type = body["type"] as? String else {
      return
    }

    if type == "ready" {
      onWebViewDetectorReady(["supported": body["supported"] as? Bool ?? true])
      return
    }

    if type == "error" {
      onWebViewDetectorError(["message": body["message"] as? String ?? "WebView detector error"])
      return
    }

    if type == "pitch", let payload = body["payload"] as? [String: Any] {
      onWebViewPitchUpdate(payload)
    }
  }
}

class WebViewDelegate: NSObject, WKNavigationDelegate, WKUIDelegate {
  let onUrlChange: (String) -> Void
  let onLoaded: () -> Void

  init(onUrlChange: @escaping (String) -> Void, onLoaded: @escaping () -> Void) {
    self.onUrlChange = onUrlChange
    self.onLoaded = onLoaded
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation) {
    if let url = webView.url {
      onUrlChange(url.absoluteString)
    }
    onLoaded()
  }

  @available(iOS 15.0, *)
  func webView(
    _ webView: WKWebView,
    requestMediaCapturePermissionFor origin: WKSecurityOrigin,
    initiatedByFrame frame: WKFrameInfo,
    type: WKMediaCaptureType,
    decisionHandler: @escaping (WKPermissionDecision) -> Void
  ) {
    if type == .microphone {
      decisionHandler(.grant)
    } else {
      decisionHandler(.prompt)
    }
  }
}
