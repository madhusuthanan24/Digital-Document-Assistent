import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signOut,
  updateProfile,
  User,
} from 'firebase/auth';

import {
  doc,
  setDoc,
  serverTimestamp,
} from 'firebase/firestore';

import { auth, firestore } from '../../config/firebase';
import { UserProfile } from '../../types/auth';

const translateFirebaseError = (code: string): string => {
  switch (code) {
    case 'auth/invalid-email':
      return 'The email address is not valid.';

    case 'auth/user-disabled':
      return 'This account has been disabled. Please contact support.';

    case 'auth/user-not-found':
      return 'No account found with this email address.';

    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return 'Incorrect email or password. Please try again.';

    case 'auth/email-already-in-use':
      return 'An account with this email address already exists.';

    case 'auth/weak-password':
      return 'Password is too weak. Please use at least 6 characters.';

    case 'auth/too-many-requests':
      return 'Too many attempts. Please wait a moment and try again.';

    case 'auth/network-request-failed':
      return 'Network error. Please check your internet connection.';

    case 'auth/operation-not-allowed':
      return 'Email/password sign-in is not enabled.';

    default:
      return 'An unexpected error occurred. Please try again.';
  }
};

const handleFirebaseError = (error: any): Error => {
  console.log('Firebase error:', error);
  const code: string = error?.code ?? '';
  return new Error(translateFirebaseError(code));
};

const mapFirebaseUser = (firebaseUser: User): UserProfile => ({
  uid: firebaseUser.uid,
  email: firebaseUser.email ?? '',
  fullName: firebaseUser.displayName ?? '',
  displayName: firebaseUser.displayName ?? '',
  photoURL: firebaseUser.photoURL ?? undefined,
});

class AuthService {
  public subscribeAuthState(
    callback: (user: UserProfile | null) => void,
  ): () => void {
    return onAuthStateChanged(auth, (firebaseUser) => {
      if (firebaseUser) {
        callback(mapFirebaseUser(firebaseUser));
      } else {
        callback(null);
      }
    });
  }

  public async login(
    email: string,
    password: string,
  ): Promise<UserProfile> {
    try {
      const credential = await signInWithEmailAndPassword(
        auth,
        email.trim(),
        password,
      );

      return mapFirebaseUser(credential.user);
    } catch (error: any) {
      throw handleFirebaseError(error);
    }
  }

  public async register(
    fullName: string,
    email: string,
    password: string,
  ): Promise<UserProfile> {
    try {
      const credential = await createUserWithEmailAndPassword(
        auth,
        email.trim(),
        password,
      );

      const user = credential.user;

      await updateProfile(user, {
        displayName: fullName.trim(),
      });

      await setDoc(doc(firestore, 'users', user.uid), {
        uid: user.uid,
        fullName: fullName.trim(),
        email: email.trim().toLowerCase(),
        createdAt: serverTimestamp(),
      });

      return {
        uid: user.uid,
        email: user.email ?? email,
        fullName: fullName.trim(),
        displayName: fullName.trim(),
      };
    } catch (error: any) {
      throw handleFirebaseError(error);
    }
  }

  public async forgotPassword(email: string): Promise<void> {
    try {
      await sendPasswordResetEmail(auth, email.trim());
    } catch (error: any) {
      throw handleFirebaseError(error);
    }
  }

  public async logout(): Promise<void> {
    try {
      await signOut(auth);
    } catch (error: any) {
      throw handleFirebaseError(error);
    }
  }
}

export const authService = new AuthService();