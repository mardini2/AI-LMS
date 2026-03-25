// goal: turn thrown errors into stable JSON responses and hide 500 details from clients.

import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

// catches everything; HttpException paths get status + body, others become 500
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const exceptionResponse =
      exception instanceof HttpException ? exception.getResponse() : null;

    // class-validator and Nest often attach { message, statusCode, ... }
    const message =
      typeof exceptionResponse === 'object' && exceptionResponse !== null
        ? exceptionResponse
        : {
            message:
              exception instanceof Error
                ? exception.message
                : 'Internal server error',
          };

    // never leak stack traces or internal strings to the browser on 500
    if (status >= 500) {
      this.logger.error(exception);
      response.status(status).json({
        success: false,
        timestamp: new Date().toISOString(),
        path: request.url,
        message: 'Internal server error',
      });
      return;
    }

    response.status(status).json({
      success: false,
      timestamp: new Date().toISOString(),
      path: request.url,
      ...message,
    });
  }
}
