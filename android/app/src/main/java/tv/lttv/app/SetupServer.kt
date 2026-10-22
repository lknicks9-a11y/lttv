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
            .put("qr", if (ip != null) "http://$ip:$port/?pin=$pin" else "")
            .put("pin", pin)
            .toString()
    }

    /**
     * The TV's address on the home network. Prefers the network the TV is actually connected to
     * (Wi-Fi or Ethernet); Fire TVs also have a Wi-Fi Direct interface (p2p0, often 192.168.49.1)
     * that phones can't reach, which used to be picked by mistake.
     */
    private fun lanAddress(): String? {
        try {
            val cm = activity.getSystemService(android.content.Context.CONNECTIVITY_SERVICE) as android.net.ConnectivityManager
            val net = cm.activeNetwork
            val lp = if (net != null) cm.getLinkProperties(net) else null
            lp?.linkAddresses?.map { it.address }?.firstOrNull { it is Inet4Address && !it.isLoopbackAddress }?.let { return it.hostAddress }
        } catch (ignored: Exception) {
        }
        val all = NetworkInterface.getNetworkInterfaces()?.toList() ?: return null
        val good = all.filter { it.isUp && !it.isLoopback && !it.isVirtual && !it.name.startsWith("p2p") && !it.name.startsWith("dummy") && !it.name.startsWith("rmnet") }
        // Wi-Fi / Ethernet first.
        for (ni in good.sortedBy { if (it.name.startsWith("wlan") || it.name.startsWith("eth")) 0 else 1 }) {
            for (addr: InetAddress in ni.inetAddresses.toList()) {
                if (addr is Inet4Address && addr.isSiteLocalAddress && !addr.hostAddress.startsWith("192.168.49.")) return addr.hostAddress
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
                    req.method == "GET" && req.path == "/signin" -> send(out, 200, "text/html; charset=utf-8", SIGNIN_PAGE.toByteArray())
                    req.method == "GET" && req.path == "/config" -> send(out, 200, "application/json", activity.cloudConfigJson.toByteArray())
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
            onSubmit(JSONObject().put("type", "xtream").put("server", server).put("username", user).put("password", pass).put("name", o.optString("name")).put("epg", o.optString("epg")).put("account", o.optString("account")).toString())
            return sendJson(out, 200, JSONObject().put("ok", true))
        }
        if (type == "session") {
            // A sign-in finished on the phone: hand its refresh token to the app (never logged).
            val token = o.optString("refresh_token").trim()
            if (token.isEmpty() || token.length > 4096) return sendJson(out, 400, JSONObject().put("error", "Sign-in didn't finish. Try again."))
            onSubmit(JSONObject().put("type", "session").put("refresh_token", token).toString())
            return sendJson(out, 200, JSONObject().put("ok", true))
        }
        if (type == "watchmode") {
            val key = o.optString("key").trim()
            if (key.isEmpty() || key.length > 200) return sendJson(out, 400, JSONObject().put("error", "Paste your Watchmode API key"))
            onSubmit(JSONObject().put("type", "watchmode").put("key", key).toString())
            return sendJson(out, 200, JSONObject().put("ok", true))
        }
        if (type == "account") {
            val name = o.optString("account").trim()
            if (name.isEmpty()) return sendJson(out, 400, JSONObject().put("error", "Enter a name"))
            onSubmit(JSONObject().put("type", "account").put("account", name.take(24)).toString())
            return sendJson(out, 200, JSONObject().put("ok", true))
        }
        val url = o.optString("url").trim()
        if (type !in setOf("playlist", "epg") || !(url.startsWith("http://") || url.startsWith("https://"))) {
            return sendJson(out, 400, JSONObject().put("error", "Enter a full http(s) URL"))
        }
        onSubmit(JSONObject().put("type", type).put("url", url).put("name", o.optString("name")).put("skipVod", o.optBoolean("skipVod", true)).put("epg", o.optString("epg")).put("account", o.optString("account")).toString())
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
        onSubmit(JSONObject().put("type", type).put("uploadId", id).put("fileName", req.query["name"] ?: "upload").put("name", req.query["label"] ?: "").put("account", req.query["account"] ?: "").toString())
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

        private val SIGNIN_PAGE = """
<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark"><title>LTTV · Sign in</title>
<style>
*{box-sizing:border-box}body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:radial-gradient(120% 60% at 50% 0%,#1b2433 0%,#0a0d12 60%);color:#eef2f7;margin:0;padding:24px 16px 48px;min-height:100vh}
main{max-width:440px;margin:auto}h1{font-size:26px;margin:4px 0 6px}.sub{color:#8a96a8;margin:0 0 20px}
button,input{font:inherit;width:100%;padding:14px 12px;border-radius:12px;border:1px solid #2a3647;background:#0e141c;color:#eef2f7}
button{cursor:pointer;font-weight:700;margin-top:10px;display:flex;align-items:center;justify-content:center;gap:10px}
.p{background:linear-gradient(180deg,#5fd0ff,#2fa8e8);color:#04131d;border:0}
.or{display:flex;align-items:center;gap:10px;color:#8a96a8;margin:20px 0 6px;font-size:14px}.or:before,.or:after{content:"";flex:1;height:1px;background:#2a3647}
label{display:block;margin:12px 0 4px;color:#c4ccd8;font-size:14px}.link{background:none;border:0;color:#5fd0ff;font-weight:600;padding:8px;margin-top:4px}
.msg{margin-top:14px;min-height:1.3em;font-size:15px;text-align:center}.ok{color:#3ddc97}.err{color:#ff8a8a}.done{font-size:20px;text-align:center;margin-top:40px}
</style></head><body><main id="m">
<h1>Sign in to LTTV</h1>
<p class="sub">Your account keeps your playlists, guide, favorites and settings on every device. Your TV signs in as soon as you finish here.</p>

<label>Email</label><input id="email" type="email" autocomplete="email" autocapitalize="off">
<label>Password</label><input id="pw" type="password" autocomplete="current-password">
<button class="p" id="go">Sign in</button>
<button class="link" id="toggle">New here? Create an account</button>
<div class="msg" id="msg"></div>
</main>
<script>
const ${'$'}=(id)=>document.getElementById(id);
const q=new URLSearchParams(location.search);const pin=q.get('pin')||'';
let cfg=null,signup=false;
function show(ok,t){const m=${'$'}('msg');m.className='msg '+(ok?'ok':'err');m.textContent=t;}
async function toTv(rt){show(true,'Signing in your TV…');try{const r=await fetch('/submit',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({pin:pin,type:'session',refresh_token:rt})});const j=await r.json().catch(()=>({}));if(!r.ok){show(false,j.error||'Your TV didn\'t accept the sign-in.');return;}${'$'}('m').innerHTML='<p class="done">✅ Signed in!<br><br>Look at your TV — it\'s loading your account.</p>';}catch(e){show(false,'Couldn\'t reach the TV. Is its sign-in window still open?');}}
async function load(){try{cfg=await (await fetch('/config')).json();}catch(e){}
 if(!cfg||!cfg.url){show(false,'Accounts aren\'t set up for this app yet.');return;}
}
${'$'}('toggle').onclick=()=>{signup=!signup;${'$'}('go').textContent=signup?'Create account':'Sign in';${'$'}('toggle').textContent=signup?'Have an account? Sign in':'New here? Create an account';${'$'}('pw').autocomplete=signup?'new-password':'current-password';};
${'$'}('go').onclick=async()=>{if(!cfg)return;const email=${'$'}('email').value.trim(),pw=${'$'}('pw').value;if(!email||!pw){show(false,'Enter your email and a password.');return;}
 show(true,signup?'Creating your account…':'Signing in…');
 try{const r=await fetch(cfg.url+'/auth/v1/'+(signup?'signup':'token?grant_type=password'),{method:'POST',headers:{apikey:cfg.anonKey,'content-type':'application/json'},body:JSON.stringify({email:email,password:pw})});const j=await r.json().catch(()=>({}));
 if(!r.ok){const t=j.error_description||j.msg||j.message||'Sign-in failed';show(false,/invalid login/i.test(t)?'That email and password don\'t match an account.':/already/i.test(t)?'There\'s already an account with this email — sign in instead.':/at least/i.test(t)?'Use a password with at least 6 characters.':/not confirmed/i.test(t)?'Confirm your email first (check your inbox), then sign in.':t);return;}
 if(!j.refresh_token){show(true,'Check your email to confirm your account, then come back and sign in.');signup=false;${'$'}('go').textContent='Sign in';return;}
 toTv(j.refresh_token);}catch(e){show(false,'Couldn\'t reach the account server.');}};
load();
</script></body></html>
""".trimIndent()

        private val PAGE = """
<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark"><title>LTTV · Send to TV</title>
<style>
*{box-sizing:border-box}body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:radial-gradient(120% 60% at 50% 0%,#1b2433 0%,#0a0d12 60%);color:#eef2f7;margin:0;padding:20px 16px 48px;min-height:100vh}
main{max-width:560px;margin:auto}h1{font-size:26px;margin:4px 0 2px}.sub{color:#8a96a8;margin:0 0 18px}
.card{background:#121822cc;border:1px solid #243041;border-radius:16px;padding:16px;margin:14px 0}
h2{font-size:17px;margin:0 0 4px}label{display:block;margin:12px 0 4px;color:#c4ccd8;font-size:14px}
input,select,button{font:inherit;width:100%;padding:13px 12px;border-radius:11px;border:1px solid #2a3647;background:#0e141c;color:#eef2f7}
input:focus,select:focus{outline:2px solid #4cc2ff;border-color:transparent}
button{background:linear-gradient(180deg,#5fd0ff,#2fa8e8);color:#04131d;font-weight:700;border:0;margin-top:14px;cursor:pointer}
button.sec{background:#1c2633;color:#eef2f7;border:1px solid #2a3647}
.msg{margin-top:10px;min-height:1.3em;font-size:14px}.ok{color:#3ddc97}.err{color:#ff8a8a}
small,.hint{color:#8a96a8;font-size:13px}.tabs{display:flex;gap:6px;margin:10px 0 0}.tabs button{margin:0;padding:10px;font-weight:600}
.tabs button:not(.on){background:#1c2633;color:#c4ccd8;border:1px solid #2a3647}.hide{display:none}
.pinrow{display:flex;gap:10px;align-items:end}.pinrow>div{flex:1}
</style></head><body><main>
<h1>LTTV · Send to your TV</h1>
<p class="sub">Type your details here instead of with the remote. They go straight to the account that's open on your TV.</p>
<div class="card">
<div class="pinrow"><div><label>PIN shown on the TV</label><input id="pin" inputmode="numeric" maxlength="4" autocomplete="off"></div></div>
<label>Account name (optional)</label><input id="acc" maxlength="24" placeholder="e.g. Luke" autocomplete="off">
<small>Names the account on the TV, so each person in the house can have their own.</small>
</div>
<div class="card">
<h2>Your TV provider</h2>
<div class="tabs"><button id="tx" class="on">Username &amp; password</button><button id="tm">Playlist / guide URL</button><button id="tf">File</button></div>
<div id="px">
<label>Server address</label><input id="xs" type="url" placeholder="http://line.example.com:8080" autocomplete="off" autocapitalize="off">
<label>Username</label><input id="xu" autocomplete="off" autocapitalize="off" spellcheck="false">
<label>Password</label><input id="xp" type="password" autocomplete="off">
<button id="xsend">Send to TV</button><div class="msg" id="m0"></div>
</div>
<div id="pm" class="hide">
<label>Playlist name (optional)</label><input id="n">
<label>M3U / M3U8 playlist URL (leave empty to add only a guide)</label><input id="u" type="url" placeholder="https://…" autocomplete="off" autocapitalize="off">
<label>TV guide (XMLTV) URL (optional)</label><input id="g" type="url" placeholder="https://…/guide.xml.gz" autocomplete="off" autocapitalize="off">
<button id="send">Send to TV</button><div class="msg" id="m1"></div>
</div>
<div id="pf" class="hide">
<label>Type</label><select id="ft"><option value="playlist">Playlist (.m3u/.m3u8)</option><option value="epg">Program guide (.xml/.xml.gz)</option><option value="settings">LTTV settings export (.json)</option></select>
<label>File</label><input id="f" type="file">
<button id="up">Upload to TV</button><div class="msg" id="m2"></div>
</div>
</div>
<div class="card">
<h2>Movies &amp; Shows (Watchmode)</h2>
<small>Your own Watchmode API key (free at watchmode.com) gives Movies &amp; Shows Hulu-style rows from Watchmode's US lists.</small>
<label>Watchmode API key</label><input id="wk" autocomplete="off" autocapitalize="off" spellcheck="false">
<button id="wsend">Send key to TV</button><div class="msg" id="m4"></div>
</div>
<div class="card"><button class="sec" id="accsend">Only rename the account</button><div class="msg" id="m3"></div></div>
<p class="hint">Only use a provider you're authorized to use. Your details travel over your home Wi-Fi to the TV and are stored only on the TV. This page stops working when you close the setup window on the TV.</p>
</main>
<script>
const ${'$'}=(id)=>document.getElementById(id);
const q=new URLSearchParams(location.search);if(q.get('pin'))${'$'}('pin').value=q.get('pin');
function show(el,ok,t){el.className='msg '+(ok?'ok':'err');el.textContent=t;}
function tab(k){['x','m','f'].forEach(t=>{${'$'}('p'+t).className=t===k?'':'hide';${'$'}('t'+t).className=t===k?'on':'';});}
${'$'}('tx').onclick=()=>tab('x');${'$'}('tm').onclick=()=>tab('m');${'$'}('tf').onclick=()=>tab('f');
async function post(body,el,okText){show(el,true,'Sending…');try{const r=await fetch('/submit',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(Object.assign({pin:${'$'}('pin').value,account:${'$'}('acc').value},body))});const j=await r.json().catch(()=>({}));show(el,r.ok,r.ok?okText:(j.error||'Failed'));}catch(e){show(el,false,'Could not reach the TV. Is the setup window still open?');}}
${'$'}('xsend').onclick=()=>post({type:'xtream',server:${'$'}('xs').value,username:${'$'}('xu').value,password:${'$'}('xp').value},${'$'}('m0'),'Sent! Your TV is signing in and loading channels.');
${'$'}('send').onclick=()=>{const u=${'$'}('u').value.trim(),g=${'$'}('g').value.trim();if(!u&&!g){show(${'$'}('m1'),false,'Enter a playlist URL, a guide URL, or both');return;}if(!u){post({type:'epg',url:g,name:''},${'$'}('m1'),'Guide sent! Your TV is loading it.');return;}post({type:'playlist',url:u,epg:g,name:${'$'}('n').value},${'$'}('m1'),'Sent! Check your TV.');};
${'$'}('accsend').onclick=()=>post({type:'account'},${'$'}('m3'),'Account renamed on the TV.');
${'$'}('wsend').onclick=()=>{if(!${'$'}('wk').value.trim()){show(${'$'}('m4'),false,'Paste your key first');return;}post({type:'watchmode',key:${'$'}('wk').value.trim()},${'$'}('m4'),'Key sent! Your TV is checking it.');};
${'$'}('up').onclick=async()=>{const f=${'$'}('f').files[0];if(!f){show(${'$'}('m2'),false,'Choose a file first');return;}show(${'$'}('m2'),true,'Uploading…');const p=new URLSearchParams({pin:${'$'}('pin').value,type:${'$'}('ft').value,name:f.name,account:${'$'}('acc').value});try{const r=await fetch('/upload?'+p,{method:'POST',body:f});const j=await r.json().catch(()=>({}));show(${'$'}('m2'),r.ok,r.ok?'Uploaded! Check your TV.':(j.error||'Failed'));}catch(e){show(${'$'}('m2'),false,'Upload failed');}};
</script></body></html>
""".trimIndent()
    }
}
