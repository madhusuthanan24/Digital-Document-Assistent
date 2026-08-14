/**
 * Firebase Service Exports
 *
 * google-services.json is located at android/app/google-services.json.
 * The Google Services Gradle plugin processes it at build time — no
 * manual credential configuration is required in JavaScript.
 *
 * Required Firebase Console setup:
 *   1. Authentication → Sign-in method → Enable Email/Password
 *   2. Firestore Database → Create database (production mode)
 *   3. Apply the Firestore security rules from the project README
 */

import firebaseApp from '@react-native-firebase/app';
import auth from '@react-native-firebase/auth';
import firestore from '@react-native-firebase/firestore';
import storage from '@react-native-firebase/storage';

export { firebaseApp, auth, firestore, storage };
