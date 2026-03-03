import { FastifyPluginAsync } from "fastify";
import bcrypt from "bcrypt";
import crypto from "crypto";
import { z } from "zod";
import { httpError } from "../utils/errors";
import { formatUserResponse } from "../utils/helpers";
import { verifyGoogleIdToken } from "../services/google-auth.service";

const registerSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});

const googleAuthSchema = z.object({
  idToken: z.string().min(1, "ID token is required"),
  platform: z.enum(["android", "ios", "web"], {
    errorMap: () => ({
      message: "Platform must be 'android', 'ios', or 'web'",
    }),
  }),
  firstName: z.string().nullable().optional(),
  lastName: z.string().nullable().optional(),
});

const authRoutes: FastifyPluginAsync = async (fastify) => {
  // POST /auth/register
  fastify.post("/register", { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (request, reply) => {
    const parsed = registerSchema.safeParse(request.body);

    if (!parsed.success) {
      httpError(parsed.error.errors[0].message, 400);
    }
    
    const { email, password } = parsed.data;
    
    // Check if user already exists
    const existingUser = await fastify.prisma.user.findUnique({
      where: { email },
    });
    
    if (existingUser) {
      httpError("Email already registered", 400);
    }
    
    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Create user
    const user = await fastify.prisma.user.create({
      data: {
        email,
        password: hashedPassword,
      },
    });

    // Generate JWT
    const token = fastify.jwt.sign({
      userId: user.id,
      email: user.email,
      role: user.role,
    });

    return reply.status(201).send({
      token,
      user: formatUserResponse(user, []),
    });
  });

  // POST /auth/login
  fastify.post("/login", { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      httpError(parsed.error.errors[0].message, 400);
    }

    const { email, password } = parsed.data;

    // Find user
    const user = await fastify.prisma.user.findUnique({
      where: { email },
      include: {
        weeklyStreaks: {
          orderBy: { date: "desc" },
          take: 7,
        },
      },
    });

    if (!user) {
      httpError("Invalid email", 401);
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      httpError("Invalid password", 401);
    }

    // Generate JWT
    const token = fastify.jwt.sign({
      userId: user.id,
      email: user.email,
      role: user.role,
    });

    return reply.send({
      token,
      user: formatUserResponse(user, user.weeklyStreaks),
    });
  });

  // POST /auth/logout
  fastify.post("/logout", async (_request, reply) => {
    // JWT is stateless - client should delete token
    // This endpoint confirms logout and can be extended for token blacklisting
    return reply.send({
      success: true,
      message: "Logged out successfully",
    });
  });

  // POST /auth/google
  fastify.post("/google", { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    const parsed = googleAuthSchema.safeParse(request.body);
    if (!parsed.success) {
      httpError(parsed.error.errors[0].message, 400);
    }

    const {
      idToken,
      firstName: clientFirstName,
      lastName: clientLastName,
    } = parsed.data;

    // Verify the Google ID token
    const googleUser = await verifyGoogleIdToken(idToken);

    // Prefer token claims; fall back to client-provided values from the Google SDK
    const resolvedFirstName = googleUser.firstName || clientFirstName || null;
    const resolvedLastName = googleUser.lastName || clientLastName || null;

    // Find existing user by email
    let user = await fastify.prisma.user.findUnique({
      where: { email: googleUser.email },
      include: {
        weeklyStreaks: {
          orderBy: { date: "desc" },
          take: 7,
        },
      },
    });

    if (user) {
      // Existing user - update name if missing, confirm email
      if (!user.firstName || !user.lastName || !user.emailConfirmed) {
        user = await fastify.prisma.user.update({
          where: { id: user.id },
          data: {
            firstName: user.firstName || resolvedFirstName,
            lastName: user.lastName || resolvedLastName,
            emailConfirmed: true,
          },
          include: {
            weeklyStreaks: {
              orderBy: { date: "desc" },
              take: 7,
            },
          },
        });
      }
    } else {
      // New user - create account with random password (Google users don't need it)
      const randomPassword = crypto.randomBytes(32).toString("hex");
      const hashedPassword = await bcrypt.hash(randomPassword, 10);

      user = await fastify.prisma.user.create({
        data: {
          email: googleUser.email,
          password: hashedPassword,
          firstName: resolvedFirstName,
          lastName: resolvedLastName,
          emailConfirmed: true,
        },
        include: {
          weeklyStreaks: {
            orderBy: { date: "desc" },
            take: 7,
          },
        },
      });
    }

    // Generate JWT token (same format as login)
    const token = fastify.jwt.sign({
      userId: user.id,
      email: user.email,
      role: user.role,
    });
// console.log("USER >>>>>>>>>>>>>>>>>>>>>>>>>.. : ",user)
    return reply.send({
      token,
      user: formatUserResponse(user, user.weeklyStreaks),
    });
  });
};

export default authRoutes;
