import { auth } from "@/src/lib/firebase";

export type FeedbackCharacter = "kind" | "tough" | "analyst" | "hype" | "custom";

const feedbackUrl = (process.env.EXPO_PUBLIC_AI_FEEDBACK_URL ?? process.env.EXPO_PUBLIC_AI_RECOMMENDATION_URL?.replace(/\/recommend\/?$/, "/feedback"))?.trim();

type FeedbackInput = { character: FeedbackCharacter; characterName?: string; personality?: string; durationSeconds: number; deltaSeconds: number; previousDurationSeconds?: number; recentComments?: string[]; variationIndex?: number };

export async function getPostFeedback(input: FeedbackInput): Promise<string> {
  if (!feedbackUrl) return localFeedback(input);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const token = await auth?.currentUser?.getIdToken();
    const response = await fetch(feedbackUrl, { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(input), signal: controller.signal });
    if (!response.ok) throw new Error(`AI feedback failed: ${response.status}`);
    const result: unknown = await response.json();
    return result && typeof result === "object" && typeof (result as { comment?: unknown }).comment === "string" ? (result as { comment: string }).comment : localFeedback(input);
  } catch {
    return localFeedback(input);
  } finally {
    clearTimeout(timeout);
  }
}

function localFeedback(input: FeedbackInput) {
  const minutes = Math.max(1, Math.round(input.durationSeconds / 60));
  const result = input.deltaSeconds >= 0 ? `목표보다 ${Math.max(1, Math.ceil(input.deltaSeconds / 60))}분 빨랐어` : `목표보다 ${Math.max(1, Math.ceil(-input.deltaSeconds / 60))}분 늦었어`;
  const index = Math.abs(input.variationIndex ?? Date.now()) % 4;
  const variants: Record<FeedbackCharacter, string[]> = {
    tough: [`${minutes}분이면 침대와 협상은 끝났네. ${result}.`, `${result}. 오늘은 봐준다—내일은 준비 동선 더 짧게!`, `출발 도장 완료. ${minutes}분 기록, 다음엔 여기서 한 칸만 당겨보자.`, `결국 나왔네. ${minutes}분짜리 아침 전투, 오늘도 클리어.`],
    analyst: [`Wake-to-Out ${minutes}분. ${result}; 오늘 기준값으로 기록했습니다.`, `${result}. 속도보다 이 흐름이 반복되는지가 다음 관찰 포인트입니다.`, `오늘 준비 구간은 ${minutes}분입니다. 다음 기록에서 변화를 비교하겠습니다.`, `출발 완료. 목표 오차와 준비 시간을 각각 기록해 두었습니다.`],
    hype: [`OUT 성공! ${minutes}분 만에 오늘 아침 미션 클리어!`, `${result}! 문밖으로 나온 순간 오늘 텐션은 이미 승리야 🔥`, `좋아, 출발 버튼 제대로 눌렀다! 다음 아침도 이 기세로 가자.`, `${minutes}분 기록 접수! 오늘도 집 밖까지 추진력 폭발!`],
    kind: [`오늘도 무사히 나왔네요. ${minutes}분의 준비를 잘 마쳤어요.`, `${result}. 서두르기보다 끝까지 출발한 게 제일 좋아요.`, `문밖까지 잘 도착했어요. 오늘 아침의 작은 성공을 기록해둘게요.`, `${minutes}분 동안 차근차근 준비했네요. 내일 아침도 곁에 있을게요.`],
    custom: [`오늘 기록은 ${minutes}분, ${result}.`, `출발 인증 완료. 오늘의 흐름을 다음 기록과 이어볼게.`, `${minutes}분 만에 OUT. 오늘 아침도 한 칸 전진했어.`, `${result}. 말보다 기록이 먼저 보여주네.`],
  };
  return variants[input.character][index];
}
