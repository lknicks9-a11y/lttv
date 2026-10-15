package tv.lttv.app

import android.util.Log
import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.File
import java.io.FileOutputStream
import java.io.InputStream
import java.io.OutputStream
import java.net.Inet4Address
import java.net.InetAddress
import java.net.NetworkInterface
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketException
import java.net.URLDecoder
import java.security.SecureRandom
import java.util.UUID
import java.util.concurrent.Executors

/**
 * A tiny, temporary web page on the local network so a phone or computer can send
 * playlist/guide URLs and files to the TV (typing long URLs with a remote is painful).
 *  - Runs only while the "Phone/computer setup" dialog is open.
 *  - Every submission requires the 4-digit PIN shown on the TV; repeated wrong PINs lock it.
 *  - Accepts at most 300 MB per upload; files are stored in the app's private cache.
 */
class SetupServer(private val activity: MainActivity, private val onSubmit: (String) -> Unit) {

    private val pin = String.format("%04d", SecureRandom().nextInt(10000))
    private var socket: ServerSocket? = null
    private val pool = Executors.newFixedThreadPool(4)
    @Volatile private var failures = 0
    private var port = 0

    fun start() {
        var lastError: Exception? = null
        for (p in 8787..8797) {
            try {
                socket = ServerSocket(p)
                port = p
                break
            } catch (e: Exception) {
                lastError = e
            }
        }
        val s = socket ?: throw lastError ?: IllegalStateException("No free port")
        Thread({
            while (!s.isClosed) {
                try {
                    val client = s.accept()
                    pool.execute { serve(client) }
                } catch (e: SocketException) {
                    break
                } catch (e: Exception) {
                    Log.w(TAG, "setup accept: ${e.message}")
                }
            }
        }, "lttv-setup").start()
    }

    fun stop() {
        try {
            socket?.close()
        } catch (ignored: Exception) {
        }
        pool.shutdownNow()
    }

    fun info(): String {
        val ip = lanAddress()
        return JSONObject()
            .put("url", if (ip != null) "http://$ip:$port" else "Connect the TV to Wi-Fi or Ethernet")
            .put("pin", pin)
            .toString()
    }

    private fun lanAddress(): String? {
        val all = NetworkInterface.getNetworkInterfaces()?.toList() ?: return null
        for (ni in all) {
            if (!ni.isUp || ni.isLoopback) continue
            for (addr: InetAddress in ni.inetAddresses.toList()) {
                if (addr is Inet4Address && addr.isSiteLocalAddress) return addr.hostAddress
            }
        }
        return null
    }

    // ---------------------------------------------------------------- HTTP

    private class Request(val method: String, val path: String, val query: Map<String, String>, val headers: Map<String, String>, val body: InputStream)

    private fun serve(client: Socket) {
        client.use { sock ->
            sock.soTimeout = 30000
            val input = BufferedInputStream(sock.getInputStream())
            val out = sock.getOutputStream()
            try {
                val req = readRequest(input) ?: return
                when {
                    req.method == "GET" && (req.path == "/" || req.path == "/index.html") -> send(out, 200, "text/html; charset=utf-8", PAGE.toByteArray())
                    req.method == "POST" && req.path == "/submit" -> submit(req, out)
                    req.method == "POST" && req.path == "/upload" -> upload(req, out)
                    else -> send(out, 404, "text/plain", "Not found".toByteArray())
                }
            } catch (e: Exception) {
                Log.w(TAG, "setup request failed: ${e.javaClass.simpleName}")
                try {
                    sendJson(out, 500, JSONObject().put("error", "Server error"))
                } catch (ignored: Exception) {
                }
            }
        }
    }

    private fun readLine(input: InputStream): String? {
        val sb = StringBuilder()
        while (true) {
            val c = input.read()
            if (c == -1) return if (sb.isEmpty()) null else sb.toString()
            if (c == '\n'.code) return sb.toString().trimEnd('\r')
            sb.append(c.toChar())
            if (sb.length > 8192) return null
        }
    }

    private fun readRequest(input: InputStream): Request? {
        val first = readLine(input) ?: return null
        val parts = first.split(" ")
        if (parts.size < 2) return null
        val headers = mutableMapOf<String, String>()
        while (true) {
            val line = readLine(input) ?: break
            if (line.isEmpty()) break
            val i = line.indexOf(':')
            if (i > 0) headers[line.substring(0, i).trim().lowercase()] = line.substring(i + 1).trim()
        }
        val target = parts[1]
        val path = target.substringBefore('?')
        val query = mutableMapOf<String, String>()
        target.substringAfter('?', "").split('&').filter { it.isNotEmpty() }.forEach {
            val k = URLDecoder.decode(it.substringBefore('='), "UTF-8")
            val v = URLDecoder.decode(it.substringAfter('=', ""), "UTF-8")
            query[k] = v
        }
        return Request(parts[0].uppercase(), path, query, headers, input)
    }

    private fun checkPin(given: String?, out: OutputStream): Boolean {
        if (failures >= 10) {
            sendJson(out, 429, JSONObject().put("error", "Too many wrong PINs. Close and reopen the setup window on the TV."))
            return false
        }
        if (given != pin) {
            failures++
            sendJson(out, 403, JSONObject().put("error", "Wrong PIN"))
            return false
        }
        return true
    }

    private fun submit(req: Request, out: OutputStream) {
        val len = (req.headers["content-length"] ?: "0").toIntOrNull() ?: 0
        if (len <= 0 || len > 64 * 1024) return sendJson(out, 400, JSONObject().put("error", "Bad request"))
        val bytes = ByteArray(len)
        var read = 0
        while (read < len) {
            val n = req.body.read(bytes, read, len - read)
            if (n < 0) break
            read += n
        }
        val o = JSONObject(String(bytes, 0, read, Charsets.UTF_8))
        if (!checkPin(o.optString("pin"), out)) return
        val type = o.optString("type")
        if (type == "xtream") {
            val server = o.optString("server").trim()
            val user = o.optString("username").trim()
            val pass = o.optString("password").trim()
            if (server.isEmpty() || user.isEmpty() || pass.isEmpty()) return sendJson(out, 400, JSONObject().put("error", "Enter server, username and password"))
            onSubmit(JSONObject().put("type", "xtream").put("server", server).put("username", user).put("password", pass).put("name", o.optString("name")).toString())
            return sendJson(out, 200, JSONObject().put("ok", true))
        }
        val url = o.optString("url").trim()
        if (type !in setOf("playlist", "epg") || !(url.startsWith("http://") || url.startsWith("https://"))) {
            return sendJson(out, 400, JSONObject().put("error", "Enter a full http(s) URL"))
        }
        onSubmit(JSONObject().put("type", type).put("url", url).put("name", o.optString("name")).put("skipVod", o.optBoolean("skipVod", true)).toString())
        sendJson(out, 200, JSONObject().put("ok", true))
    }

    private fun upload(req: Request, out: OutputStream) {
        if (!checkPin(req.query["pin"], out)) return
        val type = req.query["type"] ?: ""
        if (type !in setOf("playlist", "epg", "settings")) return sendJson(out, 400, JSONObject().put("error", "Unknown type"))
        val len = (req.headers["content-length"] ?: "-1").toLongOrNull() ?: -1
        if (len <= 0 || len > MAX_UPLOAD) return sendJson(out, 413, JSONObject().put("error", "File missing or larger than 300 MB"))
        val id = UUID.randomUUID().toString().replace("-", "")
        val file = File(activity.uploadsDir(), id)
        // Keep only a few recent uploads.
        activity.uploadsDir().listFiles()?.sortedByDescending { it.lastModified() }?.drop(5)?.forEach { it.delete() }
        FileOutputStream(file).use { fos ->
            val buf = ByteArray(64 * 1024)
            var remaining = len
            while (remaining > 0) {
                val n = req.body.read(buf, 0, minOf(buf.size.toLong(), remaining).toInt())
                if (n < 0) break
                fos.write(buf, 0, n)
                remaining -= n
            }
        }
        onSubmit(JSONObject().put("type", type).put("uploadId", id).put("fileName", req.query["name"] ?: "upload").put("name", req.query["label"] ?: "").toString())
        sendJson(out, 200, JSONObject().put("ok", true))
    }

    private fun sendJson(out: OutputStream, status: Int, o: JSONObject) = send(out, status, "application/json", o.toString().toByteArray())

    private fun send(out: OutputStream, status: Int, type: String, body: ByteArray) {
        val reason = when (status) { 200 -> "OK"; 400 -> "Bad Request"; 403 -> "Forbidden"; 404 -> "Not Found"; 413 -> "Payload Too Large"; 429 -> "Too Many Requests"; else -> "Error" }
        val head = "HTTP/1.1 $status $reason\r\nContent-Type: $type\r\nContent-Length: ${body.size}\r\nCache-Control: no-store\r\nConnection: close\r\nX-Content-Type-Options: nosniff\r\n\r\n"
        out.write(head.toByteArray())
        out.write(body)
        out.flush()
    }

    companion object {
        private const val TAG = "LTTV"
        private const val MAX_UPLOAD = 300L * 1024 * 1024

        private val PAGE = """
<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>LTTV setup</title>
<style>
body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#0a0d12;color:#eef2f7;margin:0;padding:24px;max-width:640px;margin:auto}
h1{font-size:24px}h2{font-size:18px;margin-top:28px;color:#c4ccd8}label{display:block;margin:12px 0 4px;color:#c4ccd8}
input,select,button{font:inherit;width:100%;box-sizing:border-box;padding:12px;border-radius:10px;border:1px solid #273243;background:#141a23;color:#eef2f7}
button{background:#4cc2ff;color:#04131d;font-weight:700;border:0;margin-top:12px;cursor:pointer}.msg{margin-top:10px;min-height:1.4em}.ok{color:#3ddc97}.err{color:#ff8a8a}
small{color:#8a96a8}
</style></head><body>
<h1>LTTV · send to your TV</h1>
<p><small>Only send playlists you are authorized to use. Everything stays on your local network and on the TV.</small></p>
<label>PIN shown on the TV</label><input id="pin" inputmode="numeric" maxlength="4" autocomplete="off">
<h2>Sign in with your provider</h2>
<p><small>For services that give you a server, username and password.</small></p>
<label>Server address</label><input id="xs" type="url" placeholder="http://line.example.com:8080" autocomplete="off">
<label>Username</label><input id="xu" autocomplete="off" autocapitalize="off">
<label>Password</label><input id="xp" type="password" autocomplete="off">
<button id="xsend">Send login to TV</button><div class="msg" id="m0"></div>
<h2>Add from a URL</h2>
<label>Type</label><select id="t"><option value="playlist">Playlist (M3U/M3U8)</option><option value="epg">Program guide (XMLTV)</option></select>
<label>Name (optional)</label><input id="n">
<label>URL</label><input id="u" type="url" placeholder="https://…" autocomplete="off">
<button id="send">Send to TV</button><div class="msg" id="m1"></div>
<h2>Upload a file</h2>
<label>Type</label><select id="ft"><option value="playlist">Playlist (.m3u/.m3u8)</option><option value="epg">Program guide (.xml/.xml.gz)</option><option value="settings">LTTV settings export (.json)</option></select>
<label>File</label><input id="f" type="file">
<button id="up">Upload to TV</button><div class="msg" id="m2"></div>
<script>
const ${'$'}=(id)=>document.getElementById(id);
function show(el,ok,t){el.className='msg '+(ok?'ok':'err');el.textContent=t;}
${'$'}('xsend').onclick=async()=>{const r=await fetch('/submit',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({pin:${'$'}('pin').value,type:'xtream',server:${'$'}('xs').value,username:${'$'}('xu').value,password:${'$'}('xp').value})});const j=await r.json().catch(()=>({}));show(${'$'}('m0'),r.ok,r.ok?'Sent! Your TV is signing in and loading channels.':(j.error||'Failed'));};
${'$'}('send').onclick=async()=>{const r=await fetch('/submit',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({pin:${'$'}('pin').value,type:${'$'}('t').value,url:${'$'}('u').value,name:${'$'}('n').value})});const j=await r.json().catch(()=>({}));show(${'$'}('m1'),r.ok,r.ok?'Sent! Check your TV.':(j.error||'Failed'));};
${'$'}('up').onclick=async()=>{const f=${'$'}('f').files[0];if(!f){show(${'$'}('m2'),false,'Choose a file first');return;}show(${'$'}('m2'),true,'Uploading…');const q=new URLSearchParams({pin:${'$'}('pin').value,type:${'$'}('ft').value,name:f.name});const r=await fetch('/upload?'+q,{method:'POST',body:f});const j=await r.json().catch(()=>({}));show(${'$'}('m2'),r.ok,r.ok?'Uploaded! Check your TV.':(j.error||'Failed'));};
</script></body></html>
""".trimIndent()
    }
}
