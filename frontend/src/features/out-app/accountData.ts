import * as Notifications from "expo-notifications";
import { deleteUser } from "firebase/auth";
import { collection, deleteDoc, doc, getDocs, writeBatch } from "firebase/firestore";

import { auth, db } from "@/src/lib/firebase";
import { deleteRemoteMedia } from "./feedSync";
import { leaveOutGroup } from "./groups";
import { cancelNativeAlarms } from "./nativeAlarm";
import { clearOutLocalData } from "./storage";
import { stopStopwatchSurface } from "./stopwatchSurface";
import type { GroupProfile } from "./types";

export async function deleteAllUserData(group: GroupProfile | null) {
  const user = auth?.currentUser;
  if (!user || !db) throw new Error("사용자 정보를 확인하지 못했어요.");

  await deleteRemoteMedia();
  if (group) {
    const posts = await getDocs(collection(db, "groups", group.id, "posts"));
    const mine = posts.docs.filter((item) => item.data().authorUserId === user.uid);
    for (let offset = 0; offset < mine.length; offset += 400) {
      const batch = writeBatch(db);
      mine.slice(offset, offset + 400).forEach((item) => batch.delete(item.ref));
      await batch.commit();
    }
    await leaveOutGroup(group);
  }
  await deleteDoc(doc(db, "users", user.uid)).catch(() => undefined);
  await deleteUser(user);
  await Promise.all([
    clearOutLocalData(),
    Notifications.cancelAllScheduledNotificationsAsync().catch(() => undefined),
    cancelNativeAlarms().catch(() => undefined),
    stopStopwatchSurface(Date.now()).catch(() => undefined),
  ]);
}
