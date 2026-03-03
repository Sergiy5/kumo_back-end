import { FastifyPluginAsync } from 'fastify';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { httpError } from '../utils/errors';
import { formatUserResponse, generateVerificationToken } from '../utils/helpers';
import { sendVerificationEmail } from '../services/email.service';

const changeEmailSchema = z.object({
  newEmail: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z.string().min(6, 'New password must be at least 6 characters'),
});

const sendVerificationSchema = z.object({
  email: z.string().email('Invalid email address'),
});

const verifyEmailSchema = z.object({
  token: z.string().min(1, 'Token is required'),
});

const updateProfileSchema = z
  .object({
    firstName: z.string().min(1).max(50).optional(),
    lastName: z.string().min(1).max(50).optional(),
    notification: z.boolean().optional(),
  })
  .refine(
    (data) => data.firstName !== undefined || data.lastName !== undefined || data.notification !== undefined,
    { message: 'At least one field must be provided' }
  );

const pushTokenSchema = z.object({
  token: z.string().min(1, 'Push token is required'),
});

const deleteAccountSchema = z.object({
  password: z.string().min(1, 'Password is required'),
  confirmDelete: z.literal(true, {
    errorMap: () => ({ message: 'You must confirm account deletion' }),
  }),
});

const profileRoutes: FastifyPluginAsync = async (fastify) => {
  // All routes require authentication
  fastify.addHook('onRequest', fastify.authenticate);

  // GET /me - Get current user profile
  fastify.get('/me', async (request, reply) => {
    const userId = request.user.userId;

    let user = await fastify.prisma.user.findUnique({
      where: { id: userId },
      include: {
        weeklyStreaks: {
          orderBy: { date: 'desc' },
          take: 7,
        },
      },
    });

    if (!user) {
      httpError('User not found', 404);
    }

    // Auto-expire subscription if past nextPaymentDate (safety net for missed RC webhooks)
    if (user!.subscription === 'pro' && user!.nextPaymentDate && new Date(user!.nextPaymentDate) < new Date()) {
      user = await fastify.prisma.user.update({
        where: { id: userId },
        data: { subscription: 'cancelled' },
        include: { weeklyStreaks: { orderBy: { date: 'desc' }, take: 7 } },
      });
    }

    return reply.send({
      user: formatUserResponse(user!, user!.weeklyStreaks),
    });
  });

  // PATCH /me - Update profile (firstName, lastName, notification)
  fastify.patch('/me', async (request, reply) => {
    const parsed = updateProfileSchema.safeParse(request.body);
    if (!parsed.success) {
      httpError(parsed.error.errors[0].message, 400);
    }

    const userId = request.user.userId;
    const { firstName, lastName, notification } = parsed.data;

    const updateData: { firstName?: string; lastName?: string; notification?: boolean } = {};
    if (firstName !== undefined) updateData.firstName = firstName;
    if (lastName !== undefined) updateData.lastName = lastName;
    if (notification !== undefined) updateData.notification = notification;

    const user = await fastify.prisma.user.update({
      where: { id: userId },
      data: updateData,
      include: {
        weeklyStreaks: {
          orderBy: { date: 'desc' },
          take: 7,
        },
      },
    });

    return reply.send({
      success: true,
      message: 'Profile updated successfully',
      user: formatUserResponse(user, user.weeklyStreaks),
    });
  });

  // POST /push-token - Store Expo push token
  fastify.post('/push-token', async (request, reply) => {
    const parsed = pushTokenSchema.safeParse(request.body);
    if (!parsed.success) {
      httpError(parsed.error.errors[0].message, 400);
    }

    const { token } = parsed.data;
    const userId = request.user.userId;

    await fastify.prisma.user.update({
      where: { id: userId },
      data: { pushToken: token },
    });

    return reply.send({ success: true });
  });

  // DELETE /me - Delete user account
  fastify.delete('/me', async (request, reply) => {
    const parsed = deleteAccountSchema.safeParse(request.body);
    if (!parsed.success) {
      httpError(parsed.error.errors[0].message, 400);
    }

    const { password } = parsed.data;
    const userId = request.user.userId;

    const user = await fastify.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      httpError('User not found', 404);
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      httpError('Invalid password', 400);
    }

    // Delete user (cascades to related records)
    await fastify.prisma.user.delete({
      where: { id: userId },
    });

    return reply.send({
      success: true,
      message: 'Account deleted successfully',
    });
  });

  // POST /change-email
  fastify.post('/change-email', async (request, reply) => {
    const parsed = changeEmailSchema.safeParse(request.body);
    if (!parsed.success) {
      httpError(parsed.error.errors[0].message, 400);
    }

    const { newEmail, password } = parsed.data;
    const userId = request.user.userId;

    // Get current user
    const user = await fastify.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      httpError('User not found', 404);
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      httpError('Invalid password', 400);
    }

    // Check if new email is already taken
    const existingUser = await fastify.prisma.user.findUnique({
      where: { email: newEmail },
    });

    if (existingUser && existingUser.id !== userId) {
      httpError('Email already in use', 400);
    }

    // Update email and reset emailConfirmed
    await fastify.prisma.user.update({
      where: { id: userId },
      data: {
        email: newEmail,
        emailConfirmed: false,
      },
    });

    return reply.send({
      success: true,
      message: 'Email updated successfully',
    });
  });

  // POST /change-password
  fastify.post('/change-password', async (request, reply) => {
    const parsed = changePasswordSchema.safeParse(request.body);
    if (!parsed.success) {
      httpError(parsed.error.errors[0].message, 400);
    }

    const { currentPassword, newPassword } = parsed.data;
    const userId = request.user.userId;

    // Get current user
    const user = await fastify.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      httpError('User not found', 404);
    }

    // Verify current password
    const isValidPassword = await bcrypt.compare(currentPassword, user.password);
    if (!isValidPassword) {
      httpError('Current password is incorrect', 400);
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update password
    await fastify.prisma.user.update({
      where: { id: userId },
      data: { password: hashedPassword },
    });

    return reply.send({
      success: true,
      message: 'Password updated successfully',
    });
  });

  // POST /send-verification
  fastify.post('/send-verification', async (request, reply) => {
    const parsed = sendVerificationSchema.safeParse(request.body);
    if (!parsed.success) {
      httpError(parsed.error.errors[0].message, 400);
    }

    const { email } = parsed.data;
    const userId = request.user.userId;

    // Verify user owns this email
    const user = await fastify.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user || user.email !== email) {
      httpError('Email does not match your account', 400);
    }

    if (user.emailConfirmed) {
      httpError('Email is already verified', 400);
    }

    // Delete any existing tokens for this user
    await fastify.prisma.verificationToken.deleteMany({
      where: { userId },
    });

    // Generate new token
    const token = generateVerificationToken();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    await fastify.prisma.verificationToken.create({
      data: {
        userId,
        token,
        expiresAt,
      },
    });

    // Send verification email
    await sendVerificationEmail(email, token);

    return reply.send({
      success: true,
      message: 'Verification email sent',
    });
  });

  // POST /verify-email
  fastify.post('/verify-email', async (request, reply) => {
    const parsed = verifyEmailSchema.safeParse(request.body);
    if (!parsed.success) {
      httpError(parsed.error.errors[0].message, 400);
    }

    const { token } = parsed.data;

    // Find token
    const verificationToken = await fastify.prisma.verificationToken.findUnique({
      where: { token },
      include: { user: true },
    });

    if (!verificationToken) {
      httpError('Invalid verification token', 400);
    }

    if (verificationToken.expiresAt < new Date()) {
      // Delete expired token
      await fastify.prisma.verificationToken.delete({
        where: { id: verificationToken.id },
      });
      httpError('Verification token has expired', 400);
    }

    // Update user's emailConfirmed status
    await fastify.prisma.user.update({
      where: { id: verificationToken.userId },
      data: { emailConfirmed: true },
    });

    // Delete the used token
    await fastify.prisma.verificationToken.delete({
      where: { id: verificationToken.id },
    });

    return reply.send({
      success: true,
      message: 'Email verified successfully',
    });
  });
};

export default profileRoutes;
