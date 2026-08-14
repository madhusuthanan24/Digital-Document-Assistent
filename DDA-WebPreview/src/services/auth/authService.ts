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

// ---------------------------------------------------------------------------
// Firebase error code → human-readable message translation
// ---------------------------------------------------------------------------
const translateFirebaseError = (code: string): string => {
  switch (code) {
    // Auth errors
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
      return 'Email/password sign-in is not enabled. Please contact support.';
    case 'auth/requires-recent-login':
      return 'Please sign in again to complete this action.';
    default:
      return 'An unexpected error occurred. Please try again.';
  }
};

const handleFirebaseError = (error: any): Error => {
  const code: string = error?.code ?? '';
  const message = translateFirebaseError(code);
  return new Error(message);
};

// ---------------------------------------------------------------------------
// Map a Firebase Auth user to our app's UserProfile type
// ---------------------------------------------------------------------------
const mapFirebaseUser = (firebaseUser: User): UserProfile => ({
  uid: firebaseUser.uid,
  email: firebaseUser.email ?? '',
  fullName: firebaseUser.displayName ?? '',
  displayName: firebaseUser.displayName ?? '',
  photoURL: firebaseUser.photoURL ?? undefined,
});

// ---------------------------------------------------------------------------
// Auth Service
// ---------------------------------------------------------------------------
class AuthService {
  /**
   * Subscribe to Firebase Auth state changes.
   * Returns an unsubscribe function. Fires immediately with the current user.
   */
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

  /**
   * Sign in with email and password.
   * Throws a user-friendly Error on failure.
   */
  public async login(email: string, password: string): Promise<UserProfile> {
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

  /**
   * Create a new Firebase Auth account, update the display name, and
   * write the user profile document to Firestore at users/{uid}.
   * NEVER stores the password anywhere.
   */
  public async register(
    fullName: string,
    email: string,
    password: string,
  ): Promise<UserProfile> {
    try {
      // 1. Create Firebase Auth account
      const credential = await createUserWithEmailAndPassword(
        auth,
        email.trim(),
        password,
      );
      const { user } = credential;

      // 2. Set display name on the Auth profile
      await updateProfile(user, { displayName: fullName.trim() });

      // 3. Write user document to Firestore — passwords are NEVER stored
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

  /**
   * Send a password reset email to the given address.
   * Throws a user-friendly Error on failure.
   */
  public async forgotPassword(email: string): Promise<void> {
    try {
      await sendPasswordResetEmail(auth, email.trim());
    } catch (error: any) {
      throw handleFirebaseError(error);
    }
  }

  /**
   * Sign the current user out of Firebase.
   */
  public async logout(): Promise<void> {
    try {
      await signOut(auth);
    } catch (error: any) {
      throw handleFirebaseError(error);
    }
  }
}

export const authService = new AuthService();
