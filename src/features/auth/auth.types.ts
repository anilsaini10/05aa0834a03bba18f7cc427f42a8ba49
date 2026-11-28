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
  customRoleId?: string;
}

export interface SendLoginOtpInput {
  phone:     string;
  role:      Role;
  schoolId?: string;
  customRoleId?: string;
}

export interface VerifyLoginOtpInput extends SendLoginOtpInput {
  otp: string;
}

export interface SendEmailLoginOtpInput {
  email:     string;
  role:      Role;
  schoolId?: string;
  customRoleId?: string;
}

export interface VerifyEmailLoginOtpInput extends SendEmailLoginOtpInput {
  otp: string;
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
  id:           string;
  name:         string;
  email:        string;
  username:     string | null;
  phone:        string | null;
  role:         Role;
  // Set when role is STAFF — the super-admin-defined role.
  customRole:   { id: string; key: string; name: string } | null;
  schoolId:     string | null;
  schoolName:   string | null;
  profilePhoto: string | null;
}
