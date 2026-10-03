package com.sanjay.anitrack.next.data

/** Minimal HTML entity decoding for text taken from bounded markup. */
internal object Html {
    private val ENTITY = Regex("&(#\\d{1,7}|#[xX][0-9a-fA-F]{1,6}|amp|lt|gt|quot|apos|nbsp);")

    fun decode(value: String): String = ENTITY.replace(value) { match ->
        when (val name = match.groupValues[1]) {
            "amp" -> "&"
            "lt" -> "<"
            "gt" -> ">"
            "quot" -> "\""
            "apos" -> "'"
            "nbsp" -> " "
            else -> {
                val code = if (name[1] == 'x' || name[1] == 'X') name.drop(2).toIntOrNull(16) else name.drop(1).toIntOrNull()
                if (code != null && code in 1..0x10FFFF && code !in 0xD800..0xDFFF) String(Character.toChars(code)) else match.value
            }
        }
    }
}

/** AniList descriptions (asHtml: false) still carry <br> tags and entities. */
internal fun cleanDescription(raw: String?): String? =
    raw?.replace(Regex("<[^>]+>"), "")?.let(Html::decode)?.trim()?.ifEmpty { null }
