import crypto from 'crypto';

// 6-digit numeric OTP, cryptographically random (not Math.random).
export const generateOtp = (): string =>
  crypto.randomInt(100_000, 1_000_000).toString();
