import { Platform } from '@prisma/client';
import { getMessaging } from 'firebase-admin/messaging';
import { prisma }   from '../../config/db';
import { isFirebaseReady } from '../../config/firebase';

interface PushPayload {
  title: string;
  body:  string;
  data?: Record<string, string>;
}

// ── Register a device token for a user ──────────────────────────
export const registerDeviceToken = async (
  userId:   string,
  token:    string,
  platform?: Platform,
) => {
  return prisma.deviceToken.upsert({
    where:  { token },
    update: { userId, platform },
    create: { userId, token, platform },
  });
};

// ── Unregister a device token (e.g. on logout) ──────────────────
export const unregisterDeviceToken = async (token: string): Promise<void> => {
  await prisma.deviceToken.deleteMany({ where: { token } });
};

// ── Send a push notification to every device of a user ──────────
export const sendToUser = async (
  userId: string,
  payload: PushPayload,
): Promise<{ successCount: number; failureCount: number }> => {

  if (!isFirebaseReady()) {
    const err = new Error('Push notifications are not configured') as any;
    err.code       = 'FIREBASE_NOT_CONFIGURED';
    err.statusCode = 503;
    throw err;
  }

  const deviceTokens = await prisma.deviceToken.findMany({
    where:  { userId },
    select: { token: true },
  });

  if (deviceTokens.length === 0) {
    return { successCount: 0, failureCount: 0 };
  }

  const response = await getMessaging().sendEachForMulticast({
    tokens:       deviceTokens.map(d => d.token),
    notification: { title: payload.title, body: payload.body },
    data:         payload.data,
  });

  // ── Drop tokens FCM reports as no longer registered ───────────
  const staleTokens = response.responses
    .map((r: { success: boolean; error?: { code?: string } }, i: number) =>
      (!r.success && r.error?.code === 'messaging/registration-token-not-registered'
        ? deviceTokens[i].token
        : null))
    .filter((t: string | null): t is string => t !== null);

  if (staleTokens.length) {
    await prisma.deviceToken.deleteMany({ where: { token: { in: staleTokens } } });
  }

  return { successCount: response.successCount, failureCount: response.failureCount };
};
