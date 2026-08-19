import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
  where,
} from "firebase/firestore";
import { deleteObject, getDownloadURL, ref, uploadBytes } from "firebase/storage";

import { db, isFirebaseConfigured, storage } from "@/src/lib/firebase";
import { demoPosts, type GracePost } from "@/src/features/grace-app/mockData";

type FirestoreGracePost = {
  authorId: string;
  authorName: string;
  groupId: string;
  groupName: string;
  verse?: string;
  verseText?: string;
  verseReference?: string;
  caption: string;
  imageUrl: string;
  imagePath: string;
  createdAt?: Timestamp | null;
};

export function subscribeGracePosts(
  groupId: string,
  onChange: (posts: GracePost[]) => void,
  onError: (error: Error) => void,
) {
  if (!isFirebaseConfigured || !db) {
    onChange(demoPosts);
    return () => undefined;
  }

  const postsCollection = collection(db, "gracePosts");
  const postsQuery = query(postsCollection, where("groupId", "==", groupId), orderBy("createdAt", "desc"));

  return onSnapshot(
    postsQuery,
    (snapshot) => {
      const posts = snapshot.docs.map((item) => mapPost(item.id, item.data() as FirestoreGracePost));
      onChange(posts);
    },
    (error) => {
      onError(error as Error);
    },
  );
}

export async function createGracePost(input: {
  authorId: string;
  authorName: string;
  groupId: string;
  groupName: string;
  verseText: string;
  verseReference: string;
  caption: string;
  imageUri: string;
}) {
  if (!isFirebaseConfigured || !db || !storage) {
    throw new Error("새 Firebase 프로젝트 설정값이 아직 연결되지 않았어요. .env 파일을 먼저 채워주세요.");
  }

  const postsCollection = collection(db, "gracePosts");
  const imagePath = `grace-posts/${input.authorId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
  const imageRef = ref(storage, imagePath);
  const imageBlob = await uriToBlob(input.imageUri);

  await uploadBytes(imageRef, imageBlob, {
    contentType: "image/jpeg",
  });

  const imageUrl = await getDownloadURL(imageRef);

  await addDoc(postsCollection, {
    authorId: input.authorId,
    authorName: input.authorName,
    groupId: input.groupId,
    groupName: input.groupName,
    verseText: input.verseText.trim(),
    verseReference: input.verseReference.trim(),
    caption: input.caption.trim() || "오늘 받은 은혜를 사진으로 남겼어요.",
    imageUrl,
    imagePath,
    createdAt: serverTimestamp(),
  });
}

export async function deleteGracePost(post: GracePost) {
  if (!isFirebaseConfigured || !db || !storage) {
    throw new Error("데모 모드에서는 삭제가 로컬 목데이터에만 표시됩니다. Firebase 설정 후 다시 시도해 주세요.");
  }

  await deleteDoc(doc(db, "gracePosts", post.id));

  if (post.imagePath) {
    try {
      await deleteObject(ref(storage, post.imagePath));
    } catch {
      // Older prototype uploads may have a legacy path layout. Keep the post deleted
      // even if the original file cleanup is blocked by the newer storage rule.
    }
  }
}

export async function purgeGracePostsByAuthor(userId: string) {
  if (!isFirebaseConfigured || !db || !storage) {
    return;
  }

  const activeStorage = storage;
  const postsSnapshot = await getDocs(query(collection(db, "gracePosts"), where("authorId", "==", userId)));

  await Promise.all(
    postsSnapshot.docs.map(async (item) => {
      const post = mapPost(item.id, item.data() as FirestoreGracePost);

      await deleteDoc(item.ref);

      if (post.imagePath) {
        try {
          await deleteObject(ref(activeStorage, post.imagePath));
        } catch {
          // Keep deleting remaining account data even if some legacy uploads cannot be removed.
        }
      }
    }),
  );
}

export async function reportGracePost(input: {
  reporterId: string;
  reporterName: string;
  post: GracePost;
}) {
  if (!isFirebaseConfigured || !db) {
    return;
  }

  await addDoc(collection(db, "gracePostReports"), {
    reporterId: input.reporterId,
    reporterName: input.reporterName,
    postId: input.post.id,
    postAuthorId: input.post.authorId ?? null,
    postAuthorName: input.post.authorName,
    groupId: input.post.groupId ?? null,
    groupName: input.post.groupName,
    caption: input.post.caption,
    verseReference: input.post.verseReference ?? null,
    imagePath: input.post.imagePath ?? null,
    createdAt: serverTimestamp(),
  });
}

function mapPost(id: string, post: FirestoreGracePost): GracePost {
  const createdAtMs = post.createdAt ? post.createdAt.toDate().getTime() : undefined;

  return {
    id,
    authorId: post.authorId,
    authorName: post.authorName,
    groupId: post.groupId,
    groupName: post.groupName,
    verseText: post.verseText?.trim() || post.verse?.trim() || undefined,
    verseReference: post.verseReference?.trim() || undefined,
    caption: post.caption,
    imageUri: post.imageUrl,
    imagePath: post.imagePath,
    createdLabel: formatCreatedLabel(post.createdAt),
    createdAtMs,
  };
}

function formatCreatedLabel(createdAt?: Timestamp | null) {
  if (!createdAt) {
    return "방금 전";
  }

  const createdDate = createdAt.toDate();
  const now = new Date();
  const isToday =
    createdDate.getFullYear() === now.getFullYear() &&
    createdDate.getMonth() === now.getMonth() &&
    createdDate.getDate() === now.getDate();

  if (isToday) {
    return new Intl.DateTimeFormat("ko-KR", {
      hour: "numeric",
      minute: "2-digit",
    }).format(createdDate);
  }

  return new Intl.DateTimeFormat("ko-KR", {
    month: "numeric",
    day: "numeric",
  }).format(createdDate);
}

async function uriToBlob(uri: string) {
  const response = await fetch(uri);
  return await response.blob();
}
