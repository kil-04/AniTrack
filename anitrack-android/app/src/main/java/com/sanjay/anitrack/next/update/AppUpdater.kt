package com.sanjay.anitrack.next.update

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import androidx.compose.runtime.mutableStateOf
import androidx.core.content.FileProvider
import com.sanjay.anitrack.next.BuildConfig
import com.sanjay.anitrack.next.data.AutomationTrust
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.io.BufferedOutputStream
import java.io.File
import java.io.FileOutputStream
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.security.MessageDigest
import java.util.concurrent.TimeUnit

data class AndroidUpdateInfo(
    val sequence: Long,
    val versionCode: Long,
    val versionName: String,
    val apkUrl: String,
    val sha256: String,
    val sizeBytes: Long,
    val mandatory: Boolean,
    val notes: String,
)

data class AndroidUpdateStatus(
    val phase: String = "idle",
    val info: AndroidUpdateInfo? = null,
    val progress: Int = 0,
    val error: String? = null,
    val lastCheckedAt: Long? = null,
)

object AppUpdater {
    private const val PREFS = "app_updater"
    private const val KEY_MANIFEST = "manifest"
    private const val KEY_SIGNATURE = "manifest_signature"
    // Kept only so installs made from an unreleased development build can
    // discard the old DownloadManager state during migration.
    private const val LEGACY_KEY_DOWNLOAD_ID = "download_id"
    private const val KEY_FILE_NAME = "file_name"
    private const val KEY_VERIFIED_PATH = "verified_path"
    private const val KEY_WAITING_PERMISSION = "waiting_permission"
    private const val KEY_HIGHEST_VERSION = "highest_accepted_version"
    private const val KEY_HIGHEST_MANIFEST_DIGEST = "highest_manifest_digest"
    private const val MAX_APK_BYTES = 250L * 1024 * 1024

    private val http = OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(45, TimeUnit.SECONDS)
        .callTimeout(10, TimeUnit.MINUTES)
        // HTTPS-to-HTTPS redirects (used by GitHub release assets) are fine.
        // Never follow a redirect that crosses to cleartext HTTP.
        .followRedirects(true)
        .followSslRedirects(false)
        .build()
    private val mutex = Mutex()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val main = Handler(Looper.getMainLooper())
    @Volatile private var context: Context? = null
    @Volatile private var initialized = false
    @Volatile private var latestStatus = AndroidUpdateStatus()
    val status = mutableStateOf(AndroidUpdateStatus())

    fun init(value: Context) {
        synchronized(this) {
            if (initialized) return
            initialized = true
            context = value.applicationContext
            restoreState(value.applicationContext)
        }
        scope.launch { recoverInterruptedDownload() }
    }

    private fun prefs() = requireNotNull(context).getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private fun restoreState(ctx: Context) {
        val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val raw = prefs.getString(KEY_MANIFEST, null)
        val signature = prefs.getString(KEY_SIGNATURE, null)
        val parsedInfo = if (raw != null && signature != null &&
            AutomationTrust.verify(raw.toByteArray(Charsets.UTF_8), signature)) {
            runCatching { parseManifest(raw) }.getOrNull()
        } else null
        val highestVersion = prefs.getLong(KEY_HIGHEST_VERSION, BuildConfig.VERSION_CODE.toLong())
        val acceptedDigest = prefs.getString(KEY_HIGHEST_MANIFEST_DIGEST, null)
        val info = parsedInfo?.takeIf {
            it.versionCode >= highestVersion &&
                (it.versionCode != highestVersion || highestVersion <= BuildConfig.VERSION_CODE ||
                    acceptedDigest == digest(raw!!.toByteArray(Charsets.UTF_8)))
        }
        val verifiedPath = prefs.getString(KEY_VERIFIED_PATH, null)
        val phase = when {
            info != null && info.versionCode > BuildConfig.VERSION_CODE &&
                verifiedPath != null && File(verifiedPath).isFile -> "ready"
            info != null && info.versionCode > BuildConfig.VERSION_CODE -> "available"
            else -> "idle"
        }
        publish(AndroidUpdateStatus(phase = phase, info = info))
    }

    suspend fun checkForUpdate(): Boolean = withContext(Dispatchers.IO) {
        val initializedContext = context ?: return@withContext false
        init(initializedContext)
        var shouldDownload = false
        val ok = mutex.withLock {
            val checkedAt = System.currentTimeMillis()
            publish(latestStatus.copy(phase = "checking", error = null, lastCheckedAt = checkedAt))
            try {
                val manifestResponse = withContext(Dispatchers.IO) {
                    http.newCall(
                        Request.Builder().url(BuildConfig.ANDROID_UPDATE_MANIFEST_URL)
                            .header("Accept", "application/json")
                            .header("Cache-Control", "no-cache")
                            .build(),
                    ).execute()
                }
                if (manifestResponse.code == 404) {
                    manifestResponse.close()
                    publish(AndroidUpdateStatus(phase = "idle", lastCheckedAt = checkedAt))
                    return@withLock true
                }
                val bytes = manifestResponse.use {
                    if (!it.isSuccessful) error("Update server returned HTTP ${it.code}")
                    AutomationTrust.readBounded(it.body, 64 * 1024, "Update manifest")
                }
                val signatureResponse = withContext(Dispatchers.IO) {
                    http.newCall(Request.Builder().url(BuildConfig.ANDROID_UPDATE_SIGNATURE_URL).build()).execute()
                }
                val signature = signatureResponse.use {
                    if (!it.isSuccessful) error("Update signature returned HTTP ${it.code}")
                    AutomationTrust.readBounded(it.body, 4 * 1024, "Update signature")
                        .toString(Charsets.UTF_8).trim()
                }
                require(AutomationTrust.verify(bytes, signature)) { "Update manifest signature is invalid" }
                val raw = bytes.toString(Charsets.UTF_8)
                val info = parseManifest(raw)
                val existing = latestStatus.info
                val highestAccepted = maxOf(
                    BuildConfig.VERSION_CODE.toLong(),
                    prefs().getLong(KEY_HIGHEST_VERSION, BuildConfig.VERSION_CODE.toLong()),
                    existing?.versionCode ?: 0L,
                )
                val manifestDigest = digest(bytes)
                val cachedDigest = prefs().getString(KEY_HIGHEST_MANIFEST_DIGEST, null)
                    ?: prefs().getString(KEY_MANIFEST, null)
                        ?.takeIf { existing?.versionCode == highestAccepted }
                        ?.let { digest(it.toByteArray(Charsets.UTF_8)) }
                require(info.versionCode >= highestAccepted) { "Update manifest rollback was rejected" }
                if (info.versionCode == highestAccepted && highestAccepted > BuildConfig.VERSION_CODE) {
                    require(cachedDigest != null && cachedDigest == manifestDigest) {
                        "Update changed without increasing its version"
                    }
                }
                if (info.versionCode <= BuildConfig.VERSION_CODE) {
                    clearDownloadState(deleteFile = true)
                    publish(AndroidUpdateStatus(phase = "idle", info = info, lastCheckedAt = checkedAt))
                    return@withLock true
                }
                if (existing?.versionCode != info.versionCode) clearDownloadState(deleteFile = true)
                require(
                    prefs().edit()
                        .putString(KEY_MANIFEST, raw)
                        .putString(KEY_SIGNATURE, signature)
                        .putLong(KEY_HIGHEST_VERSION, info.versionCode)
                        .putString(KEY_HIGHEST_MANIFEST_DIGEST, manifestDigest)
                        .commit(),
                ) { "Could not store update manifest" }
                val verified = prefs().getString(KEY_VERIFIED_PATH, null)
                    ?.let(::File)
                    ?.takeIf { existing?.versionCode == info.versionCode && it.isFile }
                val phase = if (verified != null) "ready" else "available"
                publish(
                    AndroidUpdateStatus(
                        phase = phase,
                        info = info,
                        progress = if (verified != null) 100 else 0,
                        lastCheckedAt = checkedAt,
                    ),
                )
                shouldDownload = verified == null && isUnmetered() && prefs().getBoolean("auto_download_wifi", true)
                true
            } catch (error: Exception) {
                publish(
                    latestStatus.copy(
                        phase = if (latestStatus.info != null) latestStatus.phase else "error",
                        error = error.message ?: "Update check failed",
                        lastCheckedAt = checkedAt,
                    ),
                )
                false
            }
        }
        if (!ok) return@withContext false
        return@withContext if (shouldDownload) downloadUpdateAwaited(requireUnmetered = true) else true
    }

    fun setAutoDownloadWifi(enabled: Boolean) {
        prefs().edit().putBoolean("auto_download_wifi", enabled).apply()
    }

    fun autoDownloadWifi(): Boolean = prefs().getBoolean("auto_download_wifi", true)

    fun downloadUpdate() {
        // A button press is explicit consent to use the current connection.
        scope.launch { downloadUpdateAwaited(requireUnmetered = false) }
    }

    private suspend fun downloadUpdateAwaited(requireUnmetered: Boolean): Boolean =
        withContext(Dispatchers.IO) { mutex.withLock {
        val ctx = context ?: return@withLock false
        val info = latestStatus.info ?: return@withLock false
        if (latestStatus.phase == "ready" &&
            prefs().getString(KEY_VERIFIED_PATH, null)?.let(::File)?.isFile == true) {
            return@withLock true
        }
        require(info.versionCode > BuildConfig.VERSION_CODE) { "Update version is not newer than this app" }
        val fileName = "AniTrack-Next-${info.versionCode}.apk"
        val finalFile = updateFile(fileName)
        val tempFile = updateFile(".$fileName.part.apk")
        try {
            require(!requireUnmetered || isUnmetered()) {
                "Automatic update download is waiting for an unmetered Wi-Fi connection"
            }
            tempFile.delete()
            finalFile.delete()
            require(prefs().edit().putString(KEY_FILE_NAME, fileName).remove(KEY_VERIFIED_PATH).commit()) {
                "Could not save download state"
            }
            publish(AndroidUpdateStatus("downloading", info, 0, lastCheckedAt = latestStatus.lastCheckedAt))

            val request = Request.Builder()
                .url(info.apkUrl)
                .header("Accept", "application/vnd.android.package-archive, application/octet-stream")
                // Prevent transparent decompression from invalidating the signed byte count.
                .header("Accept-Encoding", "identity")
                .header("Cache-Control", "no-cache")
                .build()
            val response = http.newCall(request).execute()
            response.use {
                require(it.code == 200) { "Update download returned HTTP ${it.code}" }
                var hop: okhttp3.Response? = it
                while (hop != null) {
                    require(hop.request.url.isHttps) { "Update download left HTTPS" }
                    hop = hop.priorResponse
                }
                require(it.header("Content-Encoding")?.equals("identity", ignoreCase = true) != false) {
                    "Update server unexpectedly encoded the APK"
                }
                val declaredSizes = it.headers.values("Content-Length")
                if (declaredSizes.isNotEmpty()) {
                    require(declaredSizes.size == 1) { "Update server returned ambiguous content length" }
                    val declaredSize = declaredSizes.single().toLongOrNull()
                        ?: error("Update server returned an invalid content length")
                    require(declaredSize == info.sizeBytes) {
                        "Update server size does not match the signed manifest"
                    }
                }
                val body = it.body ?: error("Update server returned an empty response")
                val bodyLength = body.contentLength()
                if (bodyLength >= 0) require(bodyLength == info.sizeBytes) {
                    "Update response size does not match the signed manifest"
                }

                val apkDigest = MessageDigest.getInstance("SHA-256")
                var total = 0L
                var lastProgress = -1
                body.byteStream().buffered().use { input ->
                    FileOutputStream(tempFile).use { fileOutput ->
                        BufferedOutputStream(fileOutput, 128 * 1024).use { output ->
                            val buffer = ByteArray(128 * 1024)
                            while (true) {
                                require(!requireUnmetered || isUnmetered()) {
                                    "Automatic update download paused because Wi-Fi became metered"
                                }
                                // Read at most one byte beyond the signed ceiling, so an
                                // oversized response is rejected at the first extra byte.
                                val maxRead = minOf(
                                    buffer.size.toLong(),
                                    info.sizeBytes - total + 1,
                                ).toInt()
                                val read = input.read(buffer, 0, maxRead)
                                if (read < 0) break
                                require(total + read <= info.sizeBytes) {
                                    "Update download exceeded the signed size"
                                }
                                output.write(buffer, 0, read)
                                apkDigest.update(buffer, 0, read)
                                total += read
                                val progress = ((total * 100) / info.sizeBytes).toInt().coerceIn(0, 99)
                                if (progress != lastProgress) {
                                    lastProgress = progress
                                    publish(latestStatus.copy(phase = "downloading", progress = progress, error = null))
                                }
                            }
                            require(total == info.sizeBytes) {
                                "Update download ended before the signed size"
                            }
                            output.flush()
                            fileOutput.fd.sync()
                        }
                    }
                }
                val actualHash = apkDigest.digest().joinToString("") { byte -> "%02x".format(byte) }
                require(actualHash.equals(info.sha256, ignoreCase = true)) { "Downloaded APK checksum is invalid" }
            }

            publish(latestStatus.copy(phase = "verifying", progress = 100, error = null))
            require(tempFile.length() == info.sizeBytes) { "Downloaded APK size changed during verification" }
            verifyPackageAndSigner(ctx, tempFile, info.versionCode)
            Files.move(
                tempFile.toPath(),
                finalFile.toPath(),
                StandardCopyOption.ATOMIC_MOVE,
                StandardCopyOption.REPLACE_EXISTING,
            )
            require(finalFile.isFile && finalFile.length() == info.sizeBytes) { "Could not promote verified update" }
            require(
                prefs().edit()
                    .remove(LEGACY_KEY_DOWNLOAD_ID)
                    .putString(KEY_VERIFIED_PATH, finalFile.absolutePath)
                    .commit(),
            ) { "Could not save verified update" }
            publish(latestStatus.copy(phase = "ready", progress = 100, error = null))
            true
        } catch (error: Exception) {
            tempFile.delete()
            finalFile.delete()
            clearDownloadState(deleteFile = false)
            publish(latestStatus.copy(phase = "available", progress = 0, error = error.message ?: "Download failed"))
            false
        }
    } }

    private suspend fun recoverInterruptedDownload() = withContext(Dispatchers.IO) { mutex.withLock {
        val ctx = context ?: return@withLock
        prefs().edit().remove(LEGACY_KEY_DOWNLOAD_ID).apply()
        val root = updateRoot()
        root.listFiles()?.filter { it.name.endsWith(".part.apk") }?.forEach(File::delete)
        val info = latestStatus.info ?: return@withLock
        if (prefs().getString(KEY_VERIFIED_PATH, null)?.let(::File)?.isFile == true) return@withLock
        val fileName = prefs().getString(KEY_FILE_NAME, null) ?: return@withLock
        val candidate = updateFile(fileName)
        if (!candidate.isFile) return@withLock
        try {
            require(candidate.length() == info.sizeBytes) { "Interrupted update size is invalid" }
            require(sha256(candidate).equals(info.sha256, ignoreCase = true)) { "Interrupted update checksum is invalid" }
            verifyPackageAndSigner(ctx, candidate, info.versionCode)
            require(prefs().edit().putString(KEY_VERIFIED_PATH, candidate.absolutePath).commit()) {
                "Could not restore verified update"
            }
            publish(latestStatus.copy(phase = "ready", progress = 100, error = null))
        } catch (_: Exception) {
            candidate.delete()
            clearDownloadState(deleteFile = false)
            publish(
                latestStatus.copy(
                    phase = "available",
                    progress = 0,
                    error = "Interrupted update download was discarded",
                ),
            )
        }
    } }

    fun install(activity: Activity) {
        val path = prefs().getString(KEY_VERIFIED_PATH, null) ?: return
        val file = File(path)
        if (!file.isFile) {
            clearDownloadState(false)
            publish(latestStatus.copy(phase = "available", error = "Verified update file is missing"))
            return
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !activity.packageManager.canRequestPackageInstalls()) {
            prefs().edit().putBoolean(KEY_WAITING_PERMISSION, true).apply()
            activity.startActivity(
                Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${activity.packageName}")),
            )
            return
        }
        prefs().edit().putBoolean(KEY_WAITING_PERMISSION, false).apply()
        val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.updates", file)
        activity.startActivity(
            Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, "application/vnd.android.package-archive")
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            },
        )
    }

    fun resumePendingInstall(activity: Activity) {
        if (!initialized || context == null) return
        if (!prefs().getBoolean(KEY_WAITING_PERMISSION, false)) return
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || activity.packageManager.canRequestPackageInstalls()) {
            install(activity)
        }
    }

    private fun parseManifest(raw: String): AndroidUpdateInfo {
        val json = JSONObject(raw)
        require(json.optInt("schemaVersion") == 1) { "Unsupported update schema" }
        require(json.getString("applicationId") == BuildConfig.APPLICATION_ID) { "Update targets another app" }
        val apkUrl = json.getString("apkUrl")
        val uri = Uri.parse(apkUrl)
        require(uri.scheme == "https" && uri.host?.lowercase() in setOf("github.com", "objects.githubusercontent.com")) {
            "Update URL is not trusted"
        }
        val hash = json.getString("sha256").lowercase()
        require(hash.matches(Regex("[a-f0-9]{64}"))) { "Update checksum is invalid" }
        val size = json.getLong("sizeBytes")
        require(size in 1_000_000..MAX_APK_BYTES) { "Update size is invalid" }
        val sequence = json.getLong("sequence")
        val versionCode = json.getLong("versionCode")
        require(versionCode > 0 && sequence == versionCode) { "Update version sequence is invalid" }
        val versionName = json.getString("versionName")
        require(versionName.length in 1..40) { "Update version name is invalid" }
        return AndroidUpdateInfo(
            sequence = sequence,
            versionCode = versionCode,
            versionName = versionName,
            apkUrl = apkUrl,
            sha256 = hash,
            sizeBytes = size,
            mandatory = json.optBoolean("mandatory", false),
            notes = json.optString("notes").take(2_000),
        )
    }

    @Suppress("DEPRECATION")
    private fun verifyPackageAndSigner(ctx: Context, apk: File, expectedVersion: Long) {
        val pm = ctx.packageManager
        val archive = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            pm.getPackageArchiveInfo(apk.absolutePath, PackageManager.GET_SIGNING_CERTIFICATES)
        } else {
            pm.getPackageArchiveInfo(apk.absolutePath, PackageManager.GET_SIGNATURES)
        } ?: error("Android could not parse the downloaded APK")
        require(archive.packageName == BuildConfig.APPLICATION_ID) { "Downloaded APK package name is invalid" }
        val archiveVersion = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) archive.longVersionCode
            else archive.versionCode.toLong()
        require(archiveVersion == expectedVersion && archiveVersion > BuildConfig.VERSION_CODE) {
            "Downloaded APK version is invalid"
        }
        val current = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            pm.getPackageInfo(ctx.packageName, PackageManager.PackageInfoFlags.of(PackageManager.GET_SIGNING_CERTIFICATES.toLong()))
        } else {
            pm.getPackageInfo(
                ctx.packageName,
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) PackageManager.GET_SIGNING_CERTIFICATES
                else PackageManager.GET_SIGNATURES,
            )
        }
        val archiveSignatures = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            archive.signingInfo?.apkContentsSigners.orEmpty()
        } else archive.signatures.orEmpty()
        val currentSignatures = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            current.signingInfo?.apkContentsSigners.orEmpty()
        } else current.signatures.orEmpty()
        val archiveDigests = archiveSignatures.map { digest(it.toByteArray()) }.toSet()
        val currentDigests = currentSignatures.map { digest(it.toByteArray()) }.toSet()
        val pinnedDigest = BuildConfig.ANDROID_RELEASE_CERT_SHA256.lowercase()
        require(currentDigests == setOf(pinnedDigest)) {
            "Installed app signing certificate is not trusted for automatic updates"
        }
        require(archiveDigests.isNotEmpty() && archiveDigests == currentDigests) {
            "Downloaded APK signing certificate does not match the installed app"
        }
    }

    private fun updateFile(name: String): File {
        require(name.matches(Regex("[A-Za-z0-9._-]{1,100}"))) { "Invalid update file name" }
        return File(updateRoot(), name)
    }

    private fun updateRoot(): File {
        val root = File(requireNotNull(context).filesDir, "updates")
        require(root.isDirectory || root.mkdirs()) { "Could not create private update directory" }
        return root
    }

    private fun clearDownloadState(deleteFile: Boolean) {
        if (deleteFile) {
            prefs().getString(KEY_FILE_NAME, null)?.let { updateFile(it).delete() }
            prefs().getString(KEY_VERIFIED_PATH, null)?.let { File(it).delete() }
        }
        prefs().edit()
            .remove(LEGACY_KEY_DOWNLOAD_ID)
            .remove(KEY_FILE_NAME)
            .remove(KEY_VERIFIED_PATH)
            .remove(KEY_WAITING_PERMISSION)
            .apply()
    }

    private fun isUnmetered(): Boolean {
        val manager = context?.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager ?: return false
        val network = manager.activeNetwork ?: return false
        val capabilities = manager.getNetworkCapabilities(network) ?: return false
        return capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) &&
            capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED)
    }

    private fun sha256(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().buffered().use { input ->
            val buffer = ByteArray(128 * 1024)
            while (true) {
                val read = input.read(buffer)
                if (read < 0) break
                digest.update(buffer, 0, read)
            }
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }

    private fun digest(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256")
        .digest(bytes)
        .joinToString("") { "%02x".format(it) }

    private fun publish(next: AndroidUpdateStatus) {
        latestStatus = next
        if (Looper.myLooper() == Looper.getMainLooper()) status.value = next
        else main.post { status.value = next }
    }
}
