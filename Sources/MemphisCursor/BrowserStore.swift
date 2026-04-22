import Foundation
import SwiftUI
import WebKit

enum OverlayApp: String, CaseIterable, Identifiable {
    case browser
    case notes
    case links

    var id: String { rawValue }

    var title: String {
        switch self {
        case .browser:
            return "Browser"
        case .notes:
            return "Notes"
        case .links:
            return "Links"
        }
    }

    var systemImage: String {
        switch self {
        case .browser:
            return "globe"
        case .notes:
            return "note.text"
        case .links:
            return "sparkles"
        }
    }
}

@MainActor
final class BrowserStore: NSObject, ObservableObject {
    @Published var selectedApp: OverlayApp = .browser
    @Published var addressText = ""
    @Published private(set) var pageTitle = "Loiterly Browser"
    @Published private(set) var canGoBack = false
    @Published private(set) var canGoForward = false
    @Published private(set) var isLoading = false

    let webView: WKWebView

    private var observations: [NSKeyValueObservation] = []
    private let lastURLKey = "overlay.browser.lastURL"

    override init() {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true
        configuration.preferences = {
            let preferences = WKPreferences()
            preferences.javaScriptCanOpenWindowsAutomatically = true
            return preferences
        }()

        webView = WKWebView(frame: .zero, configuration: configuration)
        super.init()

        webView.allowsBackForwardNavigationGestures = true
        webView.setValue(false, forKey: "drawsBackground")
        webView.uiDelegate = self
        webView.navigationDelegate = self
        installObservers()
        loadInitialPage()
    }

    func openSelection() {
        guard selectedApp == .browser else {
            return
        }

        loadAddress(addressText)
    }

    func loadAddress(_ rawValue: String) {
        let trimmed = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            return
        }

        let requestURL: URL?
        if let explicitURL = normalizedURL(from: trimmed) {
            requestURL = explicitURL
        } else {
            requestURL = searchURL(for: trimmed)
        }

        guard let requestURL else {
            return
        }

        addressText = requestURL.absoluteString
        webView.load(URLRequest(url: requestURL))
    }

    func goBack() {
        guard webView.canGoBack else {
            return
        }
        webView.goBack()
    }

    func goForward() {
        guard webView.canGoForward else {
            return
        }
        webView.goForward()
    }

    func reload() {
        webView.reload()
    }

    private func installObservers() {
        observations = [
            webView.observe(\.url, options: [.initial, .new]) { [weak self] view, _ in
                Task { @MainActor [weak self] in
                    guard let self else { return }
                    let currentURL = view.url?.absoluteString ?? ""
                    if !currentURL.isEmpty {
                        self.addressText = currentURL
                        UserDefaults.standard.set(currentURL, forKey: self.lastURLKey)
                    }
                }
            },
            webView.observe(\.title, options: [.initial, .new]) { [weak self] view, _ in
                Task { @MainActor [weak self] in
                    self?.pageTitle = view.title ?? "Loiterly Browser"
                }
            },
            webView.observe(\.canGoBack, options: [.initial, .new]) { [weak self] view, _ in
                Task { @MainActor [weak self] in
                    self?.canGoBack = view.canGoBack
                }
            },
            webView.observe(\.canGoForward, options: [.initial, .new]) { [weak self] view, _ in
                Task { @MainActor [weak self] in
                    self?.canGoForward = view.canGoForward
                }
            },
            webView.observe(\.isLoading, options: [.initial, .new]) { [weak self] view, _ in
                Task { @MainActor [weak self] in
                    self?.isLoading = view.isLoading
                }
            },
        ]
    }

    private func loadInitialPage() {
        if let savedURL = UserDefaults.standard.string(forKey: lastURLKey), let url = URL(string: savedURL) {
            addressText = savedURL
            webView.load(URLRequest(url: url))
            return
        }

        loadAddress("https://www.google.com")
    }

    private func normalizedURL(from rawValue: String) -> URL? {
        if let directURL = URL(string: rawValue), directURL.scheme != nil {
            return directURL
        }

        if rawValue.contains(" ") {
            return nil
        }

        return URL(string: "https://\(rawValue)")
    }

    private func searchURL(for query: String) -> URL? {
        var components = URLComponents(string: "https://www.google.com/search")
        components?.queryItems = [URLQueryItem(name: "q", value: query)]
        return components?.url
    }
}

extension BrowserStore: WKUIDelegate {
    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        if navigationAction.targetFrame == nil, let url = navigationAction.request.url {
            webView.load(URLRequest(url: url))
        }

        return nil
    }

    func webViewDidClose(_ webView: WKWebView) {
    }

    func webView(
        _ webView: WKWebView,
        runJavaScriptAlertPanelWithMessage message: String,
        initiatedByFrame frame: WKFrameInfo
    ) async {
        let alert = NSAlert()
        alert.messageText = message
        alert.addButton(withTitle: "OK")
        alert.runModal()
    }

    func webView(
        _ webView: WKWebView,
        runJavaScriptConfirmPanelWithMessage message: String,
        initiatedByFrame frame: WKFrameInfo
    ) async -> Bool {
        let alert = NSAlert()
        alert.messageText = message
        alert.addButton(withTitle: "OK")
        alert.addButton(withTitle: "Cancel")
        return alert.runModal() == .alertFirstButtonReturn
    }

    func webView(
        _ webView: WKWebView,
        runJavaScriptTextInputPanelWithPrompt prompt: String,
        defaultText: String?,
        initiatedByFrame frame: WKFrameInfo
    ) async -> String? {
        let alert = NSAlert()
        alert.messageText = prompt
        alert.addButton(withTitle: "OK")
        alert.addButton(withTitle: "Cancel")

        let field = NSTextField(string: defaultText ?? "")
        field.frame = NSRect(x: 0, y: 0, width: 240, height: 24)
        alert.accessoryView = field

        return alert.runModal() == .alertFirstButtonReturn ? field.stringValue : nil
    }
}

extension BrowserStore: WKNavigationDelegate {
    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping @MainActor (WKNavigationActionPolicy) -> Void
    ) {
        if navigationAction.targetFrame == nil, let url = navigationAction.request.url {
            webView.load(URLRequest(url: url))
            decisionHandler(.cancel)
            return
        }

        decisionHandler(.allow)
    }
}
