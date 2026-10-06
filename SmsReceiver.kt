package com.gastos.captura

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony

class SmsReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return
        if (!Config(ctx).smsEnabled) return
        val msgs = Telephony.Sms.Intents.getMessagesFromIntent(intent) ?: return

        // Un SMS largo llega en varias partes: se unen por remitente.
        msgs.groupBy { it.originatingAddress.orEmpty() }.forEach { (from, parts) ->
            val body = parts.joinToString("") { it.messageBody.orEmpty() }
            if (Capture.MONEY.containsMatchIn(body)) {
                Capture.submit(ctx, "sms", from, "", body, parts.first().timestampMillis, discovery = false)
            }
        }
    }
}
