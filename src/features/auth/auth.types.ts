import { Role } from '@prisma/client';

export interface SignupInput {
  schoolName: string;
  name:       string;
  email:      string;
  password:   string;
  phone:      string;
}

export interface LoginInput {
  identifier: string;
  password:   string;
  role:       Role;
  schoolId?:  string;
}

export interface RefreshInput {
  refreshToken: string;
}

export interface LogoutInput {
  refreshToken: string;
}

export interface AuthTokens {
  accessToken:  string;
  refreshToken: string;
  expiresAt:    string;
}

export interface UserPublic {
  id:         string;
  name:       string;
  email:      string;
  phone:      string | null;
  role:       Role;
  schoolId:   string;
  schoolName: string;
}
