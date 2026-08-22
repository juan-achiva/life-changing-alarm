package expo.modules.outalarmnative

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.content.ContextCompat
import org.json.JSONObject

class OutAlarmReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val raw = intent.getStringExtra("alarm") ?: return
    runCatching { OutAlarmScheduler.remove(context, JSONObject(raw).getString("id")) }
    ContextCompat.startForegroundService(context, Intent(context, OutAlarmRingingService::class.java).putExtra("alarm", raw))
  }
}

class OutAlarmStopReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    context.stopService(Intent(context, OutAlarmRingingService::class.java))
    context.packageManager.getLaunchIntentForPackage(context.packageName)?.apply {
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
      putExtra("outAlarmStopped", true); putExtra("kind", intent.getStringExtra("kind")); putExtra("planId", intent.getStringExtra("planId"))
    }?.let(context::startActivity)
  }
}

class OutAlarmBootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) { if (intent.action == Intent.ACTION_BOOT_COMPLETED) OutAlarmScheduler.restore(context) }
}
