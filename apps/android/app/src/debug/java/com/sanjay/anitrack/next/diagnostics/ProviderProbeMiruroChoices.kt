package com.sanjay.anitrack.next.diagnostics

/** Only fixed public coordinates may be reported; arbitrary upstream labels remain on-device. */
internal object ProviderProbeMiruroChoices {
    private val providers = mapOf("anikoto" to "ANIKOTO", "kickassanime" to "KICKASSANIME", "aniwaves" to "ANIWAVES")
    private val servers = mapOf(
        "anikoto" to setOf("HD-1", "HD-2"),
        "kickassanime" to setOf("Vid", "Bird", "Duck"),
        "aniwaves" to setOf("Vidplay", "Mp4upload", "Streamtape"),
    )
    private val tracks = mapOf("ssub" to "Soft sub", "sub" to "Sub", "dub" to "Dub")

    fun label(variantId: String): String? {
        if (variantId.length > 200) return null
        val parts = variantId.split(':')
        if (parts.size != 4) return null
        val track = tracks[parts[0]] ?: return null
        val provider = providers[parts[1]] ?: return null
        val occurrence = parts[3].toIntOrNull() ?: return null
        if (parts[2] !in servers[parts[1]].orEmpty() || occurrence !in 0..31) return null
        // Every emitted value is from the fixed local sets above, never a raw upstream string.
        val server = servers.getValue(parts[1]).single { it == parts[2] }
        return "$provider · $server · $track"
    }
}
