import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { httpError } from '../utils/errors';
import { appendFeedbackToSheet } from '../services/sheets.service';

const feedbackSchema = z.object({
  feedback: z.string().max(300, 'Feedback must be 300 characters or less').optional(),
  rating: z.number().int().min(0).max(2).optional(),
  name: z.string().optional(),
});

const feedbackRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post('/', async (request, reply) => {
    const parsed = feedbackSchema.safeParse(request.body);

    if (!parsed.success) {
      httpError(parsed.error.errors[0].message, 400);
    }

    const { feedback, rating, name } = parsed.data;

    // Save to DB (primary) and Google Sheets (secondary) independently
    try {
      await fastify.prisma.feedback.create({ data: { name, rating, feedback } });
    } catch (error) {
      fastify.log.error(error, 'Failed to save feedback to DB');
      httpError('Failed to submit feedback', 500);
    }

    try {
      await appendFeedbackToSheet({ name, rating, feedback });
    } catch (error) {
      fastify.log.error(error, 'Failed to save feedback to Google Sheets');
      // Non-fatal — DB save already succeeded
    }

    return reply.send({
      success: true,
      message: 'Feedback submitted successfully',
    });
  });
};

export default feedbackRoutes;
