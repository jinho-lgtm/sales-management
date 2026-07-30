import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';

// ⚠️ Firebase 콘솔(console.firebase.google.com) > 프로젝트 설정 > 일반 탭 하단
// "내 앱" 섹션에서 웹 앱을 추가하면 아래 값들을 그대로 복사해서 넣을 수 있어요.
const firebaseConfig = {
  apiKey: 'YOUR_API_KEY',
  authDomain: 'YOUR_PROJECT_ID.firebaseapp.com',
  projectId: 'YOUR_PROJECT_ID',
  storageBucket: 'YOUR_PROJECT_ID.appspot.com',
  messagingSenderId: 'YOUR_SENDER_ID',
  appId: 'YOUR_APP_ID',
};

// ⚠️ 전사 공유이지만 회사 구성원만 접근하게 하려면, 사내 이메일 도메인으로 바꿔주세요.
// 제한 없이 로그인한 모든 구글 계정을 허용하려면 이 값을 빈 문자열 ''로 두세요.
export const ALLOWED_EMAIL_DOMAIN = 'yourcompany.co.kr';

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
