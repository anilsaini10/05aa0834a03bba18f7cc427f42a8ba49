import { initializeApp, cert, getApps } from 'firebase-admin/app';
import path from 'path';
import fs   from 'fs';
import { env } from './env';

export const initFirebase = (): void => {
  if (getApps().length) return;

  if (!env.FIREBASE_SERVICE_ACCOUNT_PATH) {
    console.warn('⚠️  FIREBASE_SERVICE_ACCOUNT_PATH not set — push notifications disabled');
    return;
  }

  const keyPath = path.resolve(process.cwd(), env.FIREBASE_SERVICE_ACCOUNT_PATH);

  if (!fs.existsSync(keyPath)) {
    console.warn(`⚠️  Firebase service account key not found at ${keyPath} — push notifications disabled`);
    return;
  }

  const serviceAccount = JSON.parse(fs.readFileSync(keyPath, 'utf-8'));

  initializeApp({ credential: cert(serviceAccount) });

  console.log('✅ Firebase Admin initialized');
};

export const isFirebaseReady = (): boolean => getApps().length > 0;
