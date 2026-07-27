import { Platform, AnnouncementAudience, Role } from '@prisma/client';
import { getMessaging } from 'firebase-admin/messaging';
import { prisma }   from '../../config/db';
import { isFirebaseReady } from '../../config/firebase';

export interface PushPayload {
  title: string;
  body:  string;
  data?: Record<string, string>;
}

// FCM's per-call multicast limit — batch larger audiences into chunks.
const FCM_BATCH_SIZE = 500;

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

// ── Broadcast a push notification to every device of every user in an
//    audience (ALL/TEACHER/PARENT), scoped to one school ─────────────
// Fire-and-forget from callers: never throws — a Firebase/network hiccup
// must never fail the feature (announcement/homework/etc.) that triggered it.
export const notifyAudience = async (
  schoolId: string,
  audience: AnnouncementAudience,
  payload:  PushPayload,
): Promise<void> => {
  try {
    if (!isFirebaseReady()) return;

    const roles: Role[] = audience === 'ALL' ? ['ADMIN', 'TEACHER', 'PARENT'] : [audience];

    const deviceTokens = await prisma.deviceToken.findMany({
      where:  { user: { schoolId, role: { in: roles } } },
      select: { token: true },
    });
    if (deviceTokens.length === 0) return;

    const tokens = deviceTokens.map(d => d.token);
    const staleTokens: string[] = [];

    for (let i = 0; i < tokens.length; i += FCM_BATCH_SIZE) {
      const batch = tokens.slice(i, i + FCM_BATCH_SIZE);
      const response = await getMessaging().sendEachForMulticast({
        tokens:       batch,
        notification: { title: payload.title, body: payload.body },
        data:         payload.data,
      });
      response.responses.forEach((r: { success: boolean; error?: { code?: string } }, idx: number) => {
        if (!r.success && r.error?.code === 'messaging/registration-token-not-registered') {
          staleTokens.push(batch[idx]);
        }
      });
    }

    if (staleTokens.length) {
      await prisma.deviceToken.deleteMany({ where: { token: { in: staleTokens } } });
    }
  } catch (err) {
    console.error('notifyAudience failed:', err);
  }
};

// ── Push a notification to one specific user ────────────────────
// Fire-and-forget wrapper around sendToUser for internal callers (leave
// review, etc.) — a Firebase/network hiccup must never fail the feature
// that triggered it. Use sendToUser directly when the caller (e.g. the
// admin-facing /notifications/send endpoint) needs the error surfaced.
export const notifyUser = async (
  userId:  string,
  payload: PushPayload,
): Promise<void> => {
  try {
    await sendToUser(userId, payload);
  } catch (err) {
    console.error('notifyUser failed:', err);
  }
};
