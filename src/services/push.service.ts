import { PrismaClient } from '@prisma/client';
import { env } from '../config/env';

async function sendPushNotification(
  pushToken: string,
  title: string | undefined,
  body: string,
  data?: Record<string, unknown>
): Promise<void> {
  const message = { to: pushToken, title, body, data, sound: 'default' };
  await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(env.EXPO_ACCESS_TOKEN
        ? { Authorization: `Bearer ${env.EXPO_ACCESS_TOKEN}` }
        : {}),
    },
    body: JSON.stringify(message),
  });
}

export async function notifyUser(
  prisma: PrismaClient,
  userId: string,
  title: string | undefined,
  body: string,
  data?: Record<string, unknown>
): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { pushToken: true, notification: true },
  });
  if (!user?.pushToken || !user.notification) return;
  await sendPushNotification(user.pushToken, title, body, data);
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

export async function broadcastNotification(
  prisma: PrismaClient,
  title: string | undefined,
  body: string,
  data?: Record<string, unknown>
): Promise<void> {
  const users = await prisma.user.findMany({
    where: { notification: true, pushToken: { not: null } },
    select: { pushToken: true },
  });
  const chunks = chunkArray(users, 100);
  for (const chunk of chunks) {
    const messages = chunk.map((u) => ({
      to: u.pushToken!,
      title,
      body,
      data,
      sound: 'default',
    }));
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(messages),
    });
  }
}
