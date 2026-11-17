package tv.lttv.home

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.drawable.Drawable
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.io.OutputStream
import java.net.Inet4Address
import java.net.NetworkInterface
import java.net.ServerSocket
import java.net.Socket
import java.net.URLDecoder
import kotlin.concurrent.thread

/**
 * "Photos for your apps": a small web page served by LTTV Home on the home network while that
 * screen is open. Open it on a phone or computer, pick a picture for any app (or the home screen
 * background), and the TV uses it right away. The address carries a random code, so only someone
 * who can see the TV screen can use it. Pictures are kept on the TV only.
 */
class ArtServer(
    private val ctx: Context,
    /** (key, name, art for when there's no photo) for every tile, LTTV's first. */
    private val tiles: () -> List<Triple<String, String, Drawable?>>,
    private val onChange: () -> Unit,
) {
    val code: String = (1..6).map { "abcdefghjkmnpqrstuvwxyz23456789".random() }.joinToString("")
    private var server: ServerSocket? = null
    var port = 0
        private set

    fun start(): Boolean {
        for (p in 8790..8799) {
            try {
                server = ServerSocket(p)
                port = p
                break
            } catch (_: Exception) { /* next */ }
        }
        val s = server ?: return false
        thread(name = "art-server", isDaemon = true) {
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

    /** http://192.168.x.x:8790/code — the TV's address on the home network. */
    fun address(): String? {
        val ip = try {
            NetworkInterface.getNetworkInterfaces().toList()
                .filter { it.isUp && !it.isLoopback }
                .flatMap { it.inetAddresses.toList() }
                .filterIsInstance<Inet4Address>()
                .firstOrNull { it.isSiteLocalAddress }?.hostAddress
        } catch (_: Exception) { null } ?: return null
        return "http://$ip:$port/$code"
    }

    // ---- HTTP -----------------------------------------------------------------------------------

    private fun handle(sock: Socket) {
        sock.soTimeout = 30_000
        val input = BufferedInputStream(sock.getInputStream())
        val out = sock.getOutputStream()
        val request = readLine(input) ?: return
        val parts = request.split(' ')
        if (parts.size < 2) return
        val method = parts[0]
        val target = parts[1]
        var length = 0
        while (true) {
            val line = readLine(input) ?: break
            if (line.isEmpty()) break
            val i = line.indexOf(':')
            if (i > 0 && line.substring(0, i).trim().equals("content-length", true)) length = line.substring(i + 1).trim().toIntOrNull() ?: 0
        }
        val path = target.substringBefore('?')
        val query = target.substringAfter('?', "").split('&').filter { it.contains('=') }
            .associate { URLDecoder.decode(it.substringBefore('='), "UTF-8") to URLDecoder.decode(it.substringAfter('='), "UTF-8") }
        val segs = path.trim('/').split('/')
        if (segs.firstOrNull() != code) return send(out, 404, "text/plain", "Open the address shown on the TV.".toByteArray())
        val action = segs.getOrNull(1) ?: ""
        when {
            method == "GET" && action == "" -> send(out, 200, "text/html; charset=utf-8", PAGE.toByteArray())
            method == "GET" && action == "apps.json" -> send(out, 200, "application/json", appsJson().toByteArray())
            method == "GET" && action == "art" -> {
                val key = query["key"] ?: return send(out, 400, "text/plain", ByteArray(0))
                send(out, 200, "image/jpeg", preview(key))
            }
            method == "PUT" && action == "art" -> {
                val key = query["key"] ?: return send(out, 400, "text/plain", ByteArray(0))
                if (length <= 0 || length > 30_000_000) return send(out, 413, "text/plain", "Picture too big".toByteArray())
                val body = ByteArray(length)
                var got = 0
                while (got < length) {
                    val n = input.read(body, got, length - got)
                    if (n < 0) break
                    got += n
                }
                val ok = got == length && Art.save(ctx, key, body)
                if (ok) onChange()
                send(out, if (ok) 200 else 415, "text/plain", (if (ok) "Saved" else "That picture couldn't be read").toByteArray())
            }
            method == "DELETE" && action == "art" -> {
                val key = query["key"] ?: return send(out, 400, "text/plain", ByteArray(0))
                Art.remove(ctx, key)
                onChange()
                send(out, 200, "text/plain", "Removed".toByteArray())
            }
            else -> send(out, 404, "text/plain", ByteArray(0))
        }
    }

    private fun appsJson(): String {
        val arr = JSONArray()
        arr.put(JSONObject().put("key", Art.BACKGROUND).put("name", "Home screen background").put("custom", Art.has(ctx, Art.BACKGROUND)))
        for ((key, name, _) in tiles()) arr.put(JSONObject().put("key", key).put("name", name).put("custom", Art.has(ctx, key)))
        return arr.toString()
    }

    /** The tile as it looks now: the user's photo, else the app's own TV banner / icon. */
    private fun preview(key: String): ByteArray {
        val bmp = Art.bitmap(ctx, key) ?: run {
            val d = tiles().firstOrNull { it.first == key }?.third
            val b = Bitmap.createBitmap(640, 360, Bitmap.Config.ARGB_8888)
            val c = Canvas(b)
            c.drawColor(Color.parseColor("#161B22"))
            if (d != null) {
                val iw = d.intrinsicWidth
                val ih = d.intrinsicHeight
                if (iw > 0 && ih > 0 && iw * 9 >= ih * 15) d.setBounds(0, 0, 640, 360) // a TV banner fills the tile
                else d.setBounds(220, 80, 420, 280)
                d.draw(c)
            }
            b
        }
        val o = ByteArrayOutputStream()
        bmp.compress(Bitmap.CompressFormat.JPEG, 80, o)
        return o.toByteArray()
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
        val head = "HTTP/1.1 $status ${if (status == 200) "OK" else "Error"}\r\nContent-Type: $type\r\nContent-Length: ${body.size}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n"
        out.write(head.toByteArray())
        out.write(body)
        out.flush()
    }

    private companion object {
        val PAGE = """<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>LTTV Home — Photos for your apps</title>
<style>
body{margin:0;background:#08080a;color:#e6eaf0;font:16px system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
header{padding:20px 18px 6px}h1{margin:0;font-size:24px}h1 b{color:#4cc2ff}p{color:#9aa4b2;margin:6px 0 0}
main{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:14px;padding:16px 18px 40px}
.c{background:#161b22;border:1px solid #232a33;border-radius:14px;overflow:hidden}
.c img{display:block;width:100%;aspect-ratio:16/9;object-fit:cover;background:#0e1218}
.c div{padding:10px 12px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.c strong{flex:1 1 100%;font-size:15px}
label,button{font:600 14px system-ui,sans-serif;border:0;border-radius:20px;padding:8px 14px;cursor:pointer}
label{background:#4cc2ff;color:#08080a}button{background:#2a323d;color:#e6eaf0}
input{display:none}.s{font-size:13px;color:#9aa4b2}
</style></head><body>
<header><h1><b>LTTV</b> Home · Photos for your apps</h1><p>Pick a photo for any app (wide photos look best). It shows on your TV right away.</p></header>
<main id="m"></main>
<script>
const T=location.pathname.split('/')[1];
const m=document.getElementById('m');
function el(t,c,x){const e=document.createElement(t);if(c)e.className=c;if(x)e.textContent=x;return e}
async function load(){
  const apps=await (await fetch('/'+T+'/apps.json',{cache:'no-store'})).json();
  m.innerHTML='';
  apps.forEach(function(a){
    const c=el('section','c'),img=el('img'),d=el('div'),st=el('span','s');
    img.src='/'+T+'/art?key='+encodeURIComponent(a.key)+'&t='+Date.now();
    const lab=el('label',null,a.custom?'Change photo':'Choose photo'),inp=el('input');
    inp.type='file';inp.accept='image/*';lab.appendChild(inp);
    inp.onchange=async function(){
      const f=inp.files[0];if(!f)return;st.textContent='Sending…';
      try{
        const blob=await shrink(f);
        const r=await fetch('/'+T+'/art?key='+encodeURIComponent(a.key),{method:'PUT',body:blob});
        st.textContent=r.ok?'On your TV now':await r.text();
        if(r.ok)setTimeout(load,400);
      }catch(e){st.textContent='Couldn’t send it: '+e.message}
    };
    d.appendChild(el('strong',null,a.name));d.appendChild(lab);
    if(a.custom){const b=el('button',null,'Use original');b.onclick=async function(){await fetch('/'+T+'/art?key='+encodeURIComponent(a.key),{method:'DELETE'});load()};d.appendChild(b)}
    d.appendChild(st);c.appendChild(img);c.appendChild(d);m.appendChild(c);
  });
}
// Shrink big phone photos before sending (the TV crops to 16:9 itself).
function shrink(f){return new Promise(function(ok){
  const u=URL.createObjectURL(f),i=new Image();
  i.onload=function(){const s=Math.min(1,1920/Math.max(i.width,i.height));if(s===1&&f.size<4e6){URL.revokeObjectURL(u);return ok(f)}
    const cv=document.createElement('canvas');cv.width=Math.round(i.width*s);cv.height=Math.round(i.height*s);
    cv.getContext('2d').drawImage(i,0,0,cv.width,cv.height);URL.revokeObjectURL(u);cv.toBlob(function(b){ok(b||f)},'image/jpeg',0.9)};
  i.onerror=function(){URL.revokeObjectURL(u);ok(f)};i.src=u;})}
load();
</script></body></html>"""
    }
}
