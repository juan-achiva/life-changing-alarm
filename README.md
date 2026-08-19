# OUT — 알람으로 인생바꾸기

알람을 끈 순간부터 실제로 집을 나갈 때까지 관리하는 모닝 에이전트입니다.

핵심 흐름은 `Tomorrow → Alarm → OUT Timer → I'M OUT → Result`이며, 외출 인증 사진 위에 실제 출발 시각과 Wake-to-Out 시간을 기록합니다.

구성은 아래처럼 나뉩니다.

- `frontend/`: Expo 기반 iOS/Android 클라이언트
- `backend/`: Firebase Functions, Firestore rules, Storage rules

## Frontend

`frontend/`는 Expo Router 기반 React Native 앱입니다.

주요 기능:

- Apple 로그인, Kakao 로그인
- 공동체(그룹) 생성/참여
- 하루 은혜 사진 업로드
- 랜덤 말씀 카드 오버레이
- 푸시 알림 설정
- RevenueCat 구독 결제 기반 공동체 확장

실행 예시:

```bash
cd frontend
npm install
npx expo start
```

## Backend

`backend/`는 Firebase 배포 자산입니다.

포함 내용:

- `functions/`: Firebase Functions
- `firestore.rules`
- `firestore.indexes.json`
- `storage.rules`
- `firebase.json`

배포 예시:

```bash
cd backend/functions
npm install
cd ..
firebase deploy
```

## Notes

- 실제 서비스 키는 커밋하지 않았습니다.
- `frontend/.env.example`를 기준으로 환경변수를 채워야 합니다.
- Firebase, Kakao, RevenueCat, Apple 설정은 각 콘솔에서 별도로 연결해야 합니다.
