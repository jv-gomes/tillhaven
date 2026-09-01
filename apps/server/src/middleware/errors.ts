import type { FastifyError, FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { GameError, ErrorCode } from '@tillhaven/shared';

/**
 * The single place an error becomes a response.
 *
 * Only GameError and Zod validation failures produce a specific code. Anything
 * else is logged in full server-side and returned as a bare INTERNAL, so stack
 * traces, SQL, and internal identifiers never reach the client
 * (CLAUDE.md §4.1).
 */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err: FastifyError, req, reply) => {
    if (err instanceof GameError) {
      req.log.info({ code: err.code, path: req.url }, 'game error');
      return reply.status(err.status).send(err.toJSON());
    }

    if (err instanceof ZodError) {
      return reply.status(400).send({
        error: {
          code: ErrorCode.VALIDATION_FAILED,
          message: 'Some of that input was not valid.',
          // Field paths only — never echo the submitted values back, since a
          // password could be among them.
          details: Object.fromEntries(
            err.issues.map((i) => [i.path.join('.') || '_', i.message]),
          ),
        },
      });
    }

    if (err.statusCode === 429) {
      return reply.status(429).send({
        error: { code: ErrorCode.RATE_LIMITED, message: 'Too many requests. Slow down.' },
      });
    }

    if (err.statusCode && err.statusCode < 500) {
      return reply.status(err.statusCode).send({
        error: { code: ErrorCode.VALIDATION_FAILED, message: 'Bad request.' },
      });
    }

    req.log.error({ err, path: req.url }, 'unhandled error');
    return reply.status(500).send({
      error: { code: ErrorCode.INTERNAL, message: 'Something went wrong on our end.' },
    });
  });
}
