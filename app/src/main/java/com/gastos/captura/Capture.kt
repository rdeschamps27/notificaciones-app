package com.gastos.captura

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.workDataOf
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.TimeUnit

object Capture {
    /** Detecta que el texto trae un monto: "$1,800", "€12.50", "350.00 MXN"... */
    val MONEY = Regex("""[${'$'}€£]\s?\d|\d[\d.,]*\s?(MXN|MN|USD|EUR)\b""", RegexOption.IGNORE_CASE)

    private val recent = ArrayDeque<String>()

    /** Evita reenviar la misma notificación cuando la app la actualiza o la repinta. */
    @Synchronized
    private fun seen(key: String): Boolean {
        if (key in recent) return true
        recent.addLast(key)
        if (recent.size > 200) recent.removeFirst()
        return false
    }

    fun submit(
        ctx: Context, source: String, app: String, title: String, text: String,
        ts: Long, discovery: Boolean
    ) {
        if (seen("$source|$app|$title|$text")) return

        val json = JSONObject()
            .put("source", source)
            .put("app", app)
            .put("title", title)
            .put("text", text)
            .put("ts", ts)
            .put("discovery", discovery)
            .put("profile", android.os.Process.myUserHandle().toString())
            .toString()

        val hora = SimpleDateFormat("dd/MM HH:mm", Locale.getDefault()).format(Date(ts))
        val marca = if (discovery) " (desc.)" else ""
        Config(ctx).addLog("$hora [$source$marca] $app: ${"$title $text".trim().take(90)}")

        val req = OneTimeWorkRequestBuilder<SendWorker>()
            .setInputData(workDataOf("json" to json))
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .build()
        WorkManager.getInstance(ctx).enqueue(req)
    }
}
