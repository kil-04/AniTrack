package com.sanjay.anitrack.next.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.*
import com.sanjay.anitrack.next.data.providers.AnimeProvider
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/** Provider-neutral, explicit verification entry. Recomposition never opens a browser. */
@Composable
internal fun ProviderAccessControls(provider: AnimeProvider?, onConnected: () -> Unit = {}) {
    val access = provider?.access ?: return
    val state by access.state.collectAsState()
    val scope = rememberCoroutineScope()
    var failure by remember(provider.descriptor.id, state.generation) { mutableStateOf<String?>(null) }
    Column {
        Text(failure ?: state.message, style = MaterialTheme.typography.labelSmall)
        Row {
            TextButton(enabled = !state.verifying, onClick = {
                scope.launch {
                    failure = null
                    try { if (access.connect()) onConnected() }
                    catch (cancelled: CancellationException) { throw cancelled }
                    catch (_: Exception) { failure = "Unable to connect. You can try again or choose another provider." }
                }
            }) { Text(if (state.ready) "Reconnect ${provider.descriptor.name}" else "Connect ${provider.descriptor.name}") }
            if (state.ready || state.verifying) TextButton(onClick = { access.disconnect() }) { Text("Disconnect") }
        }
    }
}
