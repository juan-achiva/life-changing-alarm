import { deleteUser, signInWithCustomToken, signOut } from "firebase/auth";
import { httpsCallable } from "firebase/functions";

import { auth, functions, isFirebaseConfigured } from "@/src/lib/firebase";
import type { SocialIdentity } from "@/src/features/grace-app/types";

type ExchangeResult = {
  customToken: string;
  identity: SocialIdentity;
};

export async function signInWithKakaoCustomToken(code: string) {
  ensureFirebaseAuth();

  try {
    const exchangeKakaoCode = httpsCallable<{ code: string }, ExchangeResult>(functions!, "exchangeKakaoCode");
    const response = await exchangeKakaoCode({ code });
    await signInWithCustomToken(auth!, response.data.customToken);
    await waitForFirebaseSessionReady();
    return response.data.identity;
  } catch (error) {
    throw normalizeFirebaseAuthError(error);
  }
}

export async function signInWithAppleCustomToken(input: {
  identityToken: string;
  displayName: string;
  email: string | null;
}) {
  ensureFirebaseAuth();

  try {
    const exchangeAppleIdentityToken = httpsCallable<
      { identityToken: string; displayName: string; email: string | null },
      ExchangeResult
    >(functions!, "exchangeAppleIdentityToken");

    const response = await exchangeAppleIdentityToken(input);
    await signInWithCustomToken(auth!, response.data.customToken);
    await waitForFirebaseSessionReady();
    return response.data.identity;
  } catch (error) {
    throw normalizeFirebaseAuthError(error);
  }
}

export async function signOutFirebaseSession() {
  if (!auth) {
    return;
  }

  await signOut(auth);
}

export async function deleteFirebaseAccountSession() {
  ensureFirebaseAuth();

  if (!auth?.currentUser) {
    throw new Error("삭제할 로그인 세션을 찾지 못했어요.");
  }

  try {
    await deleteUser(auth.currentUser);
  } catch (error) {
    const firebaseError = error as { code?: string; message?: string };
    const code = firebaseError.code ?? "";
    const message = firebaseError.message ?? "";

    if (code.includes("requires-recent-login") || message.includes("requires-recent-login")) {
      throw new Error("보안을 위해 다시 로그인한 뒤 회원 탈퇴를 시도해 주세요.");
    }

    throw normalizeFirebaseAuthError(error);
  }
}

function ensureFirebaseAuth() {
  if (!isFirebaseConfigured || !auth || !functions) {
    throw new Error("Firebase Auth가 아직 준비되지 않았어요.");
  }
}

async function waitForFirebaseSessionReady() {
  const user = auth?.currentUser;
  if (!user) {
    throw new Error("Firebase 로그인 세션을 만들지 못했어요.");
  }

  await user.getIdToken(true);
  await new Promise((resolve) => setTimeout(resolve, 250));
}

function normalizeFirebaseAuthError(error: unknown) {
  const firebaseError = error as { code?: string; message?: string };
  const code = firebaseError.code ?? "";
  const message = firebaseError.message ?? "";

  if (code.includes("permission-denied") || message.includes("permission-denied")) {
    return new Error(
      "서버에서 Firebase 커스텀 토큰을 만들 권한이 아직 없어요. Google Cloud IAM에서 함수 서비스 계정에 'Service Account Token Creator' 역할을 추가해 주세요.",
    );
  }

  if (code.includes("configuration-not-found") || message.includes("configuration-not-found")) {
    return new Error(
      "Firebase Authentication이 아직 초기화되지 않았어요. Firebase 콘솔에서 Authentication > 시작하기를 먼저 눌러 주세요.",
    );
  }

  if (code.includes("unauthenticated")) {
    if (message.trim().length > 0) {
      return new Error(`소셜 로그인 인증 교환에 실패했어요. ${message}`);
    }

    return new Error("소셜 로그인 인증 교환에 실패했어요. 카카오/애플 설정을 다시 확인해 주세요.");
  }

  return error instanceof Error ? error : new Error("Firebase 로그인 중 오류가 발생했어요.");
}
