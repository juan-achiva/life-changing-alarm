import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import { formatClock, getLastCallAt } from "./planning";
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

function lastCallContent(plan: MorningPlan, options: AlarmOptions) {
  return {
    title: "LAST CALL",
    body: `OUT ${formatClock(plan.targetOutAt)} · 10분 안에 집을 나가세요.`,
    sound: options.soundEnabled ? ALARM_SOUND : undefined,
    vibrate: options.vibrationEnabled ? [0, 800, 250, 800, 250, 800] : undefined,
    priority: Notifications.AndroidNotificationPriority.MAX,
    interruptionLevel: "timeSensitive" as const,
    sticky: true,
    autoDismiss: false,
    data: { kind: "last-call", planId: plan.id },
  };
}

const DEPARTURE_NUDGES = [
  { offsetMinutes: -15, title: "15분 전", body: "이제 출발 준비를 마무리할 시간입니다." },
  { offsetMinutes: -7, title: "7분 남음", body: "옷, 휴대폰, 열쇠, 가방을 확인하세요." },
  { offsetMinutes: -5, title: "5분 남음", body: "준비를 끝내고 현관으로 이동하세요." },
  { offsetMinutes: -3, title: "3분 남음", body: "지금 신발을 신어야 합니다." },
  { offsetMinutes: -2, title: "2분 남음", body: "필수품만 챙기고 바로 나가세요." },
  { offsetMinutes: -1, title: "1분 남음", body: "현관으로 이동하세요. OUT 직전입니다." },
  { offsetMinutes: 0, title: "OUT NOW", body: "목표 출발 시간입니다. 지금 나가세요." },
  { offsetMinutes: 1, title: "1분 초과", body: "이미 출발 시간이 지났습니다." },
  { offsetMinutes: 3, title: "3분 초과", body: "지금 바로 나가세요." },
  { offsetMinutes: 5, title: "LATE · 5분 초과", body: "인증하고 바로 출발하세요." },
] as const;

async function scheduleDepartureNudges(plan: MorningPlan, occurrences: ReturnType<typeof notificationOccurrences>, options: AlarmOptions, channelId: string) {
  for (const occurrence of occurrences.slice(0, 5)) {
    for (const nudge of DEPARTURE_NUDGES) {
      const timestamp = occurrence.outAt + nudge.offsetMinutes * 60_000;
      if (timestamp <= Date.now() || timestamp <= occurrence.wakeAt || timestamp === occurrence.lastCallAt) continue;
      await Notifications.scheduleNotificationAsync({
        content: {
          title: nudge.title,
          body: nudge.body,
          sound: options.soundEnabled ? ALARM_SOUND : undefined,
          vibrate: options.vibrationEnabled ? [0, 500, 180, 500] : undefined,
          priority: Notifications.AndroidNotificationPriority.HIGH,
          interruptionLevel: "timeSensitive",
          data: { kind: "departure-nudge", planId: plan.id },
        },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(timestamp), channelId },
      });
    }
  }
}

export async function scheduleWakeNotification(plan: MorningPlan, options: AlarmOptions) {
  try {
    const occurrences = notificationOccurrences(plan);
    const nativeResult = await scheduleNativeAlarmSet(plan, occurrences, options);
    const permission = await Notifications.requestPermissionsAsync();
    if (nativeResult.handled && !permission.granted) return nativeResult;
    if (!permission.granted) return { ok: false, error: "알림 권한이 꺼져 있습니다. iPhone 설정 → 알림 → Expo Go에서 알림과 사운드를 허용해 주세요." };
    const channelId = await configureAlarmChannel(options);
    await Notifications.cancelAllScheduledNotificationsAsync();
    const ids: string[] = [];
    const localOccurrences = occurrences.slice(0, 5);
    if (!nativeResult.handled) {
      for (const occurrence of localOccurrences) {
        ids.push(await Notifications.scheduleNotificationAsync({ content: alarmContent(plan, options), trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(occurrence.wakeAt), channelId } }));
        ids.push(await Notifications.scheduleNotificationAsync({ content: lastCallContent(plan, options), trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(occurrence.lastCallAt), channelId } }));
      }
    }
    await scheduleDepartureNudges(plan, localOccurrences, options, channelId);
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    if (!ids.every((id) => scheduled.some((item) => item.identifier === id))) return { ok: false, error: "기상/출발 알람이 기기 예약 목록에 모두 등록되지 않았습니다." };
    return nativeResult.handled ? nativeResult : { ok: true, mode: "notification" as const };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "기기 알림 예약 중 오류가 발생했습니다." };
  }
}

function notificationOccurrences(plan: MorningPlan) {
  const repeatDays = plan.repeatDays ?? [];
  if (!repeatDays.length) return [{ wakeAt: plan.wakeAt, lastCallAt: getLastCallAt(plan), outAt: plan.targetOutAt }];
  const duration = plan.targetOutAt - plan.wakeAt;
  const lastCallOffset = getLastCallAt(plan) - plan.wakeAt;
  const results: { wakeAt: number; lastCallAt: number; outAt: number }[] = [];
  const cursor = new Date(plan.wakeAt);
  for (let offset = 0; offset < 21 && results.length < 14; offset += 1) {
    const date = new Date(cursor); date.setDate(cursor.getDate() + offset);
    if (repeatDays.includes(date.getDay()) && date.getTime() > Date.now()) results.push({ wakeAt: date.getTime(), lastCallAt: date.getTime() + lastCallOffset, outAt: date.getTime() + duration });
  }
  return results.length ? results : [{ wakeAt: plan.wakeAt, lastCallAt: getLastCallAt(plan), outAt: plan.targetOutAt }];
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
