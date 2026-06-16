import AppKit
import AVFoundation
import WebKit

final class GameWindowController: NSWindowController, WKUIDelegate, WKNavigationDelegate, WKScriptMessageHandler {
    private let webView: WKWebView

    init() {
        let configuration = WKWebViewConfiguration()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true
        configuration.mediaTypesRequiringUserActionForPlayback = []
        configuration.userContentController.addUserScript(
            WKUserScript(
                source: """
                window.addEventListener('error', event => {
                  window.webkit.messageHandlers.appLog.postMessage('JavaScript error: ' + event.message);
                });
                window.addEventListener('unhandledrejection', event => {
                  window.webkit.messageHandlers.appLog.postMessage('Promise error: ' + String(event.reason));
                });
                """,
                injectionTime: .atDocumentStart,
                forMainFrameOnly: true
            )
        )

        webView = WKWebView(frame: .zero, configuration: configuration)

        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1280, height: 820),
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        window.title = "Gesture Arcade"
        window.titlebarAppearsTransparent = true
        window.titleVisibility = .hidden
        window.backgroundColor = .white
        window.minSize = NSSize(width: 900, height: 650)
        window.center()
        window.contentView = webView

        super.init(window: window)
        configuration.userContentController.add(self, name: "appLog")
        webView.uiDelegate = self
        webView.navigationDelegate = self
        loadGame()
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        NSLog("Gesture Arcade: %@", String(describing: message.body))
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    private func loadGame() {
        guard
            let resourcesURL = Bundle.main.resourceURL,
            let indexURL = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "Web")
        else {
            showError("游戏资源未找到，请重新安装应用。")
            return
        }

        webView.loadFileURL(indexURL, allowingReadAccessTo: resourcesURL)
    }

    private func showError(_ message: String) {
        let alert = NSAlert()
        alert.messageText = "Gesture Arcade 无法启动"
        alert.informativeText = message
        alert.runModal()
    }

    @available(macOS 12.0, *)
    func webView(
        _ webView: WKWebView,
        requestMediaCapturePermissionFor origin: WKSecurityOrigin,
        initiatedByFrame frame: WKFrameInfo,
        type: WKMediaCaptureType,
        decisionHandler: @escaping (WKPermissionDecision) -> Void
    ) {
        AVCaptureDevice.requestAccess(for: .video) { granted in
            DispatchQueue.main.async {
                decisionHandler(granted ? .grant : .deny)
            }
        }
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var gameWindowController: GameWindowController?

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.appearance = NSAppearance(named: .aqua)
        configureMenu()
        gameWindowController = GameWindowController()
        gameWindowController?.showWindow(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }

    private func configureMenu() {
        let mainMenu = NSMenu()
        let appMenuItem = NSMenuItem()
        mainMenu.addItem(appMenuItem)

        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "关于 Gesture Arcade", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(NSMenuItem.separator())
        appMenu.addItem(withTitle: "退出 Gesture Arcade", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appMenuItem.submenu = appMenu
        NSApp.mainMenu = mainMenu
    }
}

let application = NSApplication.shared
let delegate = AppDelegate()
application.delegate = delegate
application.setActivationPolicy(.regular)
application.run()
