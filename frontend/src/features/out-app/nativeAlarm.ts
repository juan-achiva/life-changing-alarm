import { Platform } from "react-native";

import OutAlarmNative, { type NativeAlarmRequest } from "../../../modules/out-alarm-native";
import type { MorningPlan } from "./types";

export type AlarmOccurrence = { wakeAt: number; outAt: number };

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
  await OutAlarmNative.cancelAll();
  for (const [index, occurrence] of occurrences.entries()) {
    const requests: NativeAlarmRequest[] = [
      { id: nativeId(`${plan.id}-${index}-wake-${occurrence.wakeAt}`), title: "기상할 시간이에요", body: `${plan.eventTitle} · 기상 완료를 누르면 측정이 시작됩니다.`, timestamp: occurrence.wakeAt, kind: "wake-alarm", planId: plan.id, ...options },
      { id: nativeId(`${plan.id}-${index}-out-${occurrence.outAt}`), title: "OUT NOW — 출발할 시간이에요", body: "Wake-to-Out 목표 시간이 됐습니다. 지금 나가세요.", timestamp: occurrence.outAt, kind: "out-alarm", planId: plan.id, ...options },
    ];
    for (const request of requests) await OutAlarmNative.schedule(request);
  }
  return { handled: true as const, ok: true as const, mode: "native" as const };
}

export async function cancelNativeAlarms() {
  if (OutAlarmNative) await OutAlarmNative.cancelAll();
}
