package tv.lttv.app

import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

object Net {
    /**
     * Open an HTTP(S) connection following up to 6 redirects, including http<->https
     * hops (HttpURLConnection refuses those on its own). Returns a connected
     * connection; the caller must check [HttpURLConnection.getResponseCode].
     */
    @Throws(IOException::class)
    fun open(url: String, headers: Map<String, String>, timeoutMs: Int = 20000): HttpURLConnection {
        var target = URL(url)
        repeat(6) {
            if (target.protocol != "http" && target.protocol != "https") throw IOException("Only http(s) URLs are supported")
            val c = target.openConnection() as HttpURLConnection
            c.instanceFollowRedirects = false
            c.connectTimeout = timeoutMs
            c.readTimeout = timeoutMs * 2
            c.setRequestProperty("User-Agent", PlayerController.USER_AGENT)
            c.setRequestProperty("Accept", "*/*")
            for ((k, v) in headers) c.setRequestProperty(k, v)
            val code = c.responseCode
            if (code in 300..399) {
                val loc = c.getHeaderField("Location")
                c.disconnect()
                if (loc.isNullOrEmpty()) throw IOException("Redirect without a location")
                target = URL(target, loc)
                return@repeat
            }
            return c
        }
        throw IOException("Too many redirects")
    }

    /** Hide credentials, tokens and paths for logs. */
    fun redact(url: String): String = try {
        val u = URL(url)
        "${u.protocol}://${u.host}${if (u.port > 0) ":" + u.port else ""}/…"
    } catch (e: Exception) {
        "…"
    }
}
