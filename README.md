# OUT — 알람으로 인생바꾸기

알람을 끈 순간부터 외출 인증을 남길 때까지의 `Wake-to-Out` 시간을 기록하고 그룹과 공유하는 모닝 앱입니다.

## 주요 기능

- 하나의 기상 알람과 목표 출발 시간 설정
- 알람 종료 후 Wake-to-Out 스톱워치 시작
- 사진 외출 인증과 그룹별 7일 피드
- 사용자가 정한 캐릭터의 인증 댓글
- 그룹 초대 코드 생성 및 참여
- 게시물 신고·숨김·사용자 차단
- 그룹 탈퇴 및 내 계정·기록·사진 삭제

## 구성

- `frontend/`: Expo Router + React Native + TypeScript 앱
- `backend/`: Firebase Authentication 및 Firestore 보안 규칙
- `ai-worker/`: Cloudflare Worker 기반 사진 저장과 캐릭터 댓글 API

## 로컬 실행

```bash
cd frontend
npm install
cp .env.example .env.local
npx expo start
```

필요한 공개 클라이언트 설정값은 `frontend/.env.example`에 정리되어 있습니다. 실제 키와 로컬 환경 파일은 Git에 커밋하지 않습니다.

## 배포

Firestore 규칙:

```bash
cd backend
firebase deploy --only firestore:rules,firestore:indexes
```

Cloudflare Worker:

```bash
cd ai-worker
npm install
npx wrangler deploy
```

`OPENAI_API_KEY`와 `FIREBASE_API_KEY`는 Worker secret으로 등록해야 합니다.

## 개인정보 및 커뮤니티 안전

앱 설정에서 개인정보 처리방침과 이용약관을 확인할 수 있으며, 계정 삭제 시 사용자가 올린 기록과 원격 사진도 함께 삭제됩니다. 그룹 피드에는 신고, 숨김, 사용자 차단 기능이 포함되어 있습니다.
