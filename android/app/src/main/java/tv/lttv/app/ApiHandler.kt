package tv.lttv.app

import android.net.Uri
import android.util.Log
import android.webkit.WebResourceResponse
import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.File
import java.io.FileInputStream
import java.io.IOException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.io.InputStream
import java.io.SequenceInputStream
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.zip.GZIPInputStream

/**
 * Native implementation of the same /api endpoints the desktop helper provides:
 *   /api/caps, /api/fetch?url=&h=&gunzip=auto, /api/probe?url=, /api/upload/<id>
 * Runs on WebView's background thread (shouldInterceptRequest), so blocking I/O is fine.
 * Requests come only from our own page origin; nothing is exposed to the network.
 */
class ApiHandler(private val activity: MainActivity) {

    private val cors = mapOf("Cache-Control" to "no-store", "Access-Control-Allow-Origin" to "*")

    fun handle(url: Uri): WebResourceResponse = try {
        when {
            url.path == "/api/caps" -> json(200, JSONObject()
                .put("proxy", true)
                .put("ffmpeg", false)
                .put("version", BuildConfig.VERSION_NAME)
                .put("platform", NativeBridge(activity).platform()))
            url.path == "/api/fetch" -> deferred(url)
            url.path == "/api/probe" -> json(200, JSONObject().put("kind", "unknown"))
            url.path?.startsWith("/api/upload/") == true -> upload(url.lastPathSegment ?: "")
            else -> json(404, JSONObject().put("error", "Unknown endpoint"))
        }
    } catch (e: Exception) {
        json(500, JSONObject().put("error", e.message ?: "Internal error"))
    }

    private fun headersFrom(url: Uri): Map<String, String> {
        val raw = url.getQueryParameter("h") ?: return emptyMap()
        return try {
            val o = JSONObject(raw)
            o.keys().asSequence().associateWith { o.optString(it) }
        } catch (e: Exception) {
            emptyMap()
        }
    }

    /**
     * WebView waits for shouldInterceptRequest to return before it loads anything else, so a
     * slow server would freeze the whole app (screens, images, other requests). Instead the
     * response is returned at once and the connection is made on a worker thread; the body
     * starts with one line "LTTV-STATUS <code> <length>" that the page reads first.
     */
    private fun deferred(url: Uri): WebResourceResponse {
        val result = ArrayBlockingQueue<WebResourceResponse>(1)
        pool.execute {
            val r = try {
                fetch(url)
            } catch (e: Exception) {
                json(500, JSONObject().put("error", e.message ?: "Internal error"))
            }
            result.offer(r)
        }
        val body = object : InputStream() {
            private var inner: InputStream? = null
            private fun open(): InputStream {
                inner?.let { return it }
                val r = result.poll(90, TimeUnit.SECONDS)
                    ?: json(504, JSONObject().put("error", "The source server did not respond in time."))
                val len = r.responseHeaders?.get("X-Upstream-Length") ?: ""
                val head = "LTTV-STATUS ${r.statusCode} $len\n".toByteArray()
                val s = SequenceInputStream(head.inputStream(), r.data ?: ByteArray(0).inputStream())
                inner = s
                return s
            }
            override fun read(): Int = open().read()
            override fun read(b: ByteArray, off: Int, len: Int): Int = open().read(b, off, len)
            override fun close() {
                inner?.close()
            }
        }
        return WebResourceResponse("application/octet-stream", null, 200, "OK", cors + mapOf("X-Deferred" to "1"), body)
    }

    private fun fetch(url: Uri): WebResourceResponse {
        val target = url.getQueryParameter("url") ?: return json(400, JSONObject().put("error", "Missing url"))
        if (!target.startsWith("http://") && !target.startsWith("https://")) return json(400, JSONObject().put("error", "Only http(s) URLs are supported"))
        val conn = try {
            Net.open(target, headersFrom(url))
        } catch (e: UnknownHostException) {
            return json(502, JSONObject().put("error", "The server name could not be found. Check the URL and the network connection."))
        } catch (e: SocketTimeoutException) {
            return json(504, JSONObject().put("error", "The source server did not respond in time."))
        } catch (e: IOException) {
            Log.w(TAG, "fetch failed for ${Net.redact(target)}: ${e.javaClass.simpleName}")
            return json(502, JSONObject().put("error", "Could not reach the source server (${e.javaClass.simpleName})."))
        }
        val code = conn.responseCode
        if (code >= 400) {
            conn.disconnect()
            Log.w(TAG, "upstream $code for ${Net.redact(target)}")
            return json(if (code == 401 || code == 403 || code == 404) code else 502,
                JSONObject().put("error", "The source server answered $code").put("status", code))
        }
        val headers = cors.toMutableMap()
        val len = conn.contentLengthLong
        if (len > 0) headers["X-Upstream-Length"] = len.toString()
        var stream = BufferedInputStream(conn.inputStream, 64 * 1024)
        var type = conn.contentType ?: "application/octet-stream"
        if (url.getQueryParameter("gunzip") == "auto") {
            stream.mark(4)
            val b0 = stream.read()
            val b1 = stream.read()
            stream.reset()
            if (b0 == 0x1f && b1 == 0x8b) {
                stream = BufferedInputStream(GZIPInputStream(stream, 64 * 1024), 64 * 1024)
                type = "text/plain"
                headers.remove("X-Upstream-Length")
            }
        }
        val mime = type.substringBefore(';').trim()
        return WebResourceResponse(mime, null, 200, "OK", headers, stream)
    }

    private fun upload(id: String): WebResourceResponse {
        if (!id.matches(Regex("[A-Za-z0-9_-]{6,64}"))) return json(400, JSONObject().put("error", "Bad id"))
        val f = File(activity.uploadsDir(), id)
        if (!f.exists()) return json(404, JSONObject().put("error", "Upload not found"))
        return WebResourceResponse("application/octet-stream", null, 200, "OK", cors, FileInputStream(f))
    }

    private fun json(status: Int, o: JSONObject): WebResourceResponse {
        val reason = when (status) {
            200 -> "OK"; 400 -> "Bad Request"; 401 -> "Unauthorized"; 403 -> "Forbidden"; 404 -> "Not Found"
            500 -> "Internal Server Error"; 502 -> "Bad Gateway"; 504 -> "Gateway Timeout"; else -> "Error"
        }
        return WebResourceResponse("application/json", "utf-8", status, reason, cors, o.toString().byteInputStream())
    }

    companion object {
        private const val TAG = "LTTV"
        /** Network work for /api/fetch (several requests at once, never on WebView's request thread). */
        private val pool = Executors.newFixedThreadPool(6)
    }
}
