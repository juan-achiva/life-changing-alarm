import { requireOptionalNativeModule } from "expo-modules-core";

export type NativeAlarmRequest = {
  id: string; title: string; body: string; timestamp: number;
  kind: "wake-alarm" | "last-call" | "out-alarm"; planId: string;
  repeatDays?: number[];
  localHour?: number;
  localMinute?: number;
  soundEnabled: boolean; vibrationEnabled: boolean;
};

export type OutAlarmNativeModule = {
  isSupported(): Promise<boolean>;
  requestAuthorization(): Promise<string>;
  canScheduleExactAlarms(): Promise<boolean>;
  openExactAlarmSettings(): Promise<void>;
  consumePendingAlarm(): Promise<{ timestamp: number; kind: "wake-alarm" | "last-call" | "out-alarm"; planId: string } | null>;
  schedule(request: NativeAlarmRequest): Promise<{ id: string }>;
  cancel(ids: string[]): Promise<void>;
  cancelAll(): Promise<void>;
};

export default requireOptionalNativeModule<OutAlarmNativeModule>("OutAlarmNative");
