import { Linking } from "react-native";
import { getMediaBaseUrl } from "./feedSync";

const FALLBACK_SITE = "https://life-changing-alarm.juankimkim.workers.dev";
const base = getMediaBaseUrl() ?? FALLBACK_SITE;

export const PRIVACY_URL = `${base}/privacy`;
export const TERMS_URL = `${base}/terms`;
export const SUPPORT_EMAIL = "todaygrace2026@gmail.com";

export async function openLegalPage(url: string) {
  const supported = await Linking.canOpenURL(url);
  if (!supported) throw new Error("페이지를 열 수 없어요.");
  await Linking.openURL(url);
}
