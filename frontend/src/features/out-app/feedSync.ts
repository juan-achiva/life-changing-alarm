import { addDoc, collection, deleteDoc, doc, limit, onSnapshot, orderBy, query, serverTimestamp, setDoc } from "firebase/firestore";

import { auth, db, isFirebaseConfigured } from "@/src/lib/firebase";
import type { GroupProfile, WakeToOutRecord } from "./types";
import { notifyGroupPost } from "./groupPushNotifications";

const mediaBaseUrl = (
  process.env.EXPO_PUBLIC_MEDIA_URL
  ?? process.env.EXPO_PUBLIC_AI_FEEDBACK_URL?.replace(/\/feedback\/?$/, "")
  ?? process.env.EXPO_PUBLIC_AI_RECOMMENDATION_URL?.replace(/\/(recommend|feedback)\/?$/, "")
)?.replace(/\/$/, "");

export function subscribeGroupFeed(groupId: string, onChange: (records: WakeToOutRecord[]) => void, onError?: (error: Error) => void) {
  ensureServer();
  const posts = query(collection(db!, "groups", groupId, "posts"), orderBy("outAt", "desc"), limit(50));
  return onSnapshot(posts, (snapshot) => {
    onChange(snapshot.docs.map((item) => ({ id: item.id, ...item.data() } as WakeToOutRecord)));
  }, (error) => onError?.(error));
}

export async function publishGroupRecord(group: GroupProfile, record: WakeToOutRecord, comment?: Promise<string | undefined>): Promise<WakeToOutRecord> {
  ensureServer();
  const user = auth!.currentUser;
  if (!user) throw new Error("서버 사용자 정보를 확인하지 못했어요.");
  const [photo, aiComment] = await Promise.all([
    record.photoUri ? uploadPhoto(group.id, record.id, record.photoUri) : Promise.resolve(null),
    comment ?? Promise.resolve(record.aiComment),
  ]);
  const synced: WakeToOutRecord = { ...record, groupId: group.id, photoUri: photo?.url ?? null, photoKey: photo?.key, aiComment, authorUserId: user.uid };
  const payload = Object.fromEntries(Object.entries({
    ...synced,
    authorUserId: user.uid,
    createdAt: serverTimestamp(),
  }).filter(([, value]) => value !== undefined));
  await setDoc(doc(db!, "groups", group.id, "posts", record.id), payload);
  await notifyGroupPost(group.id, record.id).catch((error) => console.warn("Group post push failed", error));
  return synced;
}

async function uploadPhoto(groupId: string, recordId: string, localUri: string) {
  if (!mediaBaseUrl) throw new Error("사진 업로드 서버 주소가 설정되지 않았어요.");
  const user = auth!.currentUser;
  if (!user) throw new Error("서버 사용자 정보를 확인하지 못했어요.");
  const imageResponse = await fetch(localUri);
  if (!imageResponse.ok) throw new Error("인증 사진을 읽지 못했어요.");
  const image = await imageResponse.blob();
  const token = await user.getIdToken();
  const upload = await fetch(`${mediaBaseUrl}/photos?groupId=${encodeURIComponent(groupId)}&recordId=${encodeURIComponent(recordId)}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": image.type || "image/jpeg" },
    body: image,
  });
  const result = await upload.json() as { url?: string; key?: string; error?: string };
  if (!upload.ok || !result.url) throw new Error(result.error ?? "사진을 서버에 올리지 못했어요.");
  return { url: result.url, key: result.key };
}

export async function deleteGroupRecord(groupId: string, record: WakeToOutRecord) {
  ensureServer();
  const user = auth!.currentUser;
  if (!user || record.authorUserId !== user.uid) throw new Error("본인의 게시물만 삭제할 수 있어요.");
  if (record.photoKey && mediaBaseUrl) {
    const token = await user.getIdToken();
    await fetch(`${mediaBaseUrl}/photos/${encodeURIComponent(record.photoKey)}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
  }
  await deleteDoc(doc(db!, "groups", groupId, "posts", record.id));
}

export async function reportGroupRecord(groupId: string, record: WakeToOutRecord, reason = "부적절한 콘텐츠") {
  ensureServer();
  const user = auth!.currentUser;
  if (!user) throw new Error("사용자 정보를 확인하지 못했어요.");
  await addDoc(collection(db!, "reports"), { groupId, postId: record.id, reportedUserId: record.authorUserId ?? null, reporterUserId: user.uid, reason, status: "open", createdAt: serverTimestamp() });
}

export async function deleteRemoteMedia() {
  if (!mediaBaseUrl || !auth?.currentUser) return;
  const token = await auth.currentUser.getIdToken();
  const response = await fetch(`${mediaBaseUrl}/account-data`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error("서버 사진을 삭제하지 못했어요.");
}

export const getMediaBaseUrl = () => mediaBaseUrl;

function ensureServer() {
  if (!isFirebaseConfigured || !auth || !db) throw new Error("Firebase 서버 연결을 확인해 주세요.");
}
