package expo.modules.outalarmnative

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONObject

class OutAlarmNativeModule : Module() {
  private val context: Context get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()
  override fun definition() = ModuleDefinition {
    Name("OutAlarmNative")
    AsyncFunction("isSupported") { true }
    AsyncFunction("requestAuthorization") { if (OutAlarmScheduler.canSchedule(context)) "authorized" else "denied" }
    AsyncFunction("canScheduleExactAlarms") { OutAlarmScheduler.canSchedule(context) }
    AsyncFunction("openExactAlarmSettings") {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) context.startActivity(Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:${context.packageName}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
    AsyncFunction("consumePendingAlarm") {
      val preferences = context.getSharedPreferences("out-alarm-state", Context.MODE_PRIVATE)
      val timestamp = preferences.getLong("pendingTimestamp", 0L)
      val kind = preferences.getString("pendingKind", "wake-alarm") ?: "wake-alarm"
      val planId = preferences.getString("pendingPlanId", "") ?: ""
      preferences.edit().remove("pendingTimestamp").remove("pendingPlanId").remove("pendingKind").apply()
      if (timestamp > 0L) mapOf("timestamp" to timestamp.toDouble(), "kind" to kind, "planId" to planId) else null
    }
    AsyncFunction("schedule") { request: Map<String, Any> ->
      if (!OutAlarmScheduler.canSchedule(context)) throw IllegalStateException("exact-alarm-permission-required")
      val data = JSONObject(request); OutAlarmScheduler.schedule(context, data); mapOf("id" to data.getString("id"))
    }
    AsyncFunction("cancel") { ids: List<String> -> ids.forEach { OutAlarmScheduler.cancel(context, it) } }
    AsyncFunction("cancelAll") { OutAlarmScheduler.cancelAll(context) }
  }
}
