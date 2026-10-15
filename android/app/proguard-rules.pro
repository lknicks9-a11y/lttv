# Keep the JavaScript bridge methods called from the web UI.
-keepclassmembers class tv.lttv.app.NativeBridge {
    @android.webkit.JavascriptInterface <methods>;
}
-keepattributes JavascriptInterface
