package com.gastos.captura

import android.content.Context

class Config(ctx: Context) {
    private val p = ctx.getSharedPreferences("cfg", Context.MODE_PRIVATE)

    var endpoint: String
        get() = p.getString("endpoint", "")!!
        set(v) = p.edit().putString("endpoint", v.trim()).apply()

    var token: String
        get() = p.getString("token", "")!!
        set(v) = p.edit().putString("token", v.trim()).apply()

    /** Apps cuyas notificaciones con montos se envían como movimientos. */
    var packages: Set<String>
        get() = p.getStringSet("packages", DEFAULT_PACKAGES)!!.toSet()
        set(v) = p.edit().putStringSet("packages", v).apply()

    /** Si está activo, también manda notificaciones con montos de apps NO listadas (van a "SinParsear"). */
    var discovery: Boolean
        get() = p.getBoolean("discovery", true)
        set(v) = p.edit().putBoolean("discovery", v).apply()

    /** Leer SMS completos con el receptor (en vez de la notificación de la app de mensajes). */
    var smsEnabled: Boolean
        get() = p.getBoolean("sms", true)
        set(v) = p.edit().putBoolean("sms", v).apply()

    val log: String get() = p.getString("log", "")!!

    @Synchronized
    fun addLog(line: String) {
        val prev = log.lines().filter { it.isNotBlank() }.take(49)
        p.edit().putString("log", (listOf(line) + prev).joinToString("\n")).apply()
    }

    companion object {
        val DEFAULT_PACKAGES = setOf(
            "com.google.android.apps.walletnfcrel", // Google Wallet
            "com.revolut.revolut",                  // Revolut
            "com.nu.production",                    // Nu
            // HSBC y Santander: usa el modo descubrimiento para ver su paquete exacto y agrégalo aquí
        )
    }
}
