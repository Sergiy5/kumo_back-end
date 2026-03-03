import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { httpError } from '../utils/errors';
import { broadcastNotification, notifyUser } from '../services/push.service';

const updateSubscriptionSchema = z.object({
  subscription: z.enum(['pro', 'free', 'cancelled']),
});

const sendNotificationSchema = z.object({
  title: z.string().max(100).optional(),
  body: z.string().min(1).max(500),
  userId: z.string().uuid().optional(),
});

const adminRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('onRequest', fastify.requireAdmin);

  // GET /admin/users
  fastify.get('/users', async (_request, reply) => {
    const users = await fastify.prisma.user.findMany({
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        subscription: true,
        role: true,
        notification: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return reply.send({
      users: users.map((u) => ({
        ...u,
        role: u.role.replace('_', '-'),
        subscription: u.subscription.replace('_', '-'),
        createdAt: u.createdAt.toISOString(),
      })),
    });
  });

  // PATCH /admin/users/:id/subscription
  fastify.patch('/users/:id/subscription', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = updateSubscriptionSchema.safeParse(request.body);
    if (!parsed.success) {
      httpError(parsed.error.errors[0].message, 400);
    }

    const user = await fastify.prisma.user.findUnique({ where: { id } });
    if (!user) httpError('User not found', 404);

    const updated = await fastify.prisma.user.update({
      where: { id },
      data: { subscription: parsed.data.subscription },
    });

    return reply.send({
      success: true,
      message: 'Subscription updated',
      subscription: updated.subscription,
    });
  });

  // POST /admin/notifications
  fastify.post('/notifications', async (request, reply) => {
    const parsed = sendNotificationSchema.safeParse(request.body);
    if (!parsed.success) {
      httpError(parsed.error.errors[0].message, 400);
    }

    const { title, body, userId } = parsed.data;

    if (userId) {
      const user = await fastify.prisma.user.findUnique({ where: { id: userId } });
      if (!user) httpError('User not found', 404);
      await notifyUser(fastify.prisma, userId, title, body);
    } else {
      await broadcastNotification(fastify.prisma, title, body);
    }

    return reply.send({ success: true, message: userId ? 'Notification sent to user' : 'Notification broadcast to all users' });
  });

  // GET /admin/feedback
  fastify.get('/feedback', async (_request, reply) => {
    const feedbacks = await fastify.prisma.feedback.findMany({
      orderBy: { createdAt: 'desc' },
    });

    return reply.send({
      feedbacks: feedbacks.map((f) => ({
        ...f,
        createdAt: f.createdAt.toISOString(),
      })),
    });
  });
};

export default adminRoutes;
