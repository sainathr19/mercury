import CloudKit
import Foundation

/// Stores a small (<1 KB) opaque backup blob in the user's iCloud CloudKit
/// private database. Mirrors the helper-file split used by `secure-keystore`
/// (`SecureEnclaveKeystore`).
///
/// - Record type: `WalletBackup`
/// - Record name: the caller-supplied `id` (the record's `CKRecord.ID`)
/// - Blob field: `blob` (a `Data` field; well under CloudKit's 1 MB per-record
///   inline limit, so no `CKAsset` is needed for our <1 KB payload).
///
/// All access is the user's PRIVATE database, so the data lives in the user's
/// own iCloud and never on our servers. We only move opaque bytes here.
///
/// NOTE (configured later): `CKContainer.default()` resolves to
/// `iCloud.$(CFBundleIdentifier)` and requires the iCloud + CloudKit entitlement
/// + container to exist. Until that's wired up, `isAvailable()` returns false
/// and the mutating calls throw — by design we do not crash at build time.
enum CloudKitBackupStore {
  private static let recordType = "WalletBackup"
  private static let blobField = "blob"

  private static var privateDatabase: CKDatabase {
    CKContainer.default().privateCloudDatabase
  }

  /// True when an iCloud account is signed in and usable on this device.
  static func isAvailable() async throws -> Bool {
    let status = try await CKContainer.default().accountStatus()
    return status == .available
  }

  /// Save-or-update the blob for `id` (idempotent). Fetches the existing record
  /// first so the CloudKit `recordChangeTag` stays valid on overwrite; falls
  /// back to creating a fresh record when none exists yet.
  static func put(id: String, blob: Data) async throws {
    let recordID = CKRecord.ID(recordName: id)
    let record: CKRecord
    do {
      record = try await privateDatabase.record(for: recordID)
    } catch let error as CKError where error.code == .unknownItem {
      record = CKRecord(recordType: recordType, recordID: recordID)
    }
    record[blobField] = blob as CKRecordValue
    _ = try await privateDatabase.save(record)
  }

  /// Returns the stored blob for `id`, or `nil` when no backup record exists.
  static func get(id: String) async throws -> Data? {
    let recordID = CKRecord.ID(recordName: id)
    do {
      let record = try await privateDatabase.record(for: recordID)
      return record[blobField] as? Data
    } catch let error as CKError where error.code == .unknownItem {
      return nil
    }
  }

  /// Removes the backup for `id`. No-op when the record doesn't exist.
  static func delete(id: String) async throws {
    let recordID = CKRecord.ID(recordName: id)
    do {
      _ = try await privateDatabase.deleteRecord(withID: recordID)
    } catch let error as CKError where error.code == .unknownItem {
      // Already absent — deletion is idempotent.
    }
  }
}
