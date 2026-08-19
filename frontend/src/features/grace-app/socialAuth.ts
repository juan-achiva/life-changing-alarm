import * as AppleAuthentication from "expo-apple-authentication";
import * as AuthSession from "expo-auth-session";
import * as WebBrowser from "expo-web-browser";

WebBrowser.maybeCompleteAuthSession();

const kakaoRestApiKey = process.env.EXPO_PUBLIC_KAKAO_REST_API_KEY;
const kakaoRedirectBridgeUri =
  process.env.EXPO_PUBLIC_KAKAO_REDIRECT_BRIDGE_URI || "https://life-changing-alarm-juan.web.app/kakao-bridge.html";

export const kakaoAppRedirectUri = AuthSession.makeRedirectUri({
  scheme: "graceonecut",
  path: "kakao",
});
export const kakaoConsoleRedirectUri = kakaoRedirectBridgeUri;

export async function isAppleLoginAvailable() {
  return await AppleAuthentication.isAvailableAsync();
}

export async function signInWithApple() {
  const credential = await AppleAuthentication.signInAsync({
    requestedScopes: [
      AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
      AppleAuthentication.AppleAuthenticationScope.EMAIL,
    ],
  });

  if (!credential.identityToken) {
    throw new Error("Apple identity token을 받지 못했어요.");
  }

  return {
    identityToken: credential.identityToken,
    displayName: resolveAppleDisplayName(credential.fullName) || buildAppleFallbackDisplayName(credential.user),
    email: credential.email,
  };
}

export async function signInWithKakao() {
  if (!kakaoRestApiKey) {
    throw new Error(
      `Kakao REST API 키가 없어요. .env에 EXPO_PUBLIC_KAKAO_REST_API_KEY를 넣고, Kakao 콘솔에 Redirect URI ${kakaoConsoleRedirectUri} 를 등록해 주세요.`,
    );
  }

  const state = JSON.stringify({
    returnTo: kakaoAppRedirectUri,
    ts: Date.now(),
  });
  const authorizationUrl = new URL("https://kauth.kakao.com/oauth/authorize");
  authorizationUrl.search = new URLSearchParams({
    client_id: kakaoRestApiKey,
    redirect_uri: kakaoConsoleRedirectUri,
    response_type: "code",
    prompt: "select_account",
    state,
  }).toString();

  const result = await WebBrowser.openAuthSessionAsync(authorizationUrl.toString(), kakaoAppRedirectUri);

  if (result.type !== "success" || !result.url) {
    throw new Error("Kakao 로그인이 취소되었거나 완료되지 않았어요.");
  }

  const callbackUrl = new URL(result.url);
  const authorizationCode = callbackUrl.searchParams.get("code");
  const kakaoError = callbackUrl.searchParams.get("error");
  const kakaoErrorDescription = callbackUrl.searchParams.get("error_description");

  if (kakaoError) {
    throw new Error(kakaoErrorDescription || "Kakao 로그인에 실패했어요.");
  }

  if (!authorizationCode) {
    throw new Error("Kakao 인가 코드를 받지 못했어요.");
  }

  return {
    authorizationCode,
  };
}

function resolveAppleDisplayName(fullName: AppleAuthentication.AppleAuthenticationFullName | null) {
  if (!fullName) {
    return null;
  }

  const parts = [fullName.familyName, fullName.givenName].filter(Boolean);
  return parts.length > 0 ? parts.join("") : null;
}

function buildAppleFallbackDisplayName(appleUserId?: string | null) {
  const source = (appleUserId ?? "").trim();
  const numericTail = source.replace(/\D/g, "").slice(-4);
  const alphaNumericTail = source.replace(/[^a-zA-Z0-9]/g, "").slice(-4);
  const suffix = (numericTail || alphaNumericTail || "0001").padStart(4, "0");
  return `은혜#${suffix}`;
}
