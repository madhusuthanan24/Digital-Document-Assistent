export interface UserProfile {
  uid: string;
  email: string;
  fullName: string;
  displayName?: string;
  photoURL?: string;
  createdAt?: string;
}

export interface AuthState {
  user: UserProfile | null;
  isLoading: boolean;
  error: string | null;
}
