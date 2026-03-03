// DB / JWT format (matches Prisma enum values exactly)
export const ROLES = {
  USER: 'user',
  ADMIN: 'admin',
  SUPER_ADMIN: 'super_admin',
} as const

export type RoleValue = typeof ROLES[keyof typeof ROLES]

export interface UserResponse {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
  emailConfirmed: boolean;
  subscription: string;
  nextPaymentDate: string | null;
  trialEndsDate: string | null;
  productId: string | null;
  weeklyStreak: { date: string }[];
  role: 'user' | 'admin' | 'super-admin';
  notification: boolean;
  createdAt: string;
}

export interface AuthResponse {
  token: string;
  user: UserResponse;
}

export interface ErrorResponse {
  error: string;
  statusCode: number;
}

export interface WeeklyStreakDay {
  day: string;
  date: string;
  visited: boolean;
}

export interface WeeklyStreakResponse {
  streak: WeeklyStreakDay[];
  totalVisits: number;
}

export interface JwtPayload {
  userId: string;
  email: string;
  role: string;
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: JwtPayload;
    user: JwtPayload;
  }
}
