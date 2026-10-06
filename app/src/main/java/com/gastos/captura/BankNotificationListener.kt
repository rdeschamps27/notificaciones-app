package com.gastos.captura

import android.app.Notification
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification

class BankNotificationListener : NotificationListenerService() {

    override fun onNotificationPosted(sbn: StatusBarNotification) {
        val pkg = sbn.packageName
        if (pkg == packageName || pkg in IGNORED) return

        val cfg = Config(this)
        // Si el receptor de SMS está activo, los SMS se leen completos por ahí; ignora la notificación duplicada.
        if (pkg in MESSAGING && cfg.smsEnabled) return

        val n = sbn.notification
        if ((n.flags and Notification.FLAG_GROUP_SUMMARY) != 0) return

        val ex = n.extras
        val title = ex.getCharSequence(Notification.EXTRA_TITLE)?.toString().orEmpty()
        val text = (ex.getCharSequence(Notification.EXTRA_BIG_TEXT)
            ?: ex.getCharSequence(Notification.EXTRA_TEXT))?.toString().orEmpty()

        if (!Capture.MONEY.containsMatchIn("$title $text")) return

        val allowed = pkg in cfg.packages || pkg in MESSAGING
        if (!allowed && !cfg.discovery) return

        val source = if (pkg in MESSAGING) "sms" else "push"
        Capture.submit(this, source, pkg, title, text, sbn.postTime, discovery = !allowed)
    }

    companion object {
        val MESSAGING = setOf(
            "com.samsung.android.messaging",
            "com.google.android.apps.messaging",
        )
        /** Correo se procesa del lado de Gmail; chats se excluyen por privacidad. */
        val IGNORED = setOf(
            "com.google.android.gm",
            "com.samsung.android.email.provider",
            "com.microsoft.office.outlook",
            "com.whatsapp", "com.whatsapp.w4b",
            "org.telegram.messenger",
            "com.facebook.orca",
            "com.instagram.android",
        )
    }
}
