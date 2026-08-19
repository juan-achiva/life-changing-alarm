# Grace Onecut Firebase Setup

이 앱은 기존 프로젝트의 Firebase를 더 이상 사용하지 않습니다.

현재 구조는 `새 Firebase 프로젝트 전용`으로 분리되어 있습니다.

## 1. 새 Firebase 프로젝트 만들기

Firebase 콘솔에서 새 프로젝트를 생성합니다.

현재 연결된 독립 프로젝트:
- `todaygrace-juan`

## 2. 필요한 서비스 켜기

- Firestore Database
- Storage

## 3. Web App 등록

Firebase 콘솔에서 Web App을 하나 등록하고 config 값을 복사합니다.

필요한 값:
- `apiKey`
- `authDomain`
- `projectId`
- `storageBucket`
- `messagingSenderId`
- `appId`

## 4. 로컬 환경변수 파일 만들기

프로젝트 루트에서 아래 파일을 복사합니다.

```bash
cp .env.example .env
```

그 다음 `.env`에 새 Firebase 프로젝트 값을 채웁니다.

## 5. 앱 동작 방식

- 환경변수가 비어 있으면 앱은 `데모 모드`로 실행됩니다.
- 환경변수가 채워지면 Firestore/Storage 실데이터 모드로 실행됩니다.

## 6. 기존 파일에 대해

- `google-services.json`은 현재 앱에서 더 이상 참조하지 않습니다.
- 즉, 기존 Android Firebase 설정은 이 앱 실행에 사용되지 않습니다.
