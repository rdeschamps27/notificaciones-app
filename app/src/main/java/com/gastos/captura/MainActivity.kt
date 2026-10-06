package com.gastos.captura

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.os.PowerManager
import android.os.Process
import android.provider.Settings
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.Switch
import android.widget.TextView
import android.widget.Toast
import androidx.core.app.NotificationManagerCompat
import org.json.JSONObject

class MainActivity : Activity() {
    private lateinit var cfg: Config
    private lateinit var status: TextView
    private lateinit var log: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        cfg = Config(this)
        val pad = (16 * resources.displayMetrics.density).toInt()
        val col = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(pad, pad * 2, pad, pad)
        }
        fun label(t: String) = TextView(this).apply { text = t; setPadding(0, pad / 2, 0, 0) }.also { col.addView(it) }
        fun button(t: String, f: () -> Unit) = Button(this).apply { text = t; setOnClickListener { f() } }.also { col.addView(it) }

        status = TextView(this).also { col.addView(it) }

        label("URL del web app de Apps Script (termina en /exec)")
        val url = EditText(this).apply { setText(cfg.endpoint); setSingleLine() }.also { col.addView(it) }
        label("Token (el mismo que en Code.gs)")
        val tok = EditText(this).apply { setText(cfg.token); setSingleLine() }.also { col.addView(it) }
        label("Apps a escuchar (un paquete por línea)")
        val pk = EditText(this).apply { setText(cfg.packages.sorted().joinToString("\n")); minLines = 3 }.also { col.addView(it) }
        val disc = Switch(this).apply { text = "Modo descubrimiento (otras apps con montos → SinParsear)"; isChecked = cfg.discovery }.also { col.addView(it) }
        val sms = Switch(this).apply { text = "Leer SMS completos"; isChecked = cfg.smsEnabled }.also { col.addView(it) }

        button("Guardar") {
            cfg.endpoint = url.text.toString()
            cfg.token = tok.text.toString()
            cfg.packages = pk.text.lines().map { it.trim() }.filter { it.isNotEmpty() }.toSet()
            cfg.discovery = disc.isChecked
            cfg.smsEnabled = sms.isChecked
            toast("Guardado"); refresh()
        }
        button("1. Acceso a notificaciones") { startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)) }
        button("2. Permiso de SMS") { requestPermissions(arrayOf(Manifest.permission.RECEIVE_SMS), 1) }
        button("3. Optimización de batería") { startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)) }
        button("Probar conexión") { testConn() }

        label("Últimas capturas")
        log = TextView(this).apply { setTextIsSelectable(true); textSize = 12f }.also { col.addView(it) }

        setContentView(ScrollView(this).apply { addView(col) })
    }

    override fun onResume() { super.onResume(); refresh() }

    override fun onRequestPermissionsResult(rc: Int, perms: Array<out String>, res: IntArray) {
        super.onRequestPermissionsResult(rc, perms, res); refresh()
    }

    private fun refresh() {
        val notif = NotificationManagerCompat.getEnabledListenerPackages(this).contains(packageName)
        val smsOk = checkSelfPermission(Manifest.permission.RECEIVE_SMS) == PackageManager.PERMISSION_GRANTED
        val bat = getSystemService(PowerManager::class.java).isIgnoringBatteryOptimizations(packageName)
        status.text = "Notificaciones ${ok(notif)}   SMS ${ok(smsOk)}   Batería ${ok(bat)}\nPerfil: ${Process.myUserHandle()}"
        log.text = cfg.log.ifBlank { "(nada aún)" }
    }

    private fun ok(b: Boolean) = if (b) "✅" else "❌"

    private fun testConn() {
        val ep = cfg.endpoint
        if (ep.isBlank()) { toast("Primero guarda la URL"); return }
        val body = JSONObject().put("token", cfg.token).put("source", "test").put("app", "test")
            .put("text", "ping").put("ts", System.currentTimeMillis()).toString()
        Thread {
            val r = try { Sender.post(ep, body).toString() } catch (e: Exception) { "Error: ${e.message}" }
            runOnUiThread { toast(r) }
        }.start()
    }

    private fun toast(s: String) = Toast.makeText(this, s, Toast.LENGTH_LONG).show()
}
