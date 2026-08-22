import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import { formatClock } from "./planning";
import { scheduleNativeAlarmSet } from "./nativeAlarm";
import type { MorningPlan } from "./types";

export type AlarmOptions = { soundEnabled: boolean; vibrationEnabled: boolean };

const ALARM_SOUND = "alarm-tone.wav";
const ALARM_CHANNEL_VERSION = "v3";

async function configureAlarmChannel(options: AlarmOptions) {
  const channelId = `wake-alarm-${ALARM_CHANNEL_VERSION}-${options.soundEnabled ? "sound" : "silent"}-${options.vibrationEnabled ? "vibrate" : "still"}`;
  if (Platform.OS === "android") await Notifications.setNotificationChannelAsync(channelId, {
    name: "OUT 기상 알람",
    description: "앱이 닫혀 있어도 예약 시각에 울리는 기상 알람",
    importance: Notifications.AndroidImportance.MAX,
    sound: options.soundEnabled ? ALARM_SOUND : null,
    enableVibrate: options.vibrationEnabled,
    vibrationPattern: options.vibrationEnabled ? [0, 800, 250, 800, 250, 800] : [0],
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    bypassDnd: false,
  });
  return channelId;
}

function alarmContent(plan: MorningPlan, options: AlarmOptions) {
  return {
    title: "기상할 시간이에요",
    body: `${plan.eventTitle} · OUT ${formatClock(plan.targetOutAt)}`,
    sound: options.soundEnabled ? ALARM_SOUND : undefined,
    vibrate: options.vibrationEnabled ? [0, 800, 250, 800, 250, 800] : undefined,
    priority: Notifications.AndroidNotificationPriority.MAX,
    interruptionLevel: "timeSensitive" as const,
    sticky: true,
    autoDismiss: false,
    data: { kind: "wake-alarm", planId: plan.id },
  };
}

function outAlarmContent(plan: MorningPlan, options: AlarmOptions) {
  return {
    title: "OUT NOW — 출발할 시간이에요",
    body: "Wake-to-Out 목표 시간이 됐습니다. 지금 나가세요.",
    sound: options.soundEnabled ? ALARM_SOUND : undefined,
    vibrate: options.vibrationEnabled ? [0, 800, 250, 800, 250, 800] : undefined,
    priority: Notifications.AndroidNotificationPriority.MAX,
    interruptionLevel: "timeSensitive" as const,
    sticky: true,
    autoDismiss: false,
    data: { kind: "out-alarm", planId: plan.id },
  };
}

export async function scheduleWakeNotification(plan: MorningPlan, options: AlarmOptions) {
  try {
    const occurrences = notificationOccurrences(plan);
    const nativeResult = await scheduleNativeAlarmSet(plan, occurrences, options);
    if (nativeResult.handled) return nativeResult;
    const permission = await Notifications.requestPermissionsAsync();
    if (!permission.granted) return { ok: false, error: "알림 권한이 꺼져 있습니다. iPhone 설정 → 알림 → Expo Go에서 알림과 사운드를 허용해 주세요." };
    const channelId = await configureAlarmChannel(options);
    await Notifications.cancelAllScheduledNotificationsAsync();
    const ids: string[] = [];
    for (const occurrence of occurrences) {
      ids.push(await Notifications.scheduleNotificationAsync({ content: alarmContent(plan, options), trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(occurrence.wakeAt), channelId } }));
      ids.push(await Notifications.scheduleNotificationAsync({ content: outAlarmContent(plan, options), trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(occurrence.outAt), channelId } }));
    }
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    if (!ids.every((id) => scheduled.some((item) => item.identifier === id))) return { ok: false, error: "기상/출발 알람이 기기 예약 목록에 모두 등록되지 않았습니다." };
    return { ok: true, mode: "notification" as const };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "기기 알림 예약 중 오류가 발생했습니다." };
  }
}

function notificationOccurrences(plan: MorningPlan) {
  const repeatDays = plan.repeatDays ?? [];
  if (!repeatDays.length) return [{ wakeAt: plan.wakeAt, outAt: plan.targetOutAt }];
  const duration = plan.targetOutAt - plan.wakeAt;
  const results: { wakeAt: number; outAt: number }[] = [];
  const cursor = new Date(plan.wakeAt);
  for (let offset = 0; offset < 21 && results.length < 14; offset += 1) {
    const date = new Date(cursor); date.setDate(cursor.getDate() + offset);
    if (repeatDays.includes(date.getDay()) && date.getTime() > Date.now()) results.push({ wakeAt: date.getTime(), outAt: date.getTime() + duration });
  }
  return results.length ? results : [{ wakeAt: plan.wakeAt, outAt: plan.targetOutAt }];
}

export async function scheduleSnoozeNotification(plan: MorningPlan, options: AlarmOptions) {
  try {
    const channelId = await configureAlarmChannel(options);
    await Notifications.scheduleNotificationAsync({ content: { title: "기상할 시간이에요", body: "알람으로 인생바꾸기 · 5분 다시 알림", sound: options.soundEnabled ? ALARM_SOUND : undefined, vibrate: options.vibrationEnabled ? [0, 800, 250, 800, 250, 800] : undefined, priority: Notifications.AndroidNotificationPriority.MAX, interruptionLevel: "timeSensitive", sticky: true, autoDismiss: false, data: { kind: "wake-alarm", planId: plan.id } }, trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(Date.now() + 5 * 60_000), channelId } });
  } catch { /* Expo Go notification limitations are handled by the in-app preview. */ }
}

export function isValidTime(value: string) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}
