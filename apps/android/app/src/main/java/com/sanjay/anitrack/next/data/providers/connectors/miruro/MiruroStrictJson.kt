package com.sanjay.anitrack.next.data.providers.connectors.miruro

/** Android's JSONObject accepts JavaScript-like syntax. Validate JSON grammar before using it. */
internal class MiruroStrictJson(private val text: String) {
    private var position = 0

    fun validate() {
        value(0)
        whitespace()
        if (position != text.length) invalid()
    }

    private fun value(depth: Int) {
        if (depth > 64) invalid()
        whitespace()
        when (peek()) {
            '{' -> {
                position++; whitespace()
                if (consume('}')) return
                do {
                    whitespace(); string(); whitespace()
                    if (!consume(':')) invalid()
                    value(depth + 1); whitespace()
                } while (consume(','))
                if (!consume('}')) invalid()
            }
            '[' -> {
                position++; whitespace()
                if (consume(']')) return
                do { value(depth + 1); whitespace() } while (consume(','))
                if (!consume(']')) invalid()
            }
            '"' -> string()
            't' -> literal("true")
            'f' -> literal("false")
            'n' -> literal("null")
            '-', in '0'..'9' -> number()
            else -> invalid()
        }
    }

    private fun string() {
        if (!consume('"')) invalid()
        while (position < text.length) {
            val char = text[position++]
            when {
                char == '"' -> return
                char.code < 32 -> invalid()
                char == '\\' -> {
                    val escaped = peek(); position++
                    if (escaped == 'u') repeat(4) {
                        if (peek() !in '0'..'9' && peek() !in 'a'..'f' && peek() !in 'A'..'F') invalid()
                        position++
                    } else when (escaped) {
                        '"', '\\', '/', 'b', 'f', 'n', 'r', 't' -> Unit
                        else -> invalid()
                    }
                }
            }
        }
        invalid()
    }

    private fun number() {
        consume('-')
        if (consume('0')) {
            if (peek() in '0'..'9') invalid()
        } else {
            if (peek() !in '1'..'9') invalid()
            while (peek() in '0'..'9') position++
        }
        if (consume('.')) digits()
        if (consume('e') || consume('E')) {
            if (!consume('+')) consume('-')
            digits()
        }
    }

    private fun digits() {
        if (peek() !in '0'..'9') invalid()
        while (peek() in '0'..'9') position++
    }
    private fun literal(value: String) {
        if (!text.startsWith(value, position)) invalid()
        position += value.length
    }
    private fun whitespace() {
        while (true) when (peek()) {
            ' ', '\t', '\r', '\n' -> position++
            else -> return
        }
    }
    private fun peek() = text.getOrNull(position) ?: '\u0000'
    private fun consume(char: Char): Boolean {
        if (peek() != char) return false
        position++
        return true
    }
    private fun invalid(): Nothing = throw MiruroProtocolException("Miruro returned malformed JSON")
}
