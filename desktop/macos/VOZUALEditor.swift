import AppKit
import AVFoundation
import Foundation

private let repository = URL(fileURLWithPath: "/Users/jflorezgaleano/Documents/JulianFlorez/ManoSpeak")
private let python = URL(fileURLWithPath: "/private/tmp/manospeak-capture-venv/bin/python")
private let editor = repository.appendingPathComponent("ml/src/sign_authoring_editor.py")

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
            message: "No se encontró el entorno local de Python."
        )
        NSApplication.shared.terminate(nil)
        return
    }
    guard FileManager.default.fileExists(atPath: editor.path) else {
        showAlert(
            title: "VOZUAL no puede iniciar",
            message: "No se encontró el proyecto ManoSpeak en su ubicación original."
        )
        NSApplication.shared.terminate(nil)
        return
    }

    let library = FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask)[0]
    let logDirectory = library.appendingPathComponent("Logs/VOZUAL")
    let cacheDirectory = library.appendingPathComponent("Caches/VOZUAL/matplotlib")
    try? FileManager.default.createDirectory(
        at: logDirectory,
        withIntermediateDirectories: true
    )
    try? FileManager.default.createDirectory(
        at: cacheDirectory,
        withIntermediateDirectories: true
    )
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
    process.environment = environment
    if let logHandle = try? FileHandle(forWritingTo: log) {
        try? logHandle.seekToEnd()
        process.standardOutput = logHandle
        process.standardError = logHandle
    }
    process.terminationHandler = { _ in
        DispatchQueue.main.async {
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
application.setActivationPolicy(.regular)
application.activate(ignoringOtherApps: true)
DispatchQueue.main.async {
    requestCameraAndLaunch()
}
application.run()
