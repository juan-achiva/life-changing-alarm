import { requireOptionalNativeModule } from "expo-modules-core";

export type NativeAlarmRequest = {
  id: string; title: string; body: string; timestamp: number;
  kind: "wake-alarm" | "last-call"; planId: string;
  soundEnabled: boolean; vibrationEnabled: boolean;
};

export type OutAlarmNativeModule = {
  isSupported(): Promise<boolean>;
  requestAuthorization(): Promise<string>;
  canScheduleExactAlarms(): Promise<boolean>;
  openExactAlarmSettings(): Promise<void>;
  consumePendingAlarm(planId: string): Promise<{ timestamp: number; kind: "wake-alarm" | "last-call" } | null>;
  schedule(request: NativeAlarmRequest): Promise<{ id: string }>;
  cancelAll(): Promise<void>;
};

export default requireOptionalNativeModule<OutAlarmNativeModule>("OutAlarmNative");
