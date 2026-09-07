import ExpoModulesCore

/// Expo bridge exposing the Secure Enclave keystore to JavaScript.
///
/// JS passes the seed plaintext as a `Uint8Array`; the actual encryption key
/// is a P-256 keypair generated inside the Secure Enclave and never leaves the
/// chip. Only the wrapped ciphertext crosses back to JS to be persisted by the
/// Rust wallet. Mirrors the iOS reference app's `WalletKeystore`.
public class SecureKeystoreModule: Module {
  public func definition() -> ModuleDefinition {
    Name("SecureKeystore")

    AsyncFunction("wrap") { (plaintext: Data, alias: String) -> Data in
      try SecureEnclaveKeystore.wrap(plaintext: plaintext, alias: alias)
    }

    AsyncFunction("unwrap") { (ciphertext: Data, alias: String) -> Data in
      try SecureEnclaveKeystore.unwrap(ciphertext: ciphertext, alias: alias)
    }

    AsyncFunction("remove") { (alias: String) in
      try SecureEnclaveKeystore.remove(alias: alias)
    }

    /// False means the wrapping key is a software keychain key, not an Enclave
    /// one — either the simulator, or a device where generation fell back.
    AsyncFunction("isHardwareBacked") { (alias: String) -> Bool in
      SecureEnclaveKeystore.isHardwareBacked(alias: alias)
    }
  }
}
