package expo.modules.cloudbackup

import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Android counterpart of the iOS CloudKit cloud backup.
 *
 * Stores a small (<1 KB) opaque, already-encrypted blob in the user's own
 * Google Drive `appDataFolder` (the hidden, per-app folder only this app can
 * see). JS passes the blob as a `Uint8Array` (Expo marshals to `ByteArray`);
 * this module only moves bytes and never sees keys or seeds. API mirrors
 * `CloudBackupModule.swift`.
 *
 * - `putBlob` creates-or-updates a file named `id` in appDataFolder (idempotent).
 * - `getBlob` finds + downloads the file for `id`, or returns null if absent.
 * - `deleteBlob` removes the file for `id` (no-op if absent).
 * - `isAvailable` reflects whether a signed-in account with the Drive appData
 *   scope is available.
 *
 * NOTE (configured later): the Drive OAuth scope
 * (`DriveScopes.DRIVE_APPDATA`) and a signed-in `GoogleAccountCredential` must
 * be wired up by the app's Google Sign-In flow before these calls succeed.
 * Until then `isAvailable` returns false and the mutating calls throw — by
 * design we do not hard-fail at build time. See `DriveBackupStore`.
 */
class CloudBackupModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("CloudBackup")

    AsyncFunction("isAvailable") {
      DriveBackupStore.isAvailable(appContext.reactContext)
    }

    AsyncFunction("putBlob") { id: String, bytes: ByteArray ->
      val drive = store() ?: throw unavailable()
      drive.put(id, bytes)
    }

    AsyncFunction("getBlob") { id: String ->
      val drive = store() ?: throw unavailable()
      drive.get(id) // ByteArray or null
    }

    AsyncFunction("deleteBlob") { id: String ->
      val drive = store() ?: throw unavailable()
      drive.delete(id)
    }
  }

  private fun store(): DriveBackupStore? = DriveBackupStore.from(appContext.reactContext)

  private fun unavailable() =
    CodedException("ERR_CLOUD_BACKUP", "Google Drive is unavailable — sign in and grant the Drive appData scope", null)
}
