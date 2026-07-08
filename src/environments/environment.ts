export interface Environment {
  production: boolean;
  apiUrl: string;
  googleClientId: string;
}

export const environment: Environment = {
  production: false,
  apiUrl: 'http://localhost:3000/api/v1',
  googleClientId: '',
};
