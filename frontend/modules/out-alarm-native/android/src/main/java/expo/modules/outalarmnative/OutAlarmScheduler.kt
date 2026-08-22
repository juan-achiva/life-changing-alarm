package expo.modules.outalarmnative

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import org.json.JSONObject

internal object OutAlarmScheduler {
  private const val PREFS = "out-native-alarms"

  fun canSchedule(context: Context): Boolean {
    val manager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    return Build.VERSION.SDK_INT < Build.VERSION_CODES.S || manager.canScheduleExactAlarms()
  }

  fun schedule(context: Context, data: JSONObject, persist: Boolean = true) {
    val id = data.getString("id")
    val operation = PendingIntent.getBroadcast(context, id.hashCode(), Intent(context, OutAlarmReceiver::class.java).putExtra("alarm", data.toString()), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    val showIntent = PendingIntent.getActivity(context, id.hashCode(), Intent(context, OutAlarmActivity::class.java).putExtra("alarm", data.toString()), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    val manager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    manager.setAlarmClock(AlarmManager.AlarmClockInfo(data.getLong("timestamp"), showIntent), operation)
    if (persist) context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(id, data.toString()).apply()
  }

  fun cancelAll(context: Context) {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    prefs.all.keys.forEach { id ->
      val operation = PendingIntent.getBroadcast(context, id.hashCode(), Intent(context, OutAlarmReceiver::class.java), PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE)
      if (operation != null) (context.getSystemService(Context.ALARM_SERVICE) as AlarmManager).cancel(operation)
    }
    prefs.edit().clear().apply()
    context.stopService(Intent(context, OutAlarmRingingService::class.java))
  }

  fun remove(context: Context, id: String) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(id).apply()

  fun restore(context: Context) {
    val now = System.currentTimeMillis()
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).all.values.forEach { raw ->
      runCatching { JSONObject(raw as String) }.getOrNull()?.let { if (it.getLong("timestamp") > now) schedule(context, it, false) }
    }
  }
}
