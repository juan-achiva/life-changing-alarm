export type GracePost = {
  id: string;
  authorId?: string;
  authorName: string;
  groupId?: string;
  groupName: string;
  verseText?: string;
  verseReference?: string;
  caption: string;
  createdLabel: string;
  createdAtMs?: number;
  imageUri?: string;
  imagePath?: string;
  palette?: [string, string, string];
};

export const demoPosts: GracePost[] = [
  {
    id: "demo-1",
    authorName: "민수",
    groupName: "청년부 2조",
    verseText: "여호와는 나의 목자시니 내게 부족함이 없으리로다.",
    verseReference: "시편 23편 1절",
    caption: "봉사 끝나고 비친 오후 햇살이 오래 남았어요.",
    createdLabel: "오늘 오후 2:10",
    createdAtMs: new Date("2026-04-13T14:10:00+09:00").getTime(),
    palette: ["#E8C27A", "#D48F5D", "#F8EFE0"],
  },
  {
    id: "demo-2",
    authorName: "지현",
    groupName: "청년부 1조",
    verseText: "주의 말씀은 내 발에 등이요 내 길에 빛이니이다.",
    verseReference: "시편 119편 105절",
    caption: "예배 전에 본 하늘이 참 맑아서 마음이 고요해졌어요.",
    createdLabel: "오늘 오전 9:20",
    createdAtMs: new Date("2026-04-13T09:20:00+09:00").getTime(),
    palette: ["#B9CBB6", "#EEE5D7", "#8B9C7C"],
  },
  {
    id: "demo-3",
    authorName: "하은",
    groupName: "찬양팀",
    verseText: "항상 기뻐하라 쉬지 말고 기도하라 범사에 감사하라.",
    verseReference: "데살로니가전서 5장 16-18절",
    caption: "리허설 중 작은 미소들이 모여서 큰 위로가 되었어요.",
    createdLabel: "어제 오후 8:43",
    createdAtMs: new Date("2026-04-12T20:43:00+09:00").getTime(),
    palette: ["#EAD7C2", "#C08A6A", "#856357"],
  },
];

export const demoUser = {
  name: "민수",
  groupName: "청년부 2조",
  inviteCode: "GRACE-2026",
};
