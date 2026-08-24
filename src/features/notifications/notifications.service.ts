import { Platform, AnnouncementAudience, Role, Prisma } from '@prisma/client';
import { getMessaging } from 'firebase-admin/messaging';
import { prisma }   from '../../config/db';
import { isFirebaseReady } from '../../config/firebase';
import { ListNotificationsQuerySchema } from './notifications.validation';

export interface PushPayload {
  title: string;
  body:  string;
  data?: Record<string, string>;
}

export interface NotificationResponse {
  id:        string;
  title:     string;
  body:      string;
  type:      string;
  data:      Record<string, unknown>;
  isRead:    boolean;
  readAt:    Date | null;
  createdAt: Date;
}

// FCM's per-call multicast limit — batch larger audiences into chunks.
const FCM_BATCH_SIZE = 500;

const notFound = (message: string, code: string) => {
  const err = new Error(message) as any;
  err.code       = code;
  err.statusCode = 404;
  return err;
};

const toNotificationResponse = (n: {
  id: string; title: string; body: string; type: string; data: Prisma.JsonValue;
  isRead: boolean; readAt: Date | null; createdAt: Date;
}): NotificationResponse => ({
  id:        n.id,
  title:     n.title,
  body:      n.body,
  type:      n.type,
  data:      (n.data as Record<string, unknown>) ?? {},
  isRead:    n.isRead,
  readAt:    n.readAt,
  createdAt: n.createdAt,
});

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

// ── Insert one Notification row per recipient — always happens
//    regardless of Firebase/push state, since the in-app inbox must work
//    even for a user with no device registered. Single batched insert,
//    not one round-trip per recipient. `type` comes from payload.data.type
//    if the caller set one (every existing caller already does), so no
//    call site needs to change when this was added.
const persistNotifications = async (userIds: string[], payload: PushPayload): Promise<void> => {
  if (userIds.length === 0) return;
  const type = payload.data?.type ?? 'GENERAL';
  await prisma.notification.createMany({
    data: userIds.map(userId => ({
      userId,
      title: payload.title,
      body:  payload.body,
      type,
      data:  payload.data ?? {},
    })),
  });
};

// ── Broadcast to every user in an audience (ALL/TEACHER/PARENT), scoped
//    to one school — persists an in-app Notification for every matching
//    user (active users only), then best-effort pushes to their devices.
// Fire-and-forget-safe from callers: never throws — a DB/Firebase hiccup
// must never fail the feature (announcement/event/leave/etc.) that
// triggered it.
export const notifyAudience = async (
  schoolId: string,
  audience: AnnouncementAudience,
  payload:  PushPayload,
): Promise<void> => {
  try {
    const roles: Role[] = audience === 'ALL' ? ['ADMIN', 'TEACHER', 'PARENT'] : [audience];

    const users = await prisma.user.findMany({
      where:  { schoolId, role: { in: roles }, isActive: true },
      select: { id: true },
    });
    if (users.length === 0) return;

    const userIds = users.map(u => u.id);
    await persistNotifications(userIds, payload);

    if (!isFirebaseReady()) return;

    const deviceTokens = await prisma.deviceToken.findMany({
      where:  { userId: { in: userIds } },
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

// ── Notify one specific user — persists an in-app Notification, then
//    best-effort pushes to their devices. Fire-and-forget-safe from
//    callers (leave review, etc.): never throws. Use sendToUser directly
//    when the caller (e.g. the admin-facing /notifications/send endpoint)
//    needs the push error surfaced instead of swallowed.
export const notifyUser = async (
  userId:  string,
  payload: PushPayload,
): Promise<void> => {
  try {
    await persistNotifications([userId], payload);
    await sendToUser(userId, payload);
  } catch (err) {
    console.error('notifyUser failed:', err);
  }
};

// ════════════════════════════════════════════════════════════
// In-app notification inbox — every role reads/manages only their own.
// ════════════════════════════════════════════════════════════

// ── GET /notifications — the logged-in user's own, paginated ─────
export const listMyNotifications = async (userId: string, query: ListNotificationsQuerySchema) => {
  const { page, pageSize, isRead, type } = query;

  const where: Prisma.NotificationWhereInput = {
    userId,
    ...(isRead !== undefined ? { isRead } : {}),
    ...(type ? { type } : {}),
  };

  const [items, total, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip:    (page - 1) * pageSize,
      take:    pageSize,
    }),
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { userId, isRead: false } }),
  ]);

  return {
    items: items.map(toNotificationResponse),
    page,
    pageSize,
    total,
    totalPages:  Math.max(1, Math.ceil(total / pageSize)),
    unreadCount,
  };
};

// ── GET /notifications/unread-count — cheap, indexed count for a badge ──
export const getUnreadCount = async (userId: string): Promise<number> =>
  prisma.notification.count({ where: { userId, isRead: false } });

// ── PATCH /notifications/:id/read ────────────────────────────────
export const markNotificationRead = async (userId: string, id: string): Promise<NotificationResponse> => {
  const notification = await prisma.notification.findFirst({ where: { id, userId } });
  if (!notification) throw notFound('Notification not found', 'NOTIFICATION_NOT_FOUND');

  if (notification.isRead) return toNotificationResponse(notification);

  const updated = await prisma.notification.update({
    where: { id },
    data:  { isRead: true, readAt: new Date() },
  });
  return toNotificationResponse(updated);
};

// ── PATCH /notifications/read-all — single bulk update, not per-row ────
export const markAllNotificationsRead = async (userId: string): Promise<{ updated: number }> => {
  const result = await prisma.notification.updateMany({
    where: { userId, isRead: false },
    data:  { isRead: true, readAt: new Date() },
  });
  return { updated: result.count };
};
