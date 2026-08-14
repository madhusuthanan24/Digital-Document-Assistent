import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaSyB6jh4IWki6iI1ZUZGkyC2sPXWujvkxpFM",
  authDomain: "digitaldocumentassistant.firebaseapp.com",
  projectId: "digitaldocumentassistant",
  storageBucket: "digitaldocumentassistant.firebasestorage.app",
  messagingSenderId: "328841148237",
  appId: "1:328841148237:web:115ae41cd7e0f6f44ce904",
  measurementId: "G-F0K5MSYQZP",
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const firestore = getFirestore(app);
export const storage = getStorage(app);

export default app;
