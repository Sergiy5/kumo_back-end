import { User, WeeklyStreak } from '@prisma/client';
import { UserResponse, ROLES } from '../types';

export function formatUserResponse(
  user: User,
  weeklyStreaks: WeeklyStreak[] = []
): UserResponse {
  return {
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    emailConfirmed: user.emailConfirmed,
    role: user.role.replace('_', '-') as UserResponse['role'],
    subscription: user.role === ROLES.SUPER_ADMIN ? 'pro' : user.subscription.replace('_', '-'),
    nextPaymentDate: user.nextPaymentDate?.toISOString() ?? null,
    trialEndsDate: user.trialEndsDate?.toISOString() ?? null,
    productId: user.productId ?? null,
    weeklyStreak: weeklyStreaks.map((streak) => ({
      date: streak.date.toISOString(),
    })),
    notification: user.notification,
    createdAt: user.createdAt.toISOString(),
  };
}

export function generateVerificationToken(): string {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

export function truncateString(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.substring(0, maxLength).trim() + '...';
}
