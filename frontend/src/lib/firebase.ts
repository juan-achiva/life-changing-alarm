import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FirebaseAuth from "@firebase/auth";
import { getApp, getApps, initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
};

export const isFirebaseConfigured = Object.values(firebaseConfig).every(Boolean);

const app = isFirebaseConfigured
  ? getApps().length > 0
    ? getApp()
    : initializeApp(firebaseConfig)
  : null;

export const auth = app ? createPersistentAuth() : null;

export const db = app ? getFirestore(app) : null;

function createPersistentAuth() {
  const getReactNativePersistence = (FirebaseAuth as typeof FirebaseAuth & { getReactNativePersistence: (storage: typeof AsyncStorage) => FirebaseAuth.Persistence }).getReactNativePersistence;
  try {
    if (typeof getReactNativePersistence !== "function") return FirebaseAuth.getAuth(app!);
    return FirebaseAuth.initializeAuth(app!, { persistence: getReactNativePersistence(AsyncStorage) });
  } catch (error) {
    if ((error as { code?: string }).code === "auth/already-initialized") return FirebaseAuth.getAuth(app!);
    // A persistence adapter failure must not crash the native app at launch.
    // Auth still works for the current session with Firebase's default setup.
    console.warn("Persistent Firebase Auth unavailable; using default Auth.", error);
    return FirebaseAuth.getAuth(app!);
  }
}
