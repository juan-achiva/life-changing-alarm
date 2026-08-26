import { signInAnonymously } from "firebase/auth";
import { doc, getDoc, onSnapshot, runTransaction, serverTimestamp } from "firebase/firestore";

import { auth, db, isFirebaseConfigured } from "@/src/lib/firebase";
import type { GroupProfile } from "./types";

type OutGroupDocument = {
  name: string;
  inviteCode: string;
  inviteCodeNormalized?: string;
  memberCount: number;
  maxMembers: number;
  ownerUserId: string;
  memberNames: string[];
  memberProfiles?: { userId: string; displayName: string }[];
  memberUserIds?: string[];
};

const groupApiBaseUrl = (
  process.env.EXPO_PUBLIC_MEDIA_URL
  ?? process.env.EXPO_PUBLIC_AI_FEEDBACK_URL?.replace(/\/feedback\/?$/, "")
  ?? process.env.EXPO_PUBLIC_AI_RECOMMENDATION_URL?.replace(/\/(recommend|feedback)\/?$/, "")
)?.replace(/\/$/, "");

export async function createOutGroup(groupName: string, memberName: string): Promise<GroupProfile> {
  ensureFirebase();
  const user = await getAnonymousUser(memberName);
  const inviteCode = await generateUniqueInviteCode();
  const groupRef = doc(db!, "groups", inviteCode);
  const name = groupName.trim();

  await runTransaction(db!, async (transaction) => {
    transaction.set(groupRef, { name, inviteCode, inviteCodeNormalized: inviteCode, memberCount: 1, maxMembers: 7, ownerUserId: user.uid, memberNames: [memberName], memberProfiles: [{ userId: user.uid, displayName: memberName }], memberUserIds: [user.uid], createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    transaction.set(doc(db!, "users", user.uid), { groupId: groupRef.id, groupName: name, role: "owner", updatedAt: serverTimestamp() }, { merge: true });
  });
  return { id: groupRef.id, name, inviteCode, memberName, memberNames: [memberName] };
}

export async function joinOutGroup(inviteCode: string, memberName: string): Promise<GroupProfile> {
  ensureFirebase();
  const user = await getAnonymousUser(memberName);
  const code = normalizeInviteCode(inviteCode);
  if (!/^[A-Z0-9]{8}$/.test(code)) throw new Error("8자리 초대 코드를 확인해 주세요.");
  if (!groupApiBaseUrl) throw new Error("그룹 가입 서버 주소가 설정되지 않았어요.");
  const idToken = await user.getIdToken();
  const response = await fetch(`${groupApiBaseUrl}/groups/join`, {
    method: "POST",
    headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ inviteCode: code, memberName: memberName.trim() }),
  });
  const result = await response.json() as GroupProfile & { error?: string };
  if (!response.ok || !result.id) throw new Error(result.error ?? "그룹 가입을 처리하지 못했어요.");
  return result;
}

export async function leaveOutGroup(profile: GroupProfile) {
  ensureFirebase();
  // The first OUT prototype stored groups only on the device with IDs such as
  // `group-ABC123`. They have no Firebase membership to remove.
  if (profile.id.startsWith("group-") || profile.id.startsWith("local-group-")) return;
  const user = auth!.currentUser ?? (await signInAnonymously(auth!)).user;
  const groupRef = doc(db!, "groups", profile.id);
  const current = await getDoc(groupRef).catch(() => null);
  // Groups created by the earlier local prototype never existed in Firestore.
  // Clearing local membership is the complete leave operation for those groups.
  if (!current?.exists()) return;
  const currentGroup = current.data() as OutGroupDocument;
  const isRemoteMember = currentGroup.ownerUserId === user.uid || (currentGroup.memberProfiles ?? []).some((member) => member.userId === user.uid);
  // A legacy locally cached group may predate anonymous identity persistence.
  // Do not mutate somebody else's remote membership; allow the local session to leave.
  if (!isRemoteMember) return;
  await runTransaction(db!, async (transaction) => {
    const snapshot = await transaction.get(groupRef);
    if (snapshot.exists()) {
      const group = snapshot.data() as OutGroupDocument;
      const memberProfiles = (group.memberProfiles ?? []).filter((member) => member.userId !== user.uid);
      if (group.ownerUserId === user.uid && memberProfiles.length === 0) transaction.delete(groupRef);
      else {
        const nextOwnerUserId = group.ownerUserId === user.uid
          ? memberProfiles[Math.floor(Math.random() * memberProfiles.length)].userId
          : group.ownerUserId;
        transaction.update(groupRef, { ownerUserId: nextOwnerUserId, memberProfiles, memberUserIds: memberProfiles.map((member) => member.userId), memberNames: memberProfiles.map((member) => member.displayName), memberCount: memberProfiles.length, updatedAt: serverTimestamp() });
      }
    }
    transaction.set(doc(db!, "users", user.uid), { groupId: null, groupName: null, role: null, updatedAt: serverTimestamp() }, { merge: true });
  });
}

export function subscribeOutGroup(groupId: string, memberName: string, onChange: (group: GroupProfile) => void, onError?: (error: Error) => void) {
  ensureFirebase();
  return onSnapshot(doc(db!, "groups", groupId), (snapshot) => {
    if (!snapshot.exists()) return;
    const data = snapshot.data() as OutGroupDocument;
    onChange({ id: groupId, memberName, name: data.name, inviteCode: normalizeInviteCode(data.inviteCode), memberNames: data.memberNames ?? [] });
  }, (error) => onError?.(error));
}

async function getAnonymousUser(displayName: string) {
  let credential;
  try {
    credential = auth!.currentUser ? { user: auth!.currentUser } : await signInAnonymously(auth!);
  } catch (error) {
    if (isAnonymousAuthUnavailable(error)) throw new Error("서버 익명 로그인이 꺼져 있어요. Firebase Authentication에서 익명 로그인을 활성화해 주세요.");
    throw error;
  }
  await runTransaction(db!, async (transaction) => {
    const userRef = doc(db!, "users", credential.user.uid);
    const snapshot = await transaction.get(userRef);
    if (!snapshot.exists()) transaction.set(userRef, { provider: "anonymous", providerUserId: credential.user.uid, displayName, email: null, groupId: null, groupName: null, role: null, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    else transaction.set(userRef, { displayName, updatedAt: serverTimestamp() }, { merge: true });
  });
  return credential.user;
}

async function generateUniqueInviteCode() {
  // Firestore treats a write to an existing code as an update, which the
  // create-only rule rejects. Eight base-36 characters make a collision
  // negligible without requiring collection access before creation.
  return Math.random().toString(36).slice(2, 10).toUpperCase().padEnd(8, "0");
}

function ensureFirebase() {
  if (!isFirebaseConfigured || !auth || !db) throw new Error("Firebase 연결을 확인해 주세요.");
}

function isAnonymousAuthUnavailable(error: unknown) {
  const message = error instanceof Error ? messageWithCode(error) : String(error);
  return message.includes("auth/configuration-not-found") || message.includes("auth/operation-not-allowed");
}

function messageWithCode(error: Error & { code?: string }) {
  return `${error.code ?? ""} ${error.message}`;
}

export function normalizeInviteCode(value: string) {
  return value.trim().toLocaleUpperCase("en-US");
}
