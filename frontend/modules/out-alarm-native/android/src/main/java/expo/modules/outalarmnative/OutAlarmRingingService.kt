package expo.modules.outalarmnative

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.os.Build
import android.os.IBinder
import android.os.VibrationEffect
import android.os.Vibrator
import androidx.core.app.NotificationCompat
import org.json.JSONObject

class OutAlarmRingingService : Service() {
  private var player: MediaPlayer? = null
  private var vibrator: Vibrator? = null
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val data = runCatching { JSONObject(intent?.getStringExtra("alarm") ?: "{}") }.getOrElse { JSONObject() }
    val id = data.optString("id", "out-alarm")
    val fullScreen = PendingIntent.getActivity(this, id.hashCode(), Intent(this, OutAlarmActivity::class.java).putExtra("alarm", data.toString()).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    val stop = PendingIntent.getBroadcast(this, id.hashCode(), Intent(this, OutAlarmStopReceiver::class.java).putExtra("kind", data.optString("kind")).putExtra("planId", data.optString("planId")), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    val channelId = "out-native-alarm-v1"
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val channel = NotificationChannel(channelId, "OUT 알람", NotificationManager.IMPORTANCE_HIGH).apply { description = "기상 및 목표 출발 알람"; enableVibration(false); setSound(null, null); lockscreenVisibility = NotificationCompat.VISIBILITY_PUBLIC }
      getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }
    val notification = NotificationCompat.Builder(this, channelId)
      .setSmallIcon(applicationInfo.icon).setContentTitle(data.optString("title", "기상할 시간이에요")).setContentText(data.optString("body", "OUT"))
      .setColor(Color.rgb(217, 255, 67)).setPriority(NotificationCompat.PRIORITY_MAX).setCategory(NotificationCompat.CATEGORY_ALARM)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC).setOngoing(true).setFullScreenIntent(fullScreen, true).addAction(0, "알람 끄기", stop).build()
    startForeground(id.hashCode(), notification)
    if (data.optBoolean("soundEnabled", true)) {
      player?.release()
      player = MediaPlayer().apply {
        setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build())
        setDataSource(this@OutAlarmRingingService, RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)); isLooping = true; prepare(); start()
      }
    }
    if (data.optBoolean("vibrationEnabled", true)) {
      vibrator = getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
      val pattern = longArrayOf(0, 900, 300, 900, 300)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) vibrator?.vibrate(VibrationEffect.createWaveform(pattern, 0)) else @Suppress("DEPRECATION") vibrator?.vibrate(pattern, 0)
    }
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    player?.let { if (it.isPlaying) it.stop(); it.release() }; player = null
    vibrator?.cancel(); vibrator = null; super.onDestroy()
  }
}
