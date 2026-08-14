import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  ReactNode,
} from 'react';
import { UserProfile } from '../types/auth';
import { authService } from '../services/auth/authService';

// ---------------------------------------------------------------------------
// Context shape
// ---------------------------------------------------------------------------
interface AuthContextValue {
  /** Currently signed-in user, or null if unauthenticated. */
  user: UserProfile | null;
  /**
   * True while Firebase is resolving the initial auth state.
   * Prevents a brief flash of the Login screen on cold start.
   */
  isInitializing: boolean;
  /** Signs in with email/password. Throws on failure. */
  login: (email: string, password: string) => Promise<void>;
  /** Creates an account, updates the Auth profile, writes Firestore doc. Throws on failure. */
  register: (fullName: string, email: string, password: string) => Promise<void>;
  /** Sends a password reset email. Throws on failure. */
  forgotPassword: (email: string) => Promise<void>;
  /** Signs out the current user. */
  logout: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Context creation
// ---------------------------------------------------------------------------
const AuthContext = createContext<AuthContextValue | undefined>(undefined);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------
interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);

  // Subscribe once on mount — Firebase fires immediately with current state
  useEffect(() => {
    const unsubscribe = authService.subscribeAuthState((currentUser) => {
      setUser(currentUser);
      setIsInitializing(false);
    });
    return () => unsubscribe();
  }, []);

  const login = async (email: string, password: string): Promise<void> => {
    await authService.login(email, password);
    // Auth state listener automatically updates `user` via subscribeAuthState
  };

  const register = async (
    fullName: string,
    email: string,
    password: string,
  ): Promise<void> => {
    await authService.register(fullName, email, password);
  };

  const forgotPassword = async (email: string): Promise<void> => {
    await authService.forgotPassword(email);
  };

  const logout = async (): Promise<void> => {
    await authService.logout();
  };

  const value: AuthContextValue = {
    user,
    isInitializing,
    login,
    register,
    forgotPassword,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------
export const useAuth = (): AuthContextValue => {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an <AuthProvider>');
  }
  return ctx;
};
