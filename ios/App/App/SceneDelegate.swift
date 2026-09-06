import UIKit
import Capacitor
import WebKit

/// The web view the game lives in, with the two concessions iOS only grants on ask.
///
/// Defined here rather than in a file of its own because the Xcode project lists its
/// sources by hand, and a new file means four hand-edits to `project.pbxproj` that
/// `cap sync` would have no part in keeping correct. This is the one place that
/// installs a root view controller, so it is a reasonable place to say what one is.
class GameViewController: CAPBridgeViewController {
    /// The status bar is a clock drawn over an arena. The game already fills the
    /// screen and has its own pause button; the time of day is not what anyone is
    /// looking for mid-fight.
    override var prefersStatusBarHidden: Bool {
        true
    }

    // The home indicator would go the same way, but `prefersHomeIndicatorAutoHidden`
    // is `public` rather than `open` on `CAPBridgeViewController` — Capacitor owns
    // that answer and will not take ours. It stays visible, and the HUD keeps clear of
    // it on the strength of the insets published below.

    /// The virtual stick is the whole lower half of the screen, so a thumb steering
    /// downward starts exactly the swipe that means "leave the app". Deferring the
    /// bottom edge costs a player who genuinely wants out a second swipe, and saves
    /// everyone else the run they would have lost to a dodge.
    override var preferredScreenEdgesDeferringSystemGestures: UIRectEdge {
        [.bottom]
    }

    // MARK: - Safe area

    /**
     Hand the safe-area insets to the web layer as CSS custom properties.

     The web side would rather read `env(safe-area-inset-*)` and never involve Swift at
     all, and on a real browser it does. Inside this web view it cannot: Capacitor makes
     the WKWebView the root view of this controller, and WebKit then reports every
     `env(safe-area-inset-*)` as `0px` even under `viewport-fit=cover` — verified on an
     iPhone 17 Pro simulator, in both orientations, with the Dynamic Island sitting
     visibly on top of content the page believed was in the clear.

     So the values come from the one place that does know them. `--safe-area-inset-*`
     is what `src/core/safe-area.ts` reads first, falling back to `env()` for builds
     that run outside this shell.
     */
    override func viewSafeAreaInsetsDidChange() {
        super.viewSafeAreaInsetsDidChange()
        publishSafeAreaInsets()
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        // Rotation and the first load both land here, and the insets are only final
        // once layout is. Re-publishing is a few string interpolations on a path that
        // runs a handful of times per session, not per frame.
        publishSafeAreaInsets()
    }

    /// Layout finishes long before the page does. Every publish driven by the two hooks
    /// above runs against a web view with no document in it, and `evaluateJavaScript`
    /// on an empty web view fails quietly — then the real document loads and starts
    /// life with no variables set at all. So the load itself has to be a trigger too,
    /// and it is the only one that fires on a launch nobody rotates.
    private var loadObservation: NSKeyValueObservation?

    override func viewDidLoad() {
        super.viewDidLoad()
        loadObservation = webView?.observe(\.isLoading, options: [.new]) { [weak self] _, change in
            guard change.newValue == false else { return }
            self?.publishSafeAreaInsets()
        }
    }

    private func publishSafeAreaInsets() {
        guard let webView else { return }
        let insets = webView.safeAreaInsets

        // The resize event is not decoration: the renderer re-reads the insets when the
        // viewport changes, and on a launch that never rotates this is the only signal
        // that the real values have arrived. Without it the first run of the session
        // would lay its HUD out as though the notch were not there.
        let js = """
        (function () {
          var s = document.documentElement.style;
          s.setProperty('--safe-area-inset-top', '\(insets.top)px');
          s.setProperty('--safe-area-inset-right', '\(insets.right)px');
          s.setProperty('--safe-area-inset-bottom', '\(insets.bottom)px');
          s.setProperty('--safe-area-inset-left', '\(insets.left)px');
          window.dispatchEvent(new Event('resize'));
        })();
        """
        webView.evaluateJavaScript(js)
    }
}

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = GameViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}
