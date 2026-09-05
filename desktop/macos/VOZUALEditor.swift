import AppKit
import AVFoundation
import Foundation
import WebKit

private let repository = URL(fileURLWithPath: "/Users/jflorezgaleano/Documents/JulianFlorez/Vozual")
private let python = repository.appendingPathComponent("ml/.venv-editor/bin/python")
private let editor = repository.appendingPathComponent("ml/src/sign_authoring_editor.py")

private final class EmbeddedPreviewController: NSObject, NSWindowDelegate, WKNavigationDelegate {
    private let requestURL: URL
    private let responseURL: URL
    private var timer: Timer?
    private var lastRequestNonce: String?
    private var activeNonce: String?
    private var window: NSWindow?
    private var webView: WKWebView?

    init(requestURL: URL, responseURL: URL) {
        self.requestURL = requestURL
        self.responseURL = responseURL
    }

    func start() {
        let timer = Timer(timeInterval: 0.2, repeats: true) { [weak self] _ in
            self?.pollForPreviewRequest()
        }
        RunLoop.main.add(timer, forMode: .common)
        self.timer = timer
    }

    private func pollForPreviewRequest() {
        guard
            let data = try? Data(contentsOf: requestURL),
            let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let nonce = payload["nonce"] as? String,
            nonce != lastRequestNonce,
            let urlText = payload["url"] as? String,
            let url = URL(string: urlText)
        else {
            return
        }
        lastRequestNonce = nonce
        activeNonce = nonce
        showPreview(url: url, title: payload["title"] as? String)
    }

    private func showPreview(url: URL, title: String?) {
        let activeWindow: NSWindow
        let activeWebView: WKWebView
        if let window, let webView {
            activeWindow = window
            activeWebView = webView
        } else {
            let configuration = WKWebViewConfiguration()
            configuration.mediaTypesRequiringUserActionForPlayback = []
            let webView = WKWebView(frame: .zero, configuration: configuration)
            webView.navigationDelegate = self

            let visibleFrame = NSScreen.main?.visibleFrame
                ?? NSRect(x: 0, y: 0, width: 1400, height: 900)
            let window = NSWindow(
                contentRect: visibleFrame,
                styleMask: [.titled, .closable],
                backing: .buffered,
                defer: false
            )
            window.isReleasedWhenClosed = false
            window.isMovable = false
            window.isMovableByWindowBackground = false
            window.tabbingMode = .disallowed
            window.collectionBehavior = [.fullScreenPrimary]
            window.contentView = webView
            window.delegate = self
            self.window = window
            self.webView = webView
            activeWindow = window
            activeWebView = webView
        }

        activeWindow.title = "VOZUAL · \(title ?? "Editor de señas")"
        let visibleFrame = activeWindow.screen?.visibleFrame
            ?? NSScreen.main?.visibleFrame
            ?? NSRect(x: 0, y: 0, width: 1400, height: 900)
        activeWindow.setFrame(visibleFrame, display: true, animate: false)
        activeWebView.load(
            URLRequest(
                url: url,
                cachePolicy: .reloadIgnoringLocalCacheData,
                timeoutInterval: 30
            )
        )
        activeWindow.makeKeyAndOrderFront(nil)
        NSApplication.shared.activate(ignoringOtherApps: true)
    }

    func windowWillClose(_ notification: Notification) {
        guard let nonce = activeNonce else {
            return
        }
        let payload: [String: Any] = ["nonce": nonce, "closed": true]
        if let data = try? JSONSerialization.data(withJSONObject: payload) {
            try? data.write(to: responseURL, options: .atomic)
        }
        activeNonce = nil
        webView?.stopLoading()
        webView = nil
        window = nil
    }

    func webView(
        _ webView: WKWebView,
        didFailProvisionalNavigation navigation: WKNavigation!,
        withError error: Error
    ) {
        showAlert(
            title: "VOZUAL no pudo abrir la simulación",
            message: error.localizedDescription
        )
    }
}

private var embeddedPreviewController: EmbeddedPreviewController?

private func showAlert(title: String, message: String, openSettings: Bool = false) {
    let alert = NSAlert()
    alert.alertStyle = .critical
    alert.messageText = title
    alert.informativeText = message
    alert.addButton(withTitle: "Aceptar")
    if openSettings {
        alert.addButton(withTitle: "Abrir Privacidad y Seguridad")
    }
    let response = alert.runModal()
    if openSettings && response == .alertSecondButtonReturn {
        let settings = URL(
            string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Camera"
        )!
        NSWorkspace.shared.open(settings)
    }
}

private func launchEditor() {
    guard FileManager.default.isExecutableFile(atPath: python.path) else {
        showAlert(
            title: "VOZUAL no puede iniciar",
            message: "No se encontró el entorno permanente del editor. Vuelve a ejecutar desktop/macos/build_app.sh."
        )
        NSApplication.shared.terminate(nil)
        return
    }
    guard FileManager.default.fileExists(atPath: editor.path) else {
        showAlert(
            title: "VOZUAL no puede iniciar",
            message: "No se encontró el proyecto Vozual en su ubicación original."
        )
        NSApplication.shared.terminate(nil)
        return
    }

    let library = FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask)[0]
    let logDirectory = library.appendingPathComponent("Logs/VOZUAL")
    let cacheRoot = library.appendingPathComponent("Caches/VOZUAL")
    let cacheDirectory = cacheRoot.appendingPathComponent("matplotlib")
    let bridgeIdentifier = String(ProcessInfo.processInfo.processIdentifier)
    let previewRequest = cacheRoot.appendingPathComponent(
        "embedded-preview-request-\(bridgeIdentifier).json"
    )
    let previewResponse = cacheRoot.appendingPathComponent(
        "embedded-preview-response-\(bridgeIdentifier).json"
    )
    try? FileManager.default.createDirectory(
        at: logDirectory,
        withIntermediateDirectories: true
    )
    try? FileManager.default.createDirectory(
        at: cacheDirectory,
        withIntermediateDirectories: true
    )
    try? FileManager.default.removeItem(at: previewRequest)
    try? FileManager.default.removeItem(at: previewResponse)
    embeddedPreviewController = EmbeddedPreviewController(
        requestURL: previewRequest,
        responseURL: previewResponse
    )
    embeddedPreviewController?.start()
    let log = logDirectory.appendingPathComponent("editor.log")
    if !FileManager.default.fileExists(atPath: log.path) {
        FileManager.default.createFile(atPath: log.path, contents: nil)
    }

    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/usr/bin/arch")
    process.arguments = ["-arm64", python.path, editor.path]
    process.currentDirectoryURL = repository
    var environment = ProcessInfo.processInfo.environment
    environment["MPLCONFIGDIR"] = cacheDirectory.path
    environment["VOZUAL_EMBEDDED_PREVIEW_REQUEST"] = previewRequest.path
    environment["VOZUAL_EMBEDDED_PREVIEW_RESPONSE"] = previewResponse.path
    process.environment = environment
    if let logHandle = try? FileHandle(forWritingTo: log) {
        try? logHandle.seekToEnd()
        process.standardOutput = logHandle
        process.standardError = logHandle
    }
    process.terminationHandler = { _ in
        DispatchQueue.main.async {
            try? FileManager.default.removeItem(at: previewRequest)
            try? FileManager.default.removeItem(at: previewResponse)
            NSApplication.shared.terminate(nil)
        }
    }
    do {
        try process.run()
    } catch {
        showAlert(title: "VOZUAL no pudo abrir el editor", message: error.localizedDescription)
        NSApplication.shared.terminate(nil)
    }
}

private func requestCameraAndLaunch() {
    switch AVCaptureDevice.authorizationStatus(for: .video) {
    case .authorized:
        launchEditor()
    case .notDetermined:
        AVCaptureDevice.requestAccess(for: .video) { granted in
            DispatchQueue.main.async {
                if granted {
                    launchEditor()
                } else {
                    showAlert(
                        title: "VOZUAL necesita acceso a la cámara",
                        message: "Activa VOZUAL Editor de Señas en Privacidad y Seguridad > Cámara.",
                        openSettings: true
                    )
                    NSApplication.shared.terminate(nil)
                }
            }
        }
    case .denied, .restricted:
        showAlert(
            title: "VOZUAL necesita acceso a la cámara",
            message: "Activa VOZUAL Editor de Señas en Privacidad y Seguridad > Cámara.",
            openSettings: true
        )
        NSApplication.shared.terminate(nil)
    @unknown default:
        showAlert(title: "No se pudo consultar el permiso de cámara", message: "Inténtalo nuevamente.")
        NSApplication.shared.terminate(nil)
    }
}

let application = NSApplication.shared
application.setActivationPolicy(.accessory)
application.activate(ignoringOtherApps: true)
DispatchQueue.main.async {
    requestCameraAndLaunch()
}
application.run()
