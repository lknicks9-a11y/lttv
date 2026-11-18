package tv.lttv.app

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.File
import java.io.InputStream
import java.io.OutputStream
import java.net.Inet4Address
import java.net.NetworkInterface
import java.net.ServerSocket
import java.net.Socket
import java.net.URLDecoder
import kotlin.concurrent.thread

/**
 * League Pass / Blitz secret settings: "Photos & songs from your phone". A small page on the home network (while
 * the settings are open): pick pictures and songs on a phone or computer and they're kept on this TV for the
 * timeout screen — no computer or LTTV needed. The address carries a random code, so only someone who can see
 * the TV can use it.
 */
class MediaServer(private val ctx: Context, private val onChange: () -> Unit) {
    companion object {
        fun dir(c: Context) = File(c.filesDir, "timeout-local").apply { mkdirs() }
        private val SONG = Regex("""\.(mp3|m4a|aac|wav|ogg|flac)$""", RegexOption.IGNORE_CASE)
        private val PIC = Regex("""\.(jpe?g|png|webp|gif|avif)$""", RegexOption.IGNORE_CASE)

        /** {"images":[...], "audio":[...]} of what's kept on this TV. */
        fun listJson(c: Context): String {
            val imgs = JSONArray(); val auds = JSONArray()
            dir(c).listFiles()?.filter { it.isFile && !it.name.endsWith(".part") }?.sortedBy { it.name.lowercase() }?.forEach {
                when {
                    SONG.containsMatchIn(it.name) -> auds.put(it.name)
                    PIC.containsMatchIn(it.name) -> imgs.put(it.name)
                }
            }
            return JSONObject().put("images", imgs).put("audio", auds).toString()
        }
    }

    val code: String = (1..6).map { "abcdefghjkmnpqrstuvwxyz23456789".random() }.joinToString("")
    private var server: ServerSocket? = null
    var port = 0
        private set

    fun start(): Boolean {
        for (p in 8780..8789) {
            try { server = ServerSocket(p); port = p; break } catch (_: Exception) { }
        }
        val s = server ?: return false
        thread(name = "media-server", isDaemon = true) {
            while (!s.isClosed) {
                val c = try { s.accept() } catch (_: Exception) { break }
                thread(isDaemon = true) { try { c.use { handle(it) } } catch (_: Exception) { } }
            }
        }
        return true
    }

    fun stop() {
        try { server?.close() } catch (_: Exception) { }
        server = null
    }

    fun address(): String? {
        val ip = try {
            NetworkInterface.getNetworkInterfaces().toList().filter { it.isUp && !it.isLoopback }
                .flatMap { it.inetAddresses.toList() }.filterIsInstance<Inet4Address>().firstOrNull { it.isSiteLocalAddress }?.hostAddress
        } catch (_: Exception) { null } ?: return null
        return "http://$ip:$port/$code"
    }

    private fun safeName(n: String) = n.substringAfterLast('/').substringAfterLast('\\').replace(Regex("""[^\w .()\-&',!]"""), "_").trim().take(120)

    private fun handle(sock: Socket) {
        sock.soTimeout = 60_000
        val input = BufferedInputStream(sock.getInputStream())
        val out = sock.getOutputStream()
        val request = readLine(input) ?: return
        val parts = request.split(' ')
        if (parts.size < 2) return
        val method = parts[0]
        val target = parts[1]
        var length = 0L
        while (true) {
            val line = readLine(input) ?: break
            if (line.isEmpty()) break
            val i = line.indexOf(':')
            if (i > 0 && line.substring(0, i).trim().equals("content-length", true)) length = line.substring(i + 1).trim().toLongOrNull() ?: 0
        }
        val path = target.substringBefore('?')
        val query = target.substringAfter('?', "").split('&').filter { it.contains('=') }
            .associate { URLDecoder.decode(it.substringBefore('='), "UTF-8") to URLDecoder.decode(it.substringAfter('='), "UTF-8") }
        val segs = path.trim('/').split('/')
        if (segs.firstOrNull() != code) return send(out, 404, "text/plain", "Open the address shown on the TV.".toByteArray())
        when (val action = segs.getOrNull(1) ?: "") {
            "" -> if (method == "GET") send(out, 200, "text/html; charset=utf-8", PAGE.toByteArray()) else send(out, 405, "text/plain", ByteArray(0))
            "list.json" -> send(out, 200, "application/json", listJson(ctx).toByteArray())
            "file" -> {
                val name = safeName(query["name"] ?: "")
                if (name.isEmpty() || !(SONG.containsMatchIn(name) || PIC.containsMatchIn(name))) return send(out, 415, "text/plain", "Pictures and songs only".toByteArray())
                val f = File(dir(ctx), name)
                when (method) {
                    "PUT" -> {
                        if (length <= 0 || length > 200_000_000) return send(out, 413, "text/plain", "Too big".toByteArray())
                        val part = File(dir(ctx), "$name.part")
                        var got = 0L
                        part.outputStream().use { o ->
                            val buf = ByteArray(64 * 1024)
                            while (got < length) {
                                val n = input.read(buf, 0, minOf(buf.size.toLong(), length - got).toInt())
                                if (n < 0) break
                                o.write(buf, 0, n); got += n
                            }
                        }
                        val ok = got == length && part.renameTo(f)
                        if (!ok) part.delete() else onChange()
                        send(out, if (ok) 200 else 400, "text/plain", (if (ok) "Saved" else "Didn't arrive whole — try again").toByteArray())
                    }
                    "DELETE" -> { f.delete(); onChange(); send(out, 200, "text/plain", "Removed".toByteArray()) }
                    else -> send(out, 405, "text/plain", ByteArray(0))
                }
            }
            else -> send(out, 404, "text/plain", action.toByteArray())
        }
    }

    private fun readLine(input: InputStream): String? {
        val sb = StringBuilder()
        while (true) {
            val b = input.read()
            if (b < 0) return if (sb.isEmpty()) null else sb.toString()
            if (b == '\n'.code) return sb.toString().trimEnd('\r')
            sb.append(b.toChar())
            if (sb.length > 8192) return null
        }
    }

    private fun send(out: OutputStream, status: Int, type: String, body: ByteArray) {
        out.write("HTTP/1.1 $status ${if (status == 200) "OK" else "Error"}\r\nContent-Type: $type\r\nContent-Length: ${body.size}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n".toByteArray())
        out.write(body); out.flush()
    }

    private val PAGE = """<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>League Pass — Photos & songs</title>
<style>
body{margin:0;background:#08080a;color:#e6eaf0;font:16px system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
header{padding:22px 18px 8px}h1{margin:0;font-size:24px}h1 b{color:#ff8a1f}p{color:#9aa4b2;margin:6px 0 0}
.bar{display:flex;gap:10px;flex-wrap:wrap;padding:12px 18px}
label,button{font:600 15px system-ui,sans-serif;border:0;border-radius:22px;padding:10px 16px;cursor:pointer}
label{background:#ff8a1f;color:#08080a}button{background:#2a323d;color:#e6eaf0}input{display:none}
#st{padding:4px 18px;color:#9aa4b2;font-size:14px}
h2{font-size:17px;margin:18px 18px 8px}ul{list-style:none;margin:0;padding:0 18px 30px}
li{display:flex;align-items:center;gap:10px;background:#161b22;border:1px solid #232a33;border-radius:12px;padding:8px 10px;margin-bottom:8px}
li img{width:64px;height:40px;object-fit:cover;border-radius:6px;background:#0e1218}li span{flex:1;word-break:break-all;font-size:14px}
</style></head><body>
<header><h1><b>League Pass</b> · Photos &amp; songs</h1><p>They play on the timeout screen when no game is on. Kept on your TV.</p></header>
<div class="bar"><label>Add photos<input id="pi" type="file" accept="image/*" multiple></label><label>Add songs<input id="si" type="file" accept="audio/*" multiple></label></div>
<div id="st"></div><h2>Photos</h2><ul id="pl"></ul><h2>Songs</h2><ul id="sl"></ul>
<script>
const T=location.pathname.split('/')[1],st=document.getElementById('st');
function el(t,x){const e=document.createElement(t);if(x)e.textContent=x;return e}
async function load(){
  const j=await (await fetch('/'+T+'/list.json',{cache:'no-store'})).json();
  for(const [id,arr] of [['pl',j.images],['sl',j.audio]]){const u=document.getElementById(id);u.innerHTML='';
    if(!arr.length)u.appendChild(el('li','None yet'));
    arr.forEach(n=>{const li=el('li');li.appendChild(el('span',n));const b=el('button','Remove');
      b.onclick=async()=>{await fetch('/'+T+'/file?name='+encodeURIComponent(n),{method:'DELETE'});load()};li.appendChild(b);u.appendChild(li)})}
}
function shrink(f){return new Promise(ok=>{if(!f.type.startsWith('image/')||f.type==='image/gif')return ok(f);
  const u=URL.createObjectURL(f),i=new Image();i.onload=()=>{const s=Math.min(1,1920/Math.max(i.width,i.height));if(s===1&&f.size<3e6){URL.revokeObjectURL(u);return ok(f)}
  const c=document.createElement('canvas');c.width=Math.round(i.width*s);c.height=Math.round(i.height*s);c.getContext('2d').drawImage(i,0,0,c.width,c.height);URL.revokeObjectURL(u);c.toBlob(b=>ok(b||f),'image/jpeg',0.88)};
  i.onerror=()=>{URL.revokeObjectURL(u);ok(f)};i.src=u})}
async function send(files){let n=0;for(const f of files){n++;st.textContent='Sending '+n+' of '+files.length+': '+f.name+'…';
  try{let name=f.name;const b=await shrink(f);if(b!==f&&!/\.jpe?g$/i.test(name))name=name.replace(/\.[^.]+$/,'')+'.jpg';
    const r=await fetch('/'+T+'/file?name='+encodeURIComponent(name),{method:'PUT',body:b});if(!r.ok)st.textContent=await r.text()}catch(e){st.textContent='Couldn’t send '+f.name+': '+e.message}}
  st.textContent='Done — on your TV now.';load()}
document.getElementById('pi').onchange=e=>send([...e.target.files]);
document.getElementById('si').onchange=e=>send([...e.target.files]);
load();
</script></body></html>"""
}
