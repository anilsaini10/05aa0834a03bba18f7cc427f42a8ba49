import bcrypt from 'bcryptjs';
import { env } from '../../config/env';

const ROUNDS = parseInt(env.BCRYPT_ROUNDS, 10);

export const hashPassword = async (plain: string): Promise<string> =>
  bcrypt.hash(plain, ROUNDS);

export const comparePassword = async (
  plain:  string,
  hashed: string,
): Promise<boolean> =>
  bcrypt.compare(plain, hashed);
