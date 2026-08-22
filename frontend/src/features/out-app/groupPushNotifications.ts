import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import { auth } from "@/src/lib/firebase";

const pushBaseUrl = (
  process.env.EXPO_PUBLIC_MEDIA_URL
  ?? process.env.EXPO_PUBLIC_AI_FEEDBACK_URL?.replace(/\/feedback\/?$/, "")
  ?? process.env.EXPO_PUBLIC_AI_RECOMMENDATION_URL?.replace(/\/(recommend|feedback)\/?$/, "")
)?.replace(/\/$/, "");

export async function registerGroupPushNotifications(groupId: string) {
  if (!pushBaseUrl || Platform.OS === "web" || !auth) return;
  await auth.authStateReady();
  if (!auth.currentUser) return;
  const permission = await Notifications.getPermissionsAsync();
  const status = permission.granted ? permission : await Notifications.requestPermissionsAsync();
  if (!status.granted) return;
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("group-posts", {
      name: "그룹 새 인증",
      description: "같은 그룹 멤버가 외출 인증을 올렸을 때 알려드려요.",
      importance: Notifications.AndroidImportance.HIGH,
      sound: "default",
      enableVibrate: true,
      vibrationPattern: [0, 250, 150, 250],
    });
  }
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) return;
  const pushToken = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  const idToken = await auth.currentUser.getIdToken();
  const response = await fetch(`${pushBaseUrl}/push/register`, {
    method: "POST",
    headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ groupId, pushToken }),
  });
  if (!response.ok) throw new Error("그룹 새 글 알림 기기를 등록하지 못했어요.");
}

export async function notifyGroupPost(groupId: string, postId: string) {
  if (!pushBaseUrl || !auth?.currentUser) return;
  const idToken = await auth.currentUser.getIdToken();
  const response = await fetch(`${pushBaseUrl}/push/group-post`, {
    method: "POST",
    headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ groupId, postId }),
  });
  if (!response.ok) throw new Error("그룹 새 글 알림을 보내지 못했어요.");
}
