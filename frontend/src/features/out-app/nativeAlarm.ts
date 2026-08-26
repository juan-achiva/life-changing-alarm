import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

import OutAlarmNative, { type NativeAlarmRequest } from "../../../modules/out-alarm-native";
import type { MorningPlan } from "./types";

export type AlarmOccurrence = { wakeAt: number; lastCallAt: number; outAt: number };
const NATIVE_ALARM_IDS_KEY = "out.native-alarm-ids.v1";

function shiftedRepeatDays(days: number[], wakeAt: number, eventAt: number) {
  if (!days.length) return [];
  const wake = new Date(wakeAt); wake.setHours(0, 0, 0, 0);
  const event = new Date(eventAt); event.setHours(0, 0, 0, 0);
  const offset = Math.round((event.getTime() - wake.getTime()) / 86_400_000);
  return days.map((day) => (day + offset + 7) % 7);
}

function localTime(timestamp: number) {
  const date = new Date(timestamp);
  return { localHour: date.getHours(), localMinute: date.getMinutes() };
}

function nativeId(value: string) {
  let a = 0x811c9dc5; let b = 0x811c9dc5; let c = 0x811c9dc5; let d = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    a = Math.imul(a ^ code, 0x01000193); b = Math.imul(b ^ (code + index), 0x01000193);
    c = Math.imul(c ^ (code + a), 0x01000193); d = Math.imul(d ^ (code + b), 0x01000193);
  }
  const hex = [a, b, c, d].map((part) => (part >>> 0).toString(16).padStart(8, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export async function scheduleNativeAlarmSet(
  plan: MorningPlan,
  occurrences: AlarmOccurrence[],
  options: { soundEnabled: boolean; vibrationEnabled: boolean },
) {
  if (!OutAlarmNative || Platform.OS === "web" || !(await OutAlarmNative.isSupported())) return { handled: false as const };
  const authorization = await OutAlarmNative.requestAuthorization();
  if (authorization !== "authorized") return { handled: true as const, ok: false as const, error: "시스템 알람 권한을 허용해야 앱이 꺼져 있어도 울립니다." };
  if (!(await OutAlarmNative.canScheduleExactAlarms())) {
    await OutAlarmNative.openExactAlarmSettings();
    return { handled: true as const, ok: false as const, error: "정확한 알람 권한을 켠 뒤 다시 저장해 주세요." };
  }
  const repeatDays = plan.repeatDays ?? [];
  const nativeOccurrences = repeatDays.length ? occurrences.slice(0, 1) : occurrences;
  const storedIds = await AsyncStorage.getItem(NATIVE_ALARM_IDS_KEY);
  const previousIds = storedIds ? JSON.parse(storedIds) as string[] : [];
  if (!storedIds) await OutAlarmNative.cancelAll();
  const scheduledIds: string[] = [];
  for (const [index, occurrence] of nativeOccurrences.entries()) {
    const requests: NativeAlarmRequest[] = [
      { id: nativeId(`${plan.id}-${index}-wake-${occurrence.wakeAt}`), title: "기상할 시간이에요", body: `${plan.eventTitle} · 기상 완료를 누르면 측정이 시작됩니다.`, timestamp: occurrence.wakeAt, kind: "wake-alarm", planId: plan.id, repeatDays, ...localTime(occurrence.wakeAt), ...options },
      { id: nativeId(`${plan.id}-${index}-last-call-${occurrence.lastCallAt}`), title: "LAST CALL", body: "10분 안에 집을 나가세요.", timestamp: occurrence.lastCallAt, kind: "last-call", planId: plan.id, repeatDays: shiftedRepeatDays(repeatDays, occurrence.wakeAt, occurrence.lastCallAt), ...localTime(occurrence.lastCallAt), ...options },
      { id: nativeId(`${plan.id}-${index}-out-${occurrence.outAt}`), title: "OUT NOW", body: "목표 출발 시간입니다. 지금 집을 나가세요.", timestamp: occurrence.outAt, kind: "out-alarm", planId: plan.id, repeatDays: shiftedRepeatDays(repeatDays, occurrence.wakeAt, occurrence.outAt), ...localTime(occurrence.outAt), ...options },
    ];
    try {
      for (const request of requests) {
        await OutAlarmNative.schedule(request);
        scheduledIds.push(request.id);
      }
    } catch (error) {
      await OutAlarmNative.cancel(scheduledIds).catch(() => undefined);
      throw error;
    }
  }
  await OutAlarmNative.cancel(previousIds.filter((id) => !scheduledIds.includes(id)));
  await AsyncStorage.setItem(NATIVE_ALARM_IDS_KEY, JSON.stringify(scheduledIds));
  return { handled: true as const, ok: true as const, mode: "native" as const };
}

export async function cancelNativeAlarms() {
  if (OutAlarmNative) await OutAlarmNative.cancelAll();
  await AsyncStorage.removeItem(NATIVE_ALARM_IDS_KEY);
}

export async function scheduleNativeSnooze(plan: MorningPlan, timestamp: number, options: { soundEnabled: boolean; vibrationEnabled: boolean }) {
  if (!OutAlarmNative || Platform.OS === "web" || !(await OutAlarmNative.isSupported()) || !options.soundEnabled) return false;
  const authorization = await OutAlarmNative.requestAuthorization();
  if (authorization !== "authorized" || !(await OutAlarmNative.canScheduleExactAlarms())) return false;
  await OutAlarmNative.schedule({
    id: nativeId(`${plan.id}-snooze-${timestamp}`),
    title: "다시 일어날 시간이에요",
    body: "5분 다시 알림이 끝났습니다.",
    timestamp,
    kind: "wake-alarm",
    planId: plan.id,
    repeatDays: [],
    ...localTime(timestamp),
    ...options,
  });
  return true;
}

export async function consumePendingNativeAlarm() {
  if (!OutAlarmNative || Platform.OS === "web") return null;
  try {
    return await OutAlarmNative.consumePendingAlarm();
  } catch {
    return null;
  }
}
