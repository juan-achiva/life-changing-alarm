import { requireOptionalNativeModule } from "expo-modules-core";

export type NativeAlarmRequest = {
  id: string; title: string; body: string; timestamp: number;
  kind: "wake-alarm" | "out-alarm"; planId: string;
  soundEnabled: boolean; vibrationEnabled: boolean;
};

export type OutAlarmNativeModule = {
  isSupported(): Promise<boolean>;
  requestAuthorization(): Promise<string>;
  canScheduleExactAlarms(): Promise<boolean>;
  openExactAlarmSettings(): Promise<void>;
  schedule(request: NativeAlarmRequest): Promise<{ id: string }>;
  cancelAll(): Promise<void>;
};

export default requireOptionalNativeModule<OutAlarmNativeModule>("OutAlarmNative");
