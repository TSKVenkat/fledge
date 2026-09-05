import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';

/**
 * One error class and a handful of factories. The wire format is fixed:
 *
 *   { "error": { "code", "message", "retryable", "fields"? } }
 *
 * `retryable` is part of the response rather than something a client infers
 * from the status code, because the client's retry loop should not have to
 * guess.
 */
export class AppError extends Error {
  override readonly name = 'AppError';
  readonly status: number;
  readonly code: string;
  readonly retryable: boolean;
  readonly fields?: { path: string; message: string }[];

  constructor(status: number, code: string, message: string,
              options: { retryable?: boolean; fields?: { path: string; message: string }[] } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.fields = options.fields;
  }
}

export const badRequest = (code: string, message: string) => new AppError(400, code, message);
export const unauthorized = (message = 'Sign in to continue.') => new AppError(401, 'UNAUTHENTICATED', message);
export const forbidden = (message = 'You do not have access to that.') => new AppError(403, 'FORBIDDEN', message);
export const notFound = (message = 'Not found.') => new AppError(404, 'NOT_FOUND', message);
export const conflict = (code: string, message: string) => new AppError(409, code, message);
export const tooLarge = (message: string) => new AppError(413, 'TOO_LARGE', message);

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.status).send({
        error: { code: error.code, message: error.message, retryable: error.retryable, fields: error.fields },
      });
    }
    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: {
          code: 'INVALID_REQUEST', message: 'That request was not valid.', retryable: false,
          fields: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        },
      });
    }
    // Fastify's own client errors pass through with their own codes.
    const fastifyError = error as { statusCode?: number; code?: string; message?: string };
    const status = fastifyError.statusCode ?? 500;
    if (status < 500) {
      return reply.status(status).send({
        error: {
          code: fastifyError.code ?? 'BAD_REQUEST',
          message: fastifyError.message ?? 'That request was not valid.',
          retryable: false,
        },
      });
    }
    // Anything unrecognised is a bug. Log it in full; tell the caller nothing.
    request.log.error({ err: error }, 'unhandled error');
    return reply.status(500).send({
      error: { code: 'INTERNAL_ERROR', message: 'Something went wrong.', retryable: true },
    });
  });
}
