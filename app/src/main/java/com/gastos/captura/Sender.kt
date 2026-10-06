package com.gastos.captura

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

object Sender {
    /**
     * POST al web app de Apps Script. Apps Script responde 302 hacia googleusercontent.com;
     * el doPost ya se ejecutó, y se sigue la redirección con GET solo para leer la respuesta.
     */
    fun post(endpoint: String, body: String): JSONObject {
        val c = (URL(endpoint).openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            doOutput = true
            instanceFollowRedirects = false
            connectTimeout = 15_000
            readTimeout = 30_000
            setRequestProperty("Content-Type", "application/json; charset=utf-8")
        }
        c.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
        val code = c.responseCode

        val text = if (code in 300..399) {
            val loc = c.getHeaderField("Location")
            c.disconnect()
            val g = URL(loc).openConnection() as HttpURLConnection
            try { g.inputStream.bufferedReader().use { it.readText() } } finally { g.disconnect() }
        } else {
            val s = if (code < 400) c.inputStream else c.errorStream
            try { s?.bufferedReader()?.use { it.readText() } ?: "" } finally { c.disconnect() }
        }

        return try {
            JSONObject(text)
        } catch (e: Exception) {
            JSONObject().put("ok", false).put("error", "HTTP $code: ${text.take(200)}")
        }
    }
}
