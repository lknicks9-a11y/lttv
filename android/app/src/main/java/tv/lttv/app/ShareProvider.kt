package tv.lttv.app

import android.content.ContentProvider
import android.content.ContentValues
import android.database.Cursor
import android.net.Uri
import android.os.ParcelFileDescriptor
import java.io.File
import java.io.FileNotFoundException

/**
 * Hands LTTV's provider setup (playlists, guides, settings) to the other LTTV apps on this TV —
 * Movies & Shows, League Pass, Blitz — so you only set up your provider once. Protected by a
 * signature permission: only apps signed with LTTV's key can read it.
 */
class ShareProvider : ContentProvider() {
    companion object {
        const val FILE = "shared-setup.json"
        const val SHARED_DIR = "shared"
    }

    override fun onCreate() = true

    override fun openFile(uri: Uri, mode: String): ParcelFileDescriptor {
        if (BuildConfig.APP_MODE != "lttv") throw FileNotFoundException("Only LTTV shares its setup")
        val path = uri.path?.trimStart('/') ?: ""
        // League Pass' timeout photos and songs, kept by LTTV (so they show with the computer off too).
        if (path.startsWith("timeout")) {
            if (path.contains("..")) throw FileNotFoundException(path)
            val f = File(File(context!!.filesDir, SHARED_DIR), path)
            if (!f.isFile) throw FileNotFoundException(path)
            return ParcelFileDescriptor.open(f, ParcelFileDescriptor.MODE_READ_ONLY)
        }
        val f = File(context!!.filesDir, FILE)
        if (!f.isFile) throw FileNotFoundException("LTTV isn't set up yet")
        return ParcelFileDescriptor.open(f, ParcelFileDescriptor.MODE_READ_ONLY)
    }

    override fun getType(uri: Uri) = "application/json"
    override fun query(uri: Uri, p: Array<out String>?, s: String?, a: Array<out String>?, o: String?): Cursor? = null
    override fun insert(uri: Uri, values: ContentValues?): Uri? = null
    override fun delete(uri: Uri, s: String?, a: Array<out String>?) = 0
    override fun update(uri: Uri, v: ContentValues?, s: String?, a: Array<out String>?) = 0
}
