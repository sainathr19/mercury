import Foundation
import LocalAuthentication
import Security

/// Secure Enclave + Keychain keystore. Ported from the iOS reference app's
/// `WalletKeystore`, minus the UniFFI `KeystoreBackend` conformance (that lives
/// in JS, which delegates here).
///
/// - `wrap`:   generate/look up a P-256 keypair in the Secure Enclave tagged by
///             `alias`, ECIES-encrypt the plaintext under its public key.
/// - `unwrap`: look up the keypair and decrypt (triggers Face ID on device).
/// - `remove`: delete the SE key for `alias`.
///
/// On the simulator (no Secure Enclave / biometrics) it transparently falls
/// back to a plain Keychain P-256 key with no access-control prompt.
enum SecureEnclaveKeystore {
  private static let serviceTag = "run.mercury.wallet.keystore"
  /// The tag keys were created under before the rename. Looked up as a fallback
  /// so an existing install's Enclave key is not orphaned by a cosmetic change.
  private static let legacyServiceTag = "com.standard.wallet.keystore"
  /// Shown in the Face ID sheet — this one is read by users, not just by code.
  private static let prompt = "Unlock your Mercury wallet"
  private static let algorithm: SecKeyAlgorithm = .eciesEncryptionCofactorVariableIVX963SHA256AESGCM

  struct KeystoreError: LocalizedError {
    let message: String
    var errorDescription: String? { message }
  }

  // MARK: - Public API

  static func wrap(plaintext: Data, alias: String) throws -> Data {
    let publicKey = try ensureKey(alias: alias).publicKey
    guard SecKeyIsAlgorithmSupported(publicKey, .encrypt, algorithm) else {
      throw KeystoreError(message: "public key: algorithm unsupported")
    }
    var err: Unmanaged<CFError>?
    guard let cipher = SecKeyCreateEncryptedData(publicKey, algorithm, plaintext as CFData, &err) as Data? else {
      throw KeystoreError(message: "encrypt: \(err?.takeRetainedValue().localizedDescription ?? "?")")
    }
    return cipher
  }

  static func unwrap(ciphertext: Data, alias: String) throws -> Data {
    let context = LAContext()
    context.localizedReason = prompt
    let privateKey = try fetchKey(alias: alias, context: context)
    guard SecKeyIsAlgorithmSupported(privateKey, .decrypt, algorithm) else {
      throw KeystoreError(message: "private key: algorithm unsupported")
    }
    var err: Unmanaged<CFError>?
    guard let plaintext = SecKeyCreateDecryptedData(privateKey, algorithm, ciphertext as CFData, &err) as Data? else {
      throw KeystoreError(message: "decrypt: \(err?.takeRetainedValue().localizedDescription ?? "?")")
    }
    return plaintext
  }

  static func remove(alias: String) throws {
    // Both tags: a key left under the old one would still unwrap the seed, so
    // "forget this wallet" would not have forgotten it.
    for t in [tag(for: alias), legacyTag(for: alias)] {
      let query: [String: Any] = [
        kSecClass as String: kSecClassKey,
        kSecAttrApplicationTag as String: t,
        kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
      ]
      let status = SecItemDelete(query as CFDictionary)
      if status != errSecSuccess && status != errSecItemNotFound {
        throw KeystoreError(message: "delete: OSStatus \(status)")
      }
    }
  }

  // MARK: - SE keypair lifecycle

  private struct KeyPair { let privateKey: SecKey; let publicKey: SecKey }

  private static func ensureKey(alias: String) throws -> KeyPair {
    if let existing = try? fetchKey(alias: alias, context: nil) {
      guard let pub = SecKeyCopyPublicKey(existing) else {
        throw KeystoreError(message: "ensureKey: cannot copy public key")
      }
      return KeyPair(privateKey: existing, publicKey: pub)
    }
    return try generateKey(alias: alias)
  }

  /// Whether the key backing `alias` lives in the Secure Enclave.
  ///
  /// Reported rather than assumed. Key generation falls back to a software
  /// keychain key when the Enclave refuses, the access-control prompt looks
  /// identical either way, and a device that quietly downgraded is otherwise
  /// indistinguishable from one that did not.
  static func isHardwareBacked(alias: String) -> Bool {
    guard let key = try? fetchKey(alias: alias, context: nil),
          let attrs = SecKeyCopyAttributes(key) as? [String: Any] else { return false }
    return (attrs[kSecAttrTokenID as String] as? String) == (kSecAttrTokenIDSecureEnclave as String)
  }

  private static func generateKey(alias: String) throws -> KeyPair {
    let access = try makeAccessControl()
    let baseAttrs: [String: Any] = [
      kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
      kSecAttrKeySizeInBits as String: 256,
      kSecPrivateKeyAttrs as String: [
        kSecAttrIsPermanent as String: true,
        kSecAttrApplicationTag as String: tag(for: alias),
        kSecAttrAccessControl as String: access,
      ],
    ]

    #if !targetEnvironment(simulator)
    var seAttrs = baseAttrs
    seAttrs[kSecAttrTokenID as String] = kSecAttrTokenIDSecureEnclave
    var seError: Unmanaged<CFError>?
    if let priv = SecKeyCreateRandomKey(seAttrs as CFDictionary, &seError) {
      guard let pub = SecKeyCopyPublicKey(priv) else {
        throw KeystoreError(message: "SecKeyCopyPublicKey returned nil")
      }
      return KeyPair(privateKey: priv, publicKey: pub)
    }
    #endif

    // Reached on the simulator, and on a device whose Enclave refused the key.
    // The second case is a real downgrade to a software keychain key — still
    // access-controlled, but extractable in a way an Enclave key is not.
    // `isHardwareBacked` is how the app finds out which happened.
    var fallbackError: Unmanaged<CFError>?
    guard let priv = SecKeyCreateRandomKey(baseAttrs as CFDictionary, &fallbackError) else {
      throw KeystoreError(message: "SecKeyCreateRandomKey: \(fallbackError?.takeRetainedValue().localizedDescription ?? "?")")
    }
    guard let pub = SecKeyCopyPublicKey(priv) else {
      throw KeystoreError(message: "SecKeyCopyPublicKey returned nil")
    }
    return KeyPair(privateKey: priv, publicKey: pub)
  }

  private static func makeAccessControl() throws -> SecAccessControl {
    #if targetEnvironment(simulator)
    let flags: SecAccessControlCreateFlags = []
    #else
    // Gate the key on biometry OR the device passcode: Face ID first, with the
    // system's automatic fallback to the iPhone passcode if a face isn't
    // recognized (instead of a "Face ID attempts exceeded" dead end).
    // `.userPresence` does not invalidate the key when biometric enrollment
    // changes, so a re-enrolled face / passcode can still unwrap the seed.
    let flags: SecAccessControlCreateFlags = [.privateKeyUsage, .userPresence]
    #endif
    var error: Unmanaged<CFError>?
    guard let access = SecAccessControlCreateWithFlags(
      kCFAllocatorDefault, kSecAttrAccessibleWhenUnlockedThisDeviceOnly, flags, &error
    ) else {
      throw KeystoreError(message: "access control: \(error?.takeRetainedValue().localizedDescription ?? "?")")
    }
    return access
  }

  private static func fetchKey(alias: String, context: LAContext?) throws -> SecKey {
    for t in [tag(for: alias), legacyTag(for: alias)] {
      switch lookup(tag: t, context: context) {
      case .found(let key):
        return key
      case .missing:
        continue // try the pre-rename tag before giving up
      case .authFailed(let status):
        // A cancelled or failed prompt is NOT "no such key". Reporting it as one
        // would send the caller looking for a missing wallet instead of telling
        // the user their authentication did not go through.
        throw KeystoreError(message: "biometry failed: OSStatus \(status)")
      case .failed(let status):
        throw KeystoreError(message: "fetchKey: OSStatus \(status)")
      }
    }
    throw KeystoreError(message: "no SE key for alias \(alias)")
  }

  private enum Lookup {
    case found(SecKey)
    case missing
    case authFailed(OSStatus)
    case failed(OSStatus)
  }

  private static func lookup(tag: Data, context: LAContext?) -> Lookup {
    var query: [String: Any] = [
      kSecClass as String: kSecClassKey,
      kSecAttrApplicationTag as String: tag,
      kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
      kSecReturnRef as String: true,
    ]
    if let ctx = context { query[kSecUseAuthenticationContext as String] = ctx }

    var item: AnyObject?
    let status = SecItemCopyMatching(query as CFDictionary, &item)
    switch status {
    case errSecSuccess: return .found(item as! SecKey)
    case errSecItemNotFound: return .missing
    case errSecUserCanceled, errSecAuthFailed: return .authFailed(status)
    default: return .failed(status)
    }
  }

  private static func tag(for alias: String) -> Data {
    Data("\(serviceTag).\(alias)".utf8)
  }

  private static func legacyTag(for alias: String) -> Data {
    Data("\(legacyServiceTag).\(alias)".utf8)
  }
}
