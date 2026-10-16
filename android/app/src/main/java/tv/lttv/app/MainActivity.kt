package tv.lttv.app

import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.webkit.WebViewAssetLoader
import org.json.JSONObject

/**
 * Hosts the LTTV TV interface (the same web bundle as the desktop app, bundled in
 * assets/www) in a transparent WebView, with native Media3/ExoPlayer video underneath.
 *
 *  - https://appassets.androidplatform.net/ serves the bundled UI (no network needed).
 *  - /api/... on the same origin is answered natively (CORS-free downloads, gzip, uploads).
 *  - JavaScript talks to the player and the device through [NativeBridge] ("LTTVNative").
 *  - Remote keys that the WebView would not deliver reliably (menu, media, channel, back)
 *    are forwarded to the page as app keys.
 */
class MainActivity : AppCompatActivity() {

    lateinit var webView: WebView
        private set
    lateinit var player: PlayerController
        private set
    val updater by lazy { Updater(this) }
    private lateinit var api: ApiHandler
    private lateinit var root: FrameLayout
    /** Multiview tiles (up to 4), created on first use. */
    private val tiles = arrayOfNulls<PlayerController>(4)
    private val main = Handler(Looper.getMainLooper())
    private var setupServer: SetupServer? = null
    private var pendingFileCallback: ValueCallback<Array<Uri>>? = null
    private var resumeOnStart = false

    private val pickFile = registerForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        pendingFileCallback?.onReceiveValue(if (uri != null) arrayOf(uri) else null)
        pendingFileCallback = null
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN)

        root = FrameLayout(this)
        root.setBackgroundColor(Color.parseColor("#0A0D12"))

        player = PlayerController(this) { json -> sendToPage("window.lttvHost && window.lttvHost.onPlayerEvent(${JSONObject.quote(json)})") }
        root.addView(player.view, FrameLayout.LayoutParams(0, 0))

        webView = WebView(this)
        webView.setBackgroundColor(Color.TRANSPARENT)
        webView.isFocusable = true
        webView.isFocusableInTouchMode = true
        root.addView(webView, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        setContentView(root)

        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        with(webView.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            mediaPlaybackRequiresUserGesture = false
            allowFileAccess = false
            allowContentAccess = true
            loadWithOverviewMode = false
            useWideViewPort = false
            setSupportZoom(false)
            builtInZoomControls = false
            // Channel logos are frequently served over plain http.
            mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            cacheMode = WebSettings.LOAD_DEFAULT
            textZoom = 100
        }

        api = ApiHandler(this)
        val assets = WebViewAssetLoader.Builder()
            .setDomain(HOST)
            .addPathHandler("/", WwwPathHandler(this))
            .build()

        webView.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                val url = request.url
                if (url.host == HOST && (url.path ?: "").startsWith("/api/")) return api.handle(url)
                return assets.shouldInterceptRequest(url)
            }

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                // Never navigate away from the app UI.
                return request.url.host != HOST
            }
        }
        webView.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                pendingFileCallback?.onReceiveValue(null)
                pendingFileCallback = callback
                return try {
                    pickFile.launch("*/*")
                    true
                } catch (e: ActivityNotFoundException) {
                    pendingFileCallback = null
                    Toast.makeText(this@MainActivity, "No file browser on this device. Use Sources → Phone/computer setup.", Toast.LENGTH_LONG).show()
                    false
                }
            }
        }
        webView.addJavascriptInterface(NativeBridge(this), "LTTVNative")

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() = sendKey("back")
        })

        if (savedInstanceState == null) webView.loadUrl("https://$HOST/index.html?tv")
        else webView.restoreState(savedInstanceState)
        webView.requestFocus()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        webView.saveState(outState)
    }

    /** Forward remote keys the page needs but WebView doesn't map consistently. */
    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        val name = when (event.keyCode) {
            KeyEvent.KEYCODE_MENU -> "menu"
            KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE, KeyEvent.KEYCODE_HEADSETHOOK -> "playpause"
            KeyEvent.KEYCODE_MEDIA_PLAY -> "play"
            KeyEvent.KEYCODE_MEDIA_PAUSE -> "pause"
            KeyEvent.KEYCODE_CHANNEL_UP -> "chup"
            KeyEvent.KEYCODE_CHANNEL_DOWN -> "chdown"
            KeyEvent.KEYCODE_INFO -> "info"
            KeyEvent.KEYCODE_GUIDE -> "guide"
            KeyEvent.KEYCODE_MEDIA_REWIND -> "rewind"
            KeyEvent.KEYCODE_MEDIA_FAST_FORWARD -> "ffwd"
            else -> null
        }
        if (name != null) {
            // Holding rewind / fast forward keeps skipping (every few repeats).
            val repeatable = name == "rewind" || name == "ffwd"
            if (event.action == KeyEvent.ACTION_DOWN && (event.repeatCount == 0 || (repeatable && event.repeatCount % 4 == 0))) sendKey(name)
            return true
        }
        return super.dispatchKeyEvent(event)
    }

    fun sendKey(name: String) = sendToPage("window.lttvHost && window.lttvHost.onKey(${JSONObject.quote(name)})")

    fun sendToPage(js: String) {
        main.post { if (!isDestroyed) webView.evaluateJavascript(js, null) }
    }

    /** Position the native video surface under the page's video slot (CSS px -> device px). */
    fun setVideoRect(x: Int, y: Int, w: Int, h: Int, visible: Boolean) = placeView({ player.view }, x, y, w, h, visible)

    private fun tile(i: Int): PlayerController {
        tiles[i]?.let { return it }
        val p = PlayerController(this, audioFocus = false) { json ->
            sendToPage("window.lttvHost && window.lttvHost.onMultiviewEvent && window.lttvHost.onMultiviewEvent($i, ${JSONObject.quote(json)})")
        }
        root.addView(p.view, 0, FrameLayout.LayoutParams(0, 0))
        tiles[i] = p
        return p
    }

    fun mvPlay(slot: Int, url: String, headers: Map<String, String>) = main.post {
        if (slot in tiles.indices) tile(slot).play(url, headers)
    }

    fun mvStop(slot: Int) = main.post { if (slot in tiles.indices) tiles[slot]?.stop() }

    fun mvMute(slot: Int, muted: Boolean) = main.post { if (slot in tiles.indices) tiles[slot]?.setVolume(if (muted) 0f else 1f) }

    fun mvRect(slot: Int, x: Int, y: Int, w: Int, h: Int, visible: Boolean) {
        if (slot !in tiles.indices) return
        main.post { tile(slot) }
        placeView({ tiles[slot]?.view }, x, y, w, h, visible)
    }

    fun configurePlayers(bufferSec: Int, timeoutSec: Int, rewindMin: Int = 30) {
        player.configure(bufferSec, timeoutSec, rewindMin)
        for (t in tiles) t?.configure(bufferSec, timeoutSec)
    }

    private fun placeView(view: () -> View?, x: Int, y: Int, w: Int, h: Int, visible: Boolean) {
        main.post {
            val d = resources.displayMetrics.density
            val v = view() ?: return@post
            if (!visible || w <= 0 || h <= 0) {
                v.visibility = View.INVISIBLE
                return@post
            }
            val lp = (v.layoutParams as FrameLayout.LayoutParams)
            lp.width = Math.round(w * d)
            lp.height = Math.round(h * d)
            lp.leftMargin = Math.round(x * d)
            lp.topMargin = Math.round(y * d)
            v.layoutParams = lp
            v.visibility = View.VISIBLE
        }
    }

    fun keepScreenOn(on: Boolean) {
        main.post {
            if (on) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        }
    }

    fun startSetupServer(): String {
        val existing = setupServer
        if (existing != null) return existing.info()
        val server = SetupServer(this) { json -> sendToPage("window.lttvHost && window.lttvHost.onSetupSubmit(${JSONObject.quote(json)})") }
        return try {
            server.start()
            setupServer = server
            server.info()
        } catch (e: Exception) {
            JSONObject().put("error", "Could not start the setup page: ${e.message}").toString()
        }
    }

    fun stopSetupServer() {
        setupServer?.stop()
        setupServer = null
    }

    fun uploadsDir() = java.io.File(cacheDir, "uploads").apply { mkdirs() }

    override fun onStart() {
        super.onStart()
        if (resumeOnStart) player.resume()
        resumeOnStart = false
    }

    override fun onStop() {
        // Fire TV guidelines: stop playback when the app is no longer visible.
        resumeOnStart = player.isActive()
        player.pause()
        for (t in tiles) t?.stop() // Multiview tiles restart from the page when it comes back
        super.onStop()
    }

    override fun onDestroy() {
        stopSetupServer()
        player.release()
        for (t in tiles) t?.release()
        webView.destroy()
        super.onDestroy()
    }

    companion object {
        const val HOST = "appassets.androidplatform.net"
    }
}

/** Serves the bundled web UI from assets/www. */
class WwwPathHandler(private val activity: MainActivity) : WebViewAssetLoader.PathHandler {
    override fun handle(path: String): WebResourceResponse? {
        val clean = path.trimStart('/').ifEmpty { "index.html" }
        if (clean.contains("..")) return null
        return try {
            val stream = activity.assets.open("www/$clean")
            val headers = mapOf("Cache-Control" to if (clean.endsWith(".html")) "no-cache" else "max-age=3600")
            WebResourceResponse(mimeFor(clean), if (isText(clean)) "utf-8" else null, 200, "OK", headers, stream)
        } catch (e: java.io.IOException) {
            WebResourceResponse("text/plain", "utf-8", 404, "Not Found", emptyMap(), "Not found".byteInputStream())
        }
    }

    private fun isText(p: String) = p.endsWith(".html") || p.endsWith(".js") || p.endsWith(".css") || p.endsWith(".json") || p.endsWith(".svg") || p.endsWith(".m3u8")

    companion object {
        fun mimeFor(p: String): String = when {
            p.endsWith(".html") -> "text/html"
            p.endsWith(".js") -> "text/javascript"
            p.endsWith(".css") -> "text/css"
            p.endsWith(".json") -> "application/json"
            p.endsWith(".svg") -> "image/svg+xml"
            p.endsWith(".png") -> "image/png"
            p.endsWith(".m3u8") -> "application/vnd.apple.mpegurl"
            p.endsWith(".ts") -> "video/mp2t"
            p.endsWith(".txt") -> "text/plain"
            else -> "application/octet-stream"
        }
    }
}
