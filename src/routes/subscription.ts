import { FastifyPluginAsync } from "fastify";
import { httpError } from "../utils/errors";
import { formatUserResponse } from "../utils/helpers";
import { env } from "../config/env";

const RC_API_BASE = "https://api.revenuecat.com/v1";

interface RcSubscriberResponse {
  subscriber: {
    entitlements: {
      pro?: {
        expires_date: string | null;
        is_active: boolean;
        product_identifier: string;
      };
    };
  };
}

interface RcWebhookBody {
  event: {
    type: string;
    app_user_id: string;
    product_id: string;
    expiration_at_ms?: number;
  };
}

async function getRevenueCatSubscriber(
  userId: string,
  apiKey: string
): Promise<RcSubscriberResponse> {
  const response = await fetch(
    `${RC_API_BASE}/subscribers/${encodeURIComponent(userId)}`,
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
    }
  );

  if (!response.ok) {
    throw new Error(`RevenueCat API error: ${response.status}`);
  }

  return response.json() as Promise<RcSubscriberResponse>;
}

const subscriptionRoutes: FastifyPluginAsync = async (fastify) => {
  // --- Authenticated routes (JWT required) ---
  fastify.register(async (scope) => {
    scope.addHook("onRequest", fastify.authenticate);

    // POST /subscription/verify
    scope.post("/verify", async (request, reply) => {
      const userId = request.user.userId;

      if (!env.REVENUECAT_SECRET_API_KEY) {
        httpError("RevenueCat not configured", 500);
      }

      const rcData = await getRevenueCatSubscriber(
        userId,
        env.REVENUECAT_SECRET_API_KEY!
      );
      const entitlement = rcData.subscriber.entitlements.pro;

      if (!entitlement?.is_active) {
        const user = await fastify.prisma.user.findUnique({
          where: { id: userId },
          include: { weeklyStreaks: { orderBy: { date: "desc" }, take: 7 } },
        });
        if (!user) httpError("User not found", 404);
        return reply.send({
          success: false,
          message: "No active subscription found",
          user: formatUserResponse(user!, user!.weeklyStreaks),
        });
      }

      const nextPaymentDate = entitlement.expires_date
        ? new Date(entitlement.expires_date)
        : null;

      const user = await fastify.prisma.user.update({
        where: { id: userId },
        data: {
          subscription: "pro",
          nextPaymentDate,
          productId: entitlement.product_identifier,
        },
        include: { weeklyStreaks: { orderBy: { date: "desc" }, take: 7 } },
      });

      return reply.send({
        success: true,
        message: "Subscription activated successfully",
        user: formatUserResponse(user, user.weeklyStreaks),
      });
    });

    // POST /subscription/restore
    scope.post("/restore", async (request, reply) => {
      const userId = request.user.userId;

      if (!env.REVENUECAT_SECRET_API_KEY) {
        httpError("RevenueCat not configured", 500);
      }

      const rcData = await getRevenueCatSubscriber(
        userId,
        env.REVENUECAT_SECRET_API_KEY!
      );
      const entitlement = rcData.subscriber.entitlements.pro;

      if (!entitlement?.is_active) {
        const user = await fastify.prisma.user.update({
          where: { id: userId },
          data: { subscription: "cancelled", nextPaymentDate: null },
          include: { weeklyStreaks: { orderBy: { date: "desc" }, take: 7 } },
        });
        return reply.send({
          success: true,
          message: "No active subscription found",
          user: formatUserResponse(user, user.weeklyStreaks),
        });
      }

      const nextPaymentDate = entitlement.expires_date
        ? new Date(entitlement.expires_date)
        : null;

      const user = await fastify.prisma.user.update({
        where: { id: userId },
        data: {
          subscription: "pro",
          nextPaymentDate,
          productId: entitlement.product_identifier,
        },
        include: { weeklyStreaks: { orderBy: { date: "desc" }, take: 7 } },
      });

      return reply.send({
        success: true,
        message: "Subscription restored successfully",
        user: formatUserResponse(user, user.weeklyStreaks),
      });
    });
  });

  // --- Webhook — no JWT auth, secured via Authorization header ---
  fastify.post("/rc-webhook", async (request, reply) => {
    // Always return 200 to prevent RevenueCat retries
    try {
      const authHeader = request.headers.authorization;
      if (
        !env.REVENUECAT_WEBHOOK_SECRET ||
        authHeader !== `Bearer ${env.REVENUECAT_WEBHOOK_SECRET}`
      ) {
        fastify.log.warn("RC webhook: invalid authorization header");
        return reply.status(200).send({ received: true });
      }

      const body = request.body as RcWebhookBody;
      const { type, app_user_id, product_id, expiration_at_ms } = body.event;

      const user = await fastify.prisma.user.findUnique({
        where: { id: app_user_id },
      });
      if (!user) {
        fastify.log.warn({ app_user_id }, "RC webhook: user not found");
        return reply.status(200).send({ received: true });
      }

      switch (type) {
        case "INITIAL_PURCHASE":
        case "RENEWAL": {
          const nextPaymentDate = expiration_at_ms
            ? new Date(expiration_at_ms)
            : null;
          await fastify.prisma.user.update({
            where: { id: user.id },
            data: { subscription: "pro", nextPaymentDate, productId: product_id },
          });
          break;
        }
        case "EXPIRATION":
        case "BILLING_ISSUE": {
          await fastify.prisma.user.update({
            where: { id: user.id },
            data: { subscription: "cancelled", nextPaymentDate: null },
          });
          break;
        }
        case "CANCELLATION":
        case "UNCANCELLATION":
          // No immediate change — access continues until nextPaymentDate
          break;
        default:
          fastify.log.info({ type }, "RC webhook: unhandled event type");
      }
    } catch (err) {
      fastify.log.error({ err }, "RC webhook handler error");
    }

    return reply.status(200).send({ received: true });
  });
};

export default subscriptionRoutes;
