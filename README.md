# 지자체 영업/대관 관리 — 웹앱

## 로컬에서 미리보기 (선택)
```
npm install
npm run dev
```

## 설정해야 하는 것
1. `src/firebase.js`의 `firebaseConfig` 값을 Firebase 콘솔에서 발급받은 값으로 교체
2. `src/firebase.js`의 `ALLOWED_EMAIL_DOMAIN`을 회사 이메일 도메인으로 교체

## Firestore 보안 규칙
Firebase 콘솔 > Firestore Database > 규칙(Rules) 탭에 아래 내용을 붙여넣고 "게시(Publish)"하세요.
`YOUR_COMPANY_DOMAIN` 부분은 실제 회사 이메일 도메인으로 바꿔주세요 (예: gonggammanse.co.kr).

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function isCompanyUser() {
      return request.auth != null
        && request.auth.token.email.matches('.*@YOUR_COMPANY_DOMAIN$');
    }
    match /municipalities/{muniId} {
      allow read, write: if isCompanyUser();
      match /history/{historyId} {
        allow read, write: if isCompanyUser();
      }
    }
  }
}
```

## 배포
GitHub에 이 폴더를 업로드한 뒤 Vercel에서 "Import Project"로 연결하면
자동으로 빌드/배포됩니다. (자세한 순서는 대화에서 안내한 단계별 가이드를 참고하세요.)
