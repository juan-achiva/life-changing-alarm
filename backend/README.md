# Firebase configuration

OUT은 Firebase Anonymous Auth와 Firestore를 그룹 생성·참여에 사용합니다.

1. Firebase Authentication에서 익명 로그인을 활성화합니다.
2. Firestore 데이터베이스를 생성합니다.
3. 프로젝트를 연결한 뒤 규칙을 배포합니다.

```bash
firebase use your_project_id
firebase deploy --only firestore
```

Firebase 웹 설정값은 `frontend/.env.local`에만 저장합니다.
