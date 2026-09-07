package expo.modules.cloudbackup

import android.content.Context
import com.google.android.gms.auth.api.signin.GoogleSignIn
import com.google.api.client.extensions.android.http.AndroidHttp
import com.google.api.client.googleapis.extensions.android.gms.auth.GoogleAccountCredential
import com.google.api.client.http.ByteArrayContent
import com.google.api.client.json.gson.GsonFactory
import com.google.api.services.drive.Drive
import com.google.api.services.drive.DriveScopes
import com.google.api.services.drive.model.File as DriveFile
import java.io.ByteArrayOutputStream
import java.util.Collections

/**
 * Stores a small (<1 KB) opaque backup blob in the user's Google Drive
 * `appDataFolder` via the Drive v3 REST API. Mirrors the helper-file split used
 * by the iOS `CloudKitBackupStore`.
 *
 * Files live in the special `appDataFolder` space: a hidden, per-app folder that
 * syncs with the user's own Drive and is invisible to other apps and to the
 * user's normal Drive UI. We only move opaque bytes; the file name is the
 * caller-supplied `id`. The MIME type is generic binary.
 *
 * NOTE (configured later): construction depends on a signed-in Google account
 * that has granted `DriveScopes.DRIVE_APPDATA`. The app's Google Sign-In flow
 * must request that scope; `from()` returns null until then so callers can
 * degrade gracefully (and `isAvailable()` reflects the same).
 */
class DriveBackupStore private constructor(private val drive: Drive) {
  companion object {
    private const val APP_DATA_FOLDER = "appDataFolder"
    private const val MIME_BINARY = "application/octet-stream"
    // Drive API client identifier for request attribution. Not the folder
    // name — that is APP_DATA_FOLDER — so changing it orphans nothing.
    private const val APP_NAME = "Mercury"

    /** True when a signed-in account has granted the Drive appData scope. */
    fun isAvailable(context: Context?): Boolean = from(context) != null

    /**
     * Builds a Drive client from the last signed-in Google account, or null if
     * no account is signed in / the appData scope hasn't been granted.
     */
    fun from(context: Context?): DriveBackupStore? {
      val ctx = context ?: return null
      val account = GoogleSignIn.getLastSignedInAccount(ctx) ?: return null
      val scope = com.google.android.gms.common.api.Scope(DriveScopes.DRIVE_APPDATA)
      if (!GoogleSignIn.hasPermissions(account, scope)) return null

      val credential = GoogleAccountCredential.usingOAuth2(
        ctx,
        Collections.singletonList(DriveScopes.DRIVE_APPDATA),
      )
      credential.selectedAccount = account.account ?: return null

      val drive = Drive.Builder(
        AndroidHttp.newCompatibleTransport(),
        GsonFactory.getDefaultInstance(),
        credential,
      )
        .setApplicationName(APP_NAME)
        .build()
      return DriveBackupStore(drive)
    }
  }

  /** Save-or-update the blob in a file named `id` inside appDataFolder. */
  fun put(id: String, bytes: ByteArray) {
    val content = ByteArrayContent(MIME_BINARY, bytes)
    val existingId = findFileId(id)
    if (existingId != null) {
      // Update the existing file's content (metadata stays the same).
      drive.files().update(existingId, DriveFile(), content).execute()
    } else {
      val metadata = DriveFile().apply {
        name = id
        parents = Collections.singletonList(APP_DATA_FOLDER)
      }
      drive.files().create(metadata, content).setFields("id").execute()
    }
  }

  /** Download the blob stored under `id`, or null if no such file exists. */
  fun get(id: String): ByteArray? {
    val fileId = findFileId(id) ?: return null
    val out = ByteArrayOutputStream()
    drive.files().get(fileId).executeMediaAndDownloadTo(out)
    return out.toByteArray()
  }

  /** Delete the file named `id` from appDataFolder. No-op if absent. */
  fun delete(id: String) {
    val fileId = findFileId(id) ?: return
    drive.files().delete(fileId).execute()
  }

  /** Resolve the Drive file id for the appData file named `id`, or null. */
  private fun findFileId(id: String): String? {
    val result = drive.files().list()
      .setSpaces(APP_DATA_FOLDER)
      // Escape single quotes in the name to keep the query well-formed.
      .setQ("name = '${id.replace("'", "\\'")}'")
      .setFields("files(id, name)")
      .setPageSize(1)
      .execute()
    return result.files?.firstOrNull()?.id
  }
}
