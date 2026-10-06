package com.gastos.captura

import android.content.Context
import androidx.work.Worker
import androidx.work.WorkerParameters
import org.json.JSONObject

class SendWorker(ctx: Context, params: WorkerParameters) : Worker(ctx, params) {
    override fun doWork(): Result {
        val cfg = Config(applicationContext)
        if (cfg.endpoint.isBlank()) return Result.retry()
        val obj = JSONObject(inputData.getString("json") ?: return Result.failure())
        obj.put("token", cfg.token)
        return try {
            val res = Sender.post(cfg.endpoint, obj.toString())
            when {
                res.optBoolean("ok") -> Result.success()
                runAttemptCount < 5 -> Result.retry()
                else -> Result.failure()
            }
        } catch (e: Exception) {
            if (runAttemptCount < 20) Result.retry() else Result.failure()
        }
    }
}
