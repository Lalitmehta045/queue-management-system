import { Injectable, NestMiddleware } from "@nestjs/common";
import type { Request, Response, NextFunction } from "express";
import * as crypto from "crypto";

// Extend Express Request interface to include 'id'
declare module "express" {
  interface Request {
    id?: string;
  }
}

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const existingId = req.headers["x-request-id"];
    let requestId: string;

    if (
      typeof existingId === "string" &&
      existingId.length > 0 &&
      existingId.length <= 100 &&
      /^[a-zA-Z0-9-]+$/.test(existingId)
    ) {
      requestId = existingId;
    } else {
      requestId = crypto.randomUUID();
    }

    req.headers["x-request-id"] = requestId;
    res.setHeader("x-request-id", requestId);
    
    // Support nested/pino logger request id mapping easily
    req.id = requestId;

    next();
  }
}
