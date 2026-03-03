import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import fastifyJwt from '@fastify/jwt';
import { env } from '../config/env';
import { httpError } from "../utils/errors";
import { JwtPayload, ROLES } from '../types';

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireAdmin: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

const authPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.register(fastifyJwt, {
    secret: env.JWT_SECRET,
    sign: {
      expiresIn: env.JWT_EXPIRES_IN,
    },
  });

  fastify.decorate(
    'authenticate',
    async function (request: FastifyRequest, _reply: FastifyReply) {
      try {
        await request.jwtVerify();
      } catch (err) {
        return httpError("Invalid or expired token");
      }
    }
  );

  fastify.decorate(
    'requireAdmin',
    async function (request: FastifyRequest, _reply: FastifyReply) {
      await request.jwtVerify();
      const { role } = request.user as JwtPayload;
      if (role !== ROLES.ADMIN && role !== ROLES.SUPER_ADMIN) {
        httpError('Forbidden', 403);
      }
    }
  );
};

export default fp(authPlugin, { name: 'auth' });
