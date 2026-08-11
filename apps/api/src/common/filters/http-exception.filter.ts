import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger
} from "@nestjs/common";
import type { Request, Response } from "express";

type ErrorResponseBody = {
  message?: unknown;
  error?: unknown;
};

function isErrorResponseBody(value: unknown): value is ErrorResponseBody {
  return typeof value === "object" && value !== null;
}

function normalizeMessage(response: unknown): string | string[] {
  if (typeof response === "string") {
    return response;
  }

  if (!isErrorResponseBody(response)) {
    return "Unexpected error";
  }

  if (
    typeof response.message === "string" ||
    Array.isArray(response.message)
  ) {
    return response.message;
  }

  if (typeof response.error === "string") {
    return response.error;
  }

  return "Unexpected error";
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    const request = context.getRequest<Request>();
    const isHttpException = exception instanceof HttpException;
    const statusCode = isHttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;
    const exceptionResponse = isHttpException
      ? exception.getResponse()
      : "Internal server error";

    // Use request.id if available, fallback to header
    const requestIdHeader = request.headers["x-request-id"];
    const requestId = request.id ?? (Array.isArray(requestIdHeader)
      ? requestIdHeader[0]
      : requestIdHeader);

    // Ensure we don't leak Prisma specifics or stack traces to the client
    let safeMessage = normalizeMessage(exceptionResponse);
    if (!isHttpException) {
      safeMessage = "Internal server error";
      // Log the full exception for developers in the server logs
      this.logger.error(
        `[${requestId}] Unhandled Exception on ${request.method} ${request.url}: ${exception instanceof Error ? exception.message : "Unknown error"}`,
        exception instanceof Error ? exception.stack : undefined
      );
    }

    response.status(statusCode).json({
      error: {
        statusCode,
        message: safeMessage,
        path: request.url,
        requestId: requestId ?? null,
        timestamp: new Date().toISOString()
      }
    });
  }
}
