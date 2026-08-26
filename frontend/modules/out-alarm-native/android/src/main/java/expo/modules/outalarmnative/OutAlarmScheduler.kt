package expo.modules.outalarmnative

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import org.json.JSONObject
import java.util.Calendar

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

  fun cancel(context: Context, id: String) {
    val operation = PendingIntent.getBroadcast(context, id.hashCode(), Intent(context, OutAlarmReceiver::class.java), PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE)
    if (operation != null) (context.getSystemService(Context.ALARM_SERVICE) as AlarmManager).cancel(operation)
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(id).apply()
  }

  fun remove(context: Context, id: String) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(id).apply()

  fun rescheduleRepeating(context: Context, data: JSONObject): Boolean {
    val days = data.optJSONArray("repeatDays") ?: return false
    if (days.length() == 0) return false
    val enabled = (0 until days.length()).map { days.optInt(it) }.toSet()
    val original = Calendar.getInstance().apply { timeInMillis = data.getLong("timestamp") }
    val localHour = data.optInt("localHour", original.get(Calendar.HOUR_OF_DAY))
    val localMinute = data.optInt("localMinute", original.get(Calendar.MINUTE))
    val next = Calendar.getInstance().apply {
      add(Calendar.MINUTE, 1)
      set(Calendar.SECOND, 0)
      set(Calendar.MILLISECOND, 0)
    }
    for (offset in 0..7) {
      val candidate = next.clone() as Calendar
      candidate.add(Calendar.DAY_OF_YEAR, offset)
      candidate.set(Calendar.HOUR_OF_DAY, localHour)
      candidate.set(Calendar.MINUTE, localMinute)
      val jsWeekday = candidate.get(Calendar.DAY_OF_WEEK) - 1
      if (jsWeekday in enabled && candidate.timeInMillis > System.currentTimeMillis()) {
        data.put("timestamp", candidate.timeInMillis)
        schedule(context, data)
        return true
      }
    }
    return false
  }

  fun restore(context: Context) {
    val now = System.currentTimeMillis()
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).all.values.forEach { raw ->
      runCatching { JSONObject(raw as String) }.getOrNull()?.let {
        val repeating = (it.optJSONArray("repeatDays")?.length() ?: 0) > 0
        if (repeating) rescheduleRepeating(context, it)
        else if (it.getLong("timestamp") > now) schedule(context, it, false)
      }
    }
  }
}
