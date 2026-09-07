package expo.modules.securekeystore

import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyInfo
import android.security.keystore.KeyProperties
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Android counterpart of the iOS Secure Enclave keystore.
 *
 * Wraps/unwraps the BIP-39 seed with a hardware-backed AES-256-GCM key in the
 * Android Keystore. The symmetric key never leaves secure hardware — only the
 * IV+ciphertext crosses back to JS to be persisted by the Rust wallet.
 *
 * Deliberately matched to the iOS side, which it previously was not:
 *
 *  • `setUserAuthenticationRequired` mirrors iOS `.userPresence`. Without it the
 *    seed could be unwrapped by anything running in the app process with no
 *    prompt at all, while the same wallet on iOS demanded Face ID or a passcode.
 *  • `setUnlockedDeviceRequired` mirrors `WhenUnlockedThisDeviceOnly`, so the
 *    key is unusable while the screen is locked.
 *  • StrongBox is now requested rather than assumed. The old comment claimed
 *    "TEE/StrongBox" while asking for neither; `isHardwareBacked` reports what
 *    was actually granted instead of describing an intention.
 */
class SecureKeystoreModule : Module() {
  private val androidKeyStore = "AndroidKeyStore"
  private val keyPrefix = "mercury.secure-keystore."
  /** Keys written before the rename. Read so an existing install is not orphaned. */
  private val legacyKeyPrefix = "standard.secure-keystore."
  private val ivLength = 12 // GCM nonce
  private val tagBits = 128

  override fun definition() = ModuleDefinition {
    Name("SecureKeystore")

    AsyncFunction("wrap") { plaintext: ByteArray, alias: String ->
      val key = getOrCreateKey(keyPrefix + alias)
      val cipher = Cipher.getInstance("AES/GCM/NoPadding")
      cipher.init(Cipher.ENCRYPT_MODE, key)
      val iv = cipher.iv
      val ciphertext = cipher.doFinal(plaintext)
      // Layout: [12-byte IV][ciphertext + 16-byte GCM tag]
      iv + ciphertext
    }

    AsyncFunction("unwrap") { ciphertext: ByteArray, alias: String ->
      val key = loadKey(keyPrefix + alias)
        ?: loadKey(legacyKeyPrefix + alias)
        ?: throw Exception("No keystore entry for alias '$alias'")
      val iv = ciphertext.copyOfRange(0, ivLength)
      val body = ciphertext.copyOfRange(ivLength, ciphertext.size)
      val cipher = Cipher.getInstance("AES/GCM/NoPadding")
      cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(tagBits, iv))
      cipher.doFinal(body)
    }

    AsyncFunction("remove") { alias: String ->
      val ks = KeyStore.getInstance(androidKeyStore).apply { load(null) }
      // Both prefixes: "forget this wallet" has to mean it, and a key left
      // behind under the old name would still decrypt the seed.
      for (full in listOf(keyPrefix + alias, legacyKeyPrefix + alias)) {
        if (ks.containsAlias(full)) ks.deleteEntry(full)
      }
    }

    /** Whether the key for `alias` is held in secure hardware (TEE or StrongBox)
     *  rather than by a software provider. Mirrors the iOS check — a downgrade
     *  the user cannot observe is indistinguishable from no downgrade. */
    AsyncFunction("isHardwareBacked") { alias: String ->
      val key = loadKey(keyPrefix + alias) ?: loadKey(legacyKeyPrefix + alias)
      if (key == null) false else hardwareBacked(key)
    }
  }

  private fun hardwareBacked(key: SecretKey): Boolean = try {
    val factory = javax.crypto.SecretKeyFactory.getInstance(key.algorithm, androidKeyStore)
    val info = factory.getKeySpec(key, KeyInfo::class.java) as KeyInfo
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      info.securityLevel != KeyProperties.SECURITY_LEVEL_SOFTWARE
    } else {
      @Suppress("DEPRECATION")
      info.isInsideSecureHardware
    }
  } catch (e: Exception) {
    false // cannot confirm → report the weaker answer
  }

  private fun loadKey(alias: String): SecretKey? {
    val ks = KeyStore.getInstance(androidKeyStore).apply { load(null) }
    val entry = ks.getEntry(alias, null) as? KeyStore.SecretKeyEntry ?: return null
    return entry.secretKey
  }

  private fun getOrCreateKey(alias: String): SecretKey {
    loadKey(alias)?.let { return it }
    val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, androidKeyStore)

    fun spec(strongBox: Boolean) = KeyGenParameterSpec.Builder(
      alias,
      KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
    ).apply {
      setBlockModes(KeyProperties.BLOCK_MODE_GCM)
      setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
      setKeySize(256)

      // iOS `.userPresence` equivalent. Timeout 0 means authenticate for every
      // use rather than opening a window after one unlock.
      setUserAuthenticationRequired(true)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        setUserAuthenticationParameters(
          0,
          KeyProperties.AUTH_BIOMETRIC_STRONG or KeyProperties.AUTH_DEVICE_CREDENTIAL,
        )
      } else {
        @Suppress("DEPRECATION")
        setUserAuthenticationValidityDurationSeconds(-1)
      }

      // Equivalent of kSecAttrAccessibleWhenUnlocked: unusable while locked.
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) setUnlockedDeviceRequired(true)

      if (strongBox && Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) setIsStrongBoxBacked(true)
    }.build()

    // StrongBox first, TEE second. Devices without a StrongBox throw
    // StrongBoxUnavailableException at generation rather than degrading, so the
    // fallback is required — but it is a fallback to the TEE, not to software,
    // and isHardwareBacked reports which was granted.
    return try {
      generator.init(spec(strongBox = true))
      generator.generateKey()
    } catch (e: Exception) {
      generator.init(spec(strongBox = false))
      generator.generateKey()
    }
  }
}
