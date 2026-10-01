package com.sanjay.anitrack.next.data.providers.connectors.mkissa

import org.json.JSONArray
import org.json.JSONObject

/**
 * Strictly reads build id and mask fragments from MKissa's minified bundle. It interprets only
 * string tables, integer arithmetic and decoder calls; remote JavaScript is never evaluated.
 *
 * The parser shape is informed by the Apache-2.0 Yuzono MKissa extension, then kept local so the
 * connector can reject unknown bundle layouts instead of executing provider-controlled code.
 */
internal object MkissaBundleParser {
    data class BuildInfo(
        val buildId: String,
        val seeds: List<String>,
        val cryptoScheme: MkissaCrypto.CryptoScheme? = null,
    ) {
        init {
            require(buildId.matches(Regex("\\d{2,10}"))) { "Invalid MKissa build id" }
            require(seeds.size == MkissaCrypto.SEED_COUNT && seeds.all(seedRegex::matches)) {
                "Invalid MKissa mask fragments"
            }
        }

        fun serialize(): String = JSONObject()
            .put("version", 2)
            .put("buildId", buildId)
            .put("seeds", JSONArray(seeds))
            .apply {
                cryptoScheme?.let { scheme ->
                    put(
                        "cryptoScheme",
                        JSONObject()
                            .put("saltMultiplier", scheme.saltMultiplier)
                            .put("saltOffset", scheme.saltOffset)
                            .put("fragmentMultiplier", scheme.fragmentMultiplier)
                            .put("fragmentOffset", scheme.fragmentOffset)
                            .put("bootPrefix", scheme.bootPrefix)
                            .put("separator", scheme.separator)
                            .put("fields", JSONArray(scheme.fields))
                            .put("omitEmptyLane", scheme.omitEmptyLane)
                            .put("epochWindowMs", scheme.epochWindowMs)
                            .put("epochGraceMs", scheme.epochGraceMs),
                    )
                }
            }
            .toString()

        companion object {
            fun deserialize(value: String?): BuildInfo? {
                if (value.isNullOrBlank()) return null
                if (value.trimStart().startsWith('{')) return runCatching {
                    val json = JSONObject(value)
                    val seedArray = json.getJSONArray("seeds")
                    val seeds = (0 until seedArray.length()).map(seedArray::getString)
                    val scheme = json.optJSONObject("cryptoScheme")?.let { item ->
                        val fieldArray = item.getJSONArray("fields")
                        MkissaCrypto.CryptoScheme(
                            item.getInt("saltMultiplier"),
                            item.getInt("saltOffset"),
                            item.getInt("fragmentMultiplier"),
                            item.getInt("fragmentOffset"),
                            item.getString("bootPrefix"),
                            item.getString("separator"),
                            (0 until fieldArray.length()).map(fieldArray::getString),
                            item.getBoolean("omitEmptyLane"),
                            item.getLong("epochWindowMs"),
                            item.getLong("epochGraceMs"),
                        )
                    }
                    BuildInfo(json.getString("buildId"), seeds, scheme)
                }.getOrNull()
                val buildId = value.substringBefore('|', "")
                val seeds = value.substringAfter('|', "").split(',').filter(String::isNotBlank)
                return runCatching { BuildInfo(buildId, seeds) }.getOrNull()
            }
        }
    }

    fun parse(javascript: String): BuildInfo? {
        if (javascript.length !in 1..MAX_BUNDLE_CHARS) return null

        // Useful for non-obfuscated deployments and deterministic fixtures.
        directBuildRegex.find(javascript)?.let { match ->
            val seeds = quotedStringRegex.findAll(match.groupValues[2]).map { it.groupValues[2] }.toList()
            if (seeds.size == MkissaCrypto.SEED_COUNT && seeds.all(seedRegex::matches)) {
                return runCatching { BuildInfo(match.groupValues[1], seeds) }.getOrNull()
            }
        }

        val decoders = decodersFrom(javascript)
        val seedCandidates = extractSeedCandidates(javascript, decoders)
        if (seedCandidates.isEmpty()) return null
        legacyBuildRegex.find(javascript)?.groupValues?.get(1)?.let { buildId ->
            val seed = seedCandidates.distinctBy { it.seeds }.singleOrNull()
            if (seed != null) return BuildInfo(buildId, seed.seeds, extractCryptoScheme(javascript, decoders, seed.rotation))
        }
        val decoded = extractDecodedBuild(javascript, decoders, seedCandidates) ?: return null
        return BuildInfo(
            decoded.buildId,
            decoded.seed.seeds,
            extractCryptoScheme(javascript, decoders, decoded.seed.rotation),
        )
    }

    private data class BaseDecoder(val table: String, val offset: Int)
    private data class AliasDecoder(val base: String, val argumentIndex: Int, val delta: Int)
    private data class Decoders(
        val tables: Map<String, List<String>>,
        val bases: Map<String, BaseDecoder>,
        val aliases: Map<String, AliasDecoder>,
    )
    private data class SeedCandidate(
        val seeds: List<String>,
        val rotation: Int,
        val table: String,
        val sourceIndex: Int,
    )
    private data class DecodedBuild(val buildId: String, val seed: SeedCandidate, val score: Int)

    private fun decodersFrom(js: String): Decoders {
        val tables = readTables(js)
        val bases = baseDecoderRegex.findAll(js).associate { match ->
            match.groupValues[1] to BaseDecoder(match.groupValues[4], fold(match.groupValues[3]))
        }
        val aliases = buildMap {
            bases.keys.forEach { put(it, AliasDecoder(it, 0, 0)) }
            aliasDecoderRegex.findAll(js).forEach { match ->
                val name = match.groupValues[1]
                val firstParameter = match.groupValues[2]
                val callee = match.groupValues[4]
                val forwardedArgument = match.groupValues[5]
                if (callee !in bases) return@forEach
                put(
                    name,
                    AliasDecoder(
                        base = callee,
                        argumentIndex = if (forwardedArgument == firstParameter) 0 else 1,
                        delta = match.groupValues[6].takeIf(String::isNotEmpty)?.let(::fold) ?: 0,
                    ),
                )
            }
            inlineConstantAliasRegex.findAll(js).forEach { match ->
                val firstParameter = match.groupValues[2]
                val secondParameter = match.groupValues[3]
                val callee = match.groupValues[4]
                val forwardedArgument = match.groupValues[5]
                if (callee !in bases || (forwardedArgument != firstParameter && forwardedArgument != secondParameter)) {
                    return@forEach
                }
                val constant = fold(match.groupValues[8])
                put(
                    match.groupValues[1],
                    AliasDecoder(
                        base = callee,
                        argumentIndex = if (forwardedArgument == firstParameter) 0 else 1,
                        delta = if (match.groupValues[6] == "-") -constant else constant,
                    ),
                )
            }
        }
        return Decoders(tables, bases, aliases)
    }

    private fun extractDecodedBuild(
        js: String,
        decoders: Decoders,
        seeds: List<SeedCandidate>,
    ): DecodedBuild? {
        val preferredVariables = buildDefaultRegex.findAll(js).map { it.groupValues[1] }.toSet()
        val assignments = assignmentCandidateRegex.findAll(js).take(MAX_CALL_SCAN).map { match ->
            Triple(match.groupValues[1], match.groupValues[2], match.range.first)
        }.toList()
        val matches = mutableListOf<DecodedBuild>()
        for (seed in seeds) {
            for ((variable, call, sourceIndex) in assignments) {
                val callMatch = callRegex.matchEntire(call) ?: continue
                val alias = decoders.aliases[callMatch.groupValues[1]] ?: continue
                val base = decoders.bases[alias.base] ?: continue
                if (base.table != seed.table) continue
                val buildId = resolve(call, seed.rotation, decoders)?.takeIf(buildIdRegex::matches) ?: continue
                val distanceBonus = (20 - kotlin.math.abs(seed.sourceIndex - sourceIndex) / 100).coerceAtLeast(0)
                matches += DecodedBuild(buildId, seed, (if (variable in preferredVariables) 100 else 0) + distanceBonus)
            }
        }
        val bestScore = matches.maxOfOrNull(DecodedBuild::score) ?: return null
        val tied = matches.filter { it.score == bestScore }
        return tied.distinctBy { "${it.buildId}:${it.seed.seeds.joinToString("|")}" }.singleOrNull()
    }

    private fun extractSeedCandidates(js: String, decoders: Decoders): List<SeedCandidate> {
        val candidates = mutableListOf<SeedCandidate>()
        for (match in shortArrayRegex.findAll(js)) {
            val expressions = splitTopLevel(match.groupValues[1])
            if (expressions.size != MkissaCrypto.SEED_COUNT) continue
            val calls = expressions.map { callRegex.findAll(it).toList() }
            if (calls.any { it.size !in 2..MAX_CALLS_PER_SEED }) continue
            val flatCalls = calls.flatten()
            val firstAlias = decoders.aliases[flatCalls.first().groupValues[1]] ?: continue
            val firstBase = decoders.bases[firstAlias.base] ?: continue
            val table = decoders.tables[firstBase.table] ?: continue
            val usesOneTable = flatCalls.all { call ->
                val alias = decoders.aliases[call.groupValues[1]] ?: return@all false
                decoders.bases[alias.base]?.table == firstBase.table
            }
            if (!usesOneTable) continue
            for (rotation in table.indices) {
                val decoded = expressions.map { decodeExpression(it, rotation, decoders) }
                if (decoded.all { it != null && seedRegex.matches(it) }) {
                    candidates += SeedCandidate(decoded.filterNotNull(), rotation, firstBase.table, match.range.first)
                }
            }
        }
        return candidates.distinctBy { "${it.table}:${it.rotation}:${it.seeds.joinToString("|")}" }
    }

    private fun extractCryptoScheme(
        js: String,
        decoders: Decoders,
        rotation: Int,
    ): MkissaCrypto.CryptoScheme? {
        val schemes = mutableSetOf<MkissaCrypto.CryptoScheme>()
        for (match in cryptoConfigRegex.findAll(js)) {
            val saltMultiplier = match.groupValues[1].toIntOrNull() ?: continue
            val saltOffset = match.groupValues[2].toIntOrNull() ?: continue
            val fragmentMultiplier = match.groupValues[3].toIntOrNull() ?: continue
            val fragmentOffset = match.groupValues[4].toIntOrNull() ?: continue
            if (listOf(saltMultiplier, saltOffset, fragmentMultiplier, fragmentOffset).any { it !in 0..255 }) continue
            val omitEmptyLane = when (match.groupValues[8]) {
                "true", "!0" -> true
                "false", "!1" -> false
                else -> continue
            }
            val prefix = decodeExpression(match.groupValues[5], rotation, decoders) ?: continue
            val separator = decodeExpression(match.groupValues[6], rotation, decoders) ?: continue
            val fields = mutableListOf<String>()
            var invalidField = false
            for (expression in splitTopLevel(match.groupValues[7])) {
                val field = decodeExpression(expression, rotation, decoders)
                if (field == null) {
                    invalidField = true
                    break
                }
                fields += field
            }
            if (invalidField) continue
            if (!prefix.matches(Regex("[A-Za-z0-9_-]{2,40}:")) || separator.length != 1) continue
            if (fields.size != 5 || fields.toSet() != REQUIRED_BOOT_FIELDS) continue
            schemes += MkissaCrypto.CryptoScheme(
                saltMultiplier,
                saltOffset,
                fragmentMultiplier,
                fragmentOffset,
                prefix,
                separator,
                fields,
                omitEmptyLane,
            )
        }
        return schemes.singleOrNull()
    }

    private fun decodeExpression(expression: String, rotation: Int, decoders: Decoders): String? {
        val output = StringBuilder()
        var index = 0
        var consumed = false
        while (index < expression.length) {
            while (index < expression.length && (expression[index].isWhitespace() || expression[index] == '+')) index++
            if (index >= expression.length) break
            val quote = expression[index]
            if (quote == '\'' || quote == '"') {
                index++
                while (index < expression.length && expression[index] != quote) {
                    if (expression[index] == '\\') {
                        if (++index >= expression.length) return null
                    }
                    output.append(expression[index++])
                }
                if (index >= expression.length) return null
                index++
                consumed = true
                continue
            }
            val call = callRegex.find(expression, index)?.takeIf { it.range.first == index } ?: return null
            output.append(resolve(call.value, rotation, decoders) ?: return null)
            index = call.range.last + 1
            consumed = true
        }
        return output.toString().takeIf { consumed }
    }

    private fun splitTopLevel(value: String): List<String> {
        val output = mutableListOf<String>()
        var start = 0
        var depth = 0
        var quote: Char? = null
        var escaped = false
        value.forEachIndexed { index, character ->
            if (escaped) {
                escaped = false
            } else if (character == '\\' && quote != null) {
                escaped = true
            } else if (quote != null) {
                if (character == quote) quote = null
            } else when (character) {
                '\'', '"' -> quote = character
                '(' -> depth++
                ')' -> if (depth > 0) depth--
                ',' -> if (depth == 0) {
                    output += value.substring(start, index).trim()
                    start = index + 1
                }
            }
        }
        output += value.substring(start).trim()
        return output.filter(String::isNotEmpty)
    }

    private fun resolve(call: String, rotation: Int, decoders: Decoders): String? {
        val match = callRegex.matchEntire(call) ?: return null
        val alias = decoders.aliases[match.groupValues[1]] ?: return null
        val base = decoders.bases[alias.base] ?: return null
        val table = decoders.tables[base.table]?.takeIf(List<String>::isNotEmpty) ?: return null
        val arguments = listOfNotNull(
            parseIntegerLiteral(match.groupValues[2]),
            match.groupValues[3].takeIf(String::isNotEmpty)?.let(::parseIntegerLiteral),
        )
        val argument = arguments.getOrNull(alias.argumentIndex) ?: return null
        val index = argument + alias.delta - base.offset + rotation
        return table[((index % table.size) + table.size) % table.size]
    }

    private fun readTables(js: String): Map<String, List<String>> = buildMap {
        for (match in tableHeadRegex.findAll(js)) {
            readStringArray(js, match.range.last)?.let { put(match.groupValues[1], it) }
        }
    }

    /** Whitelist parser: an unfamiliar token rejects the whole array rather than partially parsing. */
    private fun readStringArray(js: String, openingBracket: Int): List<String>? {
        val items = mutableListOf<String>()
        var index = openingBracket + 1
        while (index < js.length && items.size <= MAX_TABLE_ITEMS) {
            when (val current = js[index]) {
                ']' -> return items
                ',', ' ', '\n', '\r', '\t' -> index++
                '\'', '"' -> {
                    val value = StringBuilder()
                    index++
                    while (index < js.length && js[index] != current) {
                        if (js[index] == '\\') {
                            if (index + 1 >= js.length) return null
                            value.append(js[index + 1])
                            index += 2
                        } else {
                            value.append(js[index++])
                        }
                        if (value.length > MAX_TABLE_STRING_CHARS) return null
                    }
                    if (index >= js.length) return null
                    index++
                    items += value.toString()
                }
                else -> return null
            }
        }
        return null
    }

    private fun fold(expression: String): Int {
        var total = 0L
        for (term in termRegex.findAll(expression.replace(" ", "")).map(MatchResult::value)) {
            var sign = 1
            var body = term
            while (body.startsWith('+') || body.startsWith('-')) {
                if (body.startsWith('-')) sign = -sign
                body = body.substring(1)
            }
            val factors = body.split('*')
            var value = parseFactor(sign, factors.firstOrNull() ?: return 0) ?: return 0
            factors.drop(1).forEach { factor ->
                value *= parseFactor(1, factor) ?: return 0
                if (value !in Int.MIN_VALUE.toLong()..Int.MAX_VALUE.toLong()) return 0
            }
            total += value
            if (total !in Int.MIN_VALUE.toLong()..Int.MAX_VALUE.toLong()) return 0
        }
        return total.toInt()
    }

    private fun parseFactor(initialSign: Int, raw: String): Long? {
        var negative = initialSign < 0
        var digits = raw
        while (digits.startsWith('+') || digits.startsWith('-')) {
            if (digits.startsWith('-')) negative = !negative
            digits = digits.substring(1)
        }
        val magnitude = digits.toLongOrNull() ?: return null
        return if (negative) -magnitude else magnitude
    }

    private fun parseIntegerLiteral(raw: String): Int? {
        if (raw.length > 32) return null
        val value = raw.toDoubleOrNull() ?: return null
        if (!value.isFinite() || value < Int.MIN_VALUE || value > Int.MAX_VALUE) return null
        return value.toInt().takeIf { it.toDouble() == value }
    }

    private const val MAX_BUNDLE_CHARS = 4 * 1024 * 1024
    private const val MAX_TABLE_ITEMS = 8_192
    private const val MAX_TABLE_STRING_CHARS = 8_192
    private const val MAX_CALL_SCAN = 50_000
    private const val MAX_CALLS_PER_SEED = 8
    private const val identifier = "[${'$'}A-Za-z0-9_]+"
    private const val integerLiteral = "-?\\d+(?:[eE][+-]?\\d+)?"
    private const val callPattern = "($identifier)\\(\\s*($integerLiteral)\\s*(?:,\\s*($integerLiteral)\\s*)?\\)"

    private val seedRegex = Regex("[A-Za-z0-9+/]{11}=")
    private val buildIdRegex = Regex("\\d{2,10}")
    private val directBuildRegex = Regex(
        """buildId\s*:\s*["'](\d{2,10})["'][\s\S]{0,500}?maskParts\s*:\s*\[([^]]+)]""",
    )
    private val quotedStringRegex = Regex("([\"'])([^\"']+)\\1")
    private val legacyBuildRegex = Regex(
        """!==\s*["']string["']\s*\?\s*["'](\d+)["']\s*:\s*["']["']""",
    )
    private val tableHeadRegex = Regex(
        """function ($identifier)\(\)\s*\{\s*(?:const|let|var)\s+$identifier\s*=\s*\[""",
    )
    private val baseDecoderRegex = Regex(
        """function ($identifier)\(($identifier)(?:,$identifier)*\)\{return \2=\2-\(?([-\d+*\s]+?)\)?,($identifier)\(\)\[\2]\}""",
    )
    private val aliasDecoderRegex = Regex(
        """function ($identifier)\(($identifier),($identifier)\)\{return ($identifier)\(($identifier)((?:[-+][\d+*\s-]+)?)\)\}""",
    )
    private val inlineConstantAliasRegex = Regex(
        """function\s+($identifier)\s*\(\s*($identifier)\s*,\s*($identifier)\s*\)\s*\{\s*return\s+($identifier)\s*\(\s*($identifier)\s*([+-])\s*\{\s*($identifier)\s*:\s*([\d+*()\s-]{1,200})\s*\}\s*\.\s*\7\s*\)\s*\}""",
    )
    private val callRegex = Regex(callPattern)
    private val shortArrayRegex = Regex("""=\[([^]]{1,1200})]""")
    private val buildDefaultRegex = Regex("""\bbuildId\s*:\s*$identifier\s*=\s*($identifier)""")
    private val assignmentCandidateRegex = Regex(
        """\b($identifier)\s*=\s*($callPattern)\s*(?:,|;|\n)""",
    )
    private val termRegex = Regex("""[-+]*\d+(?:\*[-+]*\d+)*""")
    private val cryptoConfigRegex = Regex(
        """saltMul:(\d{1,3}),saltAdd:(\d{1,3}),fragMul:(\d{1,3}),fragAdd:(\d{1,3}),bootPrefix:([\s\S]{1,300}?),join:([\s\S]{1,100}?),parts:\[([^]]{1,1200})],omitEmptyLane:(true|false|!0|!1)""",
    )
    private val REQUIRED_BOOT_FIELDS = setOf("buildId", "group", "host", "epoch", "lane")
}
