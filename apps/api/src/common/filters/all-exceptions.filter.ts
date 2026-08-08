import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

interface ProblemDetails {
  statusCode: number;
  error: string;
  message: string;
  details?: Array<{ field: string; constraint: string; message: string }>;
  path: string;
  timestamp: string;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
    let error = 'Internal Server Error';
    let message = 'An unexpected error occurred';
    let details: ProblemDetails['details'];

    if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      error = HttpStatus[statusCode] ?? exception.name;
      const body = exception.getResponse();

      if (typeof body === 'string') {
        message = body;
      } else if (typeof body === 'object' && body !== null) {
        const payload = body as Record<string, unknown>;
        if (typeof payload.message === 'string') {
          message = payload.message;
        } else if (Array.isArray(payload.message)) {
          message = 'Validation failed';
          details = payload.message.map((item) => {
            const text = String(item);
            return { field: 'unknown', constraint: 'validate', message: text };
          });
        }
        if (typeof payload.error === 'string') {
          error = payload.error;
        }
      }
    } else if (exception instanceof Error) {
      this.logger.error(exception.message, exception.stack);
      if (process.env.NODE_ENV !== 'production') {
        message = exception.message;
      }
    }

    const problem: ProblemDetails = {
      statusCode,
      error,
      message,
      path: request.url,
      timestamp: new Date().toISOString(),
      ...(details ? { details } : {}),
    };

    response.status(statusCode).json(problem);
  }
}
