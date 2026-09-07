import ExpoModulesCore

/// Expo bridge exposing the user's iCloud CloudKit private database to JS for a
/// zero-knowledge wallet backup.
///
/// JS passes an opaque, already-encrypted blob as a `Uint8Array` (Expo marshals
/// it to `Data`); this module only stores/fetches those bytes in the user's own
/// CloudKit private database. It never sees keys or seeds. Mirrors
/// `SecureKeystoreModule`.
///
/// NOTE (configured later): this requires the iCloud + CloudKit capability and a
/// container id to be added to the app's entitlements
/// (`com.apple.developer.icloud-container-identifiers` /
/// `com.apple.developer.icloud-services = CloudKit`). `CloudKitBackupStore`
/// uses `CKContainer.default()`, which resolves to `iCloud.$(CFBundleIdentifier)`
/// once the entitlement exists. We intentionally do NOT hard-fail at build time
/// if the entitlement is absent — calls simply error/return unavailable at
/// runtime until a human wires up the container (see report).
public class CloudBackupModule: Module {
  public func definition() -> ModuleDefinition {
    Name("CloudBackup")

    AsyncFunction("isAvailable") { () async throws -> Bool in
      try await CloudKitBackupStore.isAvailable()
    }

    AsyncFunction("putBlob") { (id: String, bytes: Data) async throws in
      try await CloudKitBackupStore.put(id: id, blob: bytes)
    }

    AsyncFunction("getBlob") { (id: String) async throws -> Data? in
      try await CloudKitBackupStore.get(id: id)
    }

    AsyncFunction("deleteBlob") { (id: String) async throws in
      try await CloudKitBackupStore.delete(id: id)
    }
  }
}
