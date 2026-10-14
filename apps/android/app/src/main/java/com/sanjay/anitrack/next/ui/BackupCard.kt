package com.sanjay.anitrack.next.ui

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.FileDownload
import androidx.compose.material.icons.rounded.FileUpload
import androidx.compose.material.icons.rounded.Inventory2
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.sanjay.anitrack.next.data.Backup
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import java.time.LocalDate

/** Settings: export everything kept on this device to a file, and merge one back in. */
@Composable
internal fun BackupCard() {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }
    var result by remember { mutableStateOf<Pair<String, Boolean>?>(null) }

    fun run(work: suspend () -> String) {
        busy = true
        result = null
        scope.launch {
            result = try {
                work() to true
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                (e.message ?: "Something went wrong.") to false
            }
            busy = false
        }
    }

    val export = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/json")) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        run {
            val out = context.contentResolver.openOutputStream(uri) ?: error("Couldn't write that file.")
            "Saved ${Backup.export(context, out).describe()}."
        }
    }
    val restore = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        run {
            val input = context.contentResolver.openInputStream(uri) ?: error("Couldn't open that file.")
            "Restored ${Backup.import(context, input).describe()}."
        }
    }

    SettingsSection(
        Icons.Rounded.Inventory2,
        "Backup & restore",
        "Save your watch progress, lists, reading progress and settings to a file, or bring them back. " +
            "Restoring keeps whichever entry is newer, so it never rolls progress back. Account sign-ins aren't included.",
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            PillButton(
                "Export backup",
                { export.launch("anitrack-backup-${LocalDate.now()}.json") },
                icon = Icons.Rounded.FileDownload,
                enabled = !busy,
                compact = true,
            )
            PillButton(
                "Restore from file",
                { restore.launch(arrayOf("application/json", "text/plain", "application/octet-stream")) },
                icon = Icons.Rounded.FileUpload,
                enabled = !busy,
                loading = busy,
                compact = true,
            )
        }
        result?.let { (text, ok) ->
            Spacer(Modifier.height(10.dp))
            StatusLine(text, ok)
        }
    }
}
