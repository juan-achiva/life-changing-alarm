package expo.modules.outalarmnative

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.view.Gravity
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class OutAlarmActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) { setShowWhenLocked(true); setTurnScreenOn(true) }
    else @Suppress("DEPRECATION") window.addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON)
    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    val data = runCatching { JSONObject(intent.getStringExtra("alarm") ?: "{}") }.getOrElse { JSONObject() }
    val pad = (32 * resources.displayMetrics.density).toInt()
    val layout = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER; setPadding(pad, pad, pad, pad); setBackgroundColor(Color.rgb(17, 17, 17)) }
    layout.addView(TextView(this).apply { text = if (data.optString("kind") == "out-alarm") "OUT NOW" else "WAKE UP"; textSize = 22f; setTextColor(Color.rgb(217, 255, 67)); gravity = Gravity.CENTER })
    layout.addView(TextView(this).apply { text = SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date()); textSize = 76f; setTextColor(Color.WHITE); gravity = Gravity.CENTER; setPadding(0, pad, 0, pad) })
    layout.addView(TextView(this).apply { text = data.optString("title", "기상할 시간이에요"); textSize = 24f; setTextColor(Color.WHITE); gravity = Gravity.CENTER })
    layout.addView(Button(this).apply { text = if (data.optString("kind") == "out-alarm") "출발 알람 끄기" else "기상 완료"; textSize = 20f; setOnClickListener { stopAlarm(data) }; setPadding(pad, pad / 2, pad, pad / 2) }, LinearLayout.LayoutParams(-1, -2).apply { topMargin = pad * 2 })
    setContentView(layout)
  }

  private fun stopAlarm(data: JSONObject) {
    stopService(Intent(this, OutAlarmRingingService::class.java))
    packageManager.getLaunchIntentForPackage(packageName)?.let { launch -> launch.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP); launch.putExtra("outAlarmStopped", true); launch.putExtra("kind", data.optString("kind")); launch.putExtra("planId", data.optString("planId")); startActivity(launch) }
    finish()
  }

  @Deprecated("Deprecated in Java")
  override fun onBackPressed() { /* Alarm must be explicitly stopped. */ }
}
