import { UserProfile } from '../../types/auth';

class AuthService {
  subscribeAuthState(
    callback: (user: UserProfile | null) => void,
  ): () => void {
    callback(null);
    return () => {};
  }

  async login(email: string, password: string): Promise<void> {
    console.log('Mock login:', email);
  }

  async register(
    fullName: string,
    email: string,
    password: string,
  ): Promise<void> {
    console.log('Mock register:', fullName, email);
  }

  async forgotPassword(email: string): Promise<void> {
    console.log('Mock forgot password:', email);
  }

  async logout(): Promise<void> {
    console.log('Mock logout');
  }
}

export const authService = new AuthService();
