import type { NextFunction, Request, Response } from "express";
import jwt, { type JwtPayload } from "jsonwebtoken";
import type { UserRole } from "../repositories/memory-store";
import { users } from "../repositories/memory-store";

export interface AuthUser {
  id: string;
  role: UserRole;
}

const readSessionSecret = (): string => {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not configured");
  return secret;
};

export function getAuthenticatedUser(response: Response): AuthUser | null {
  return (response.locals.authUser as AuthUser | undefined) ?? null;
}

export function authenticate(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  const authorization = request.header("authorization");
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    response.status(401).json({
      success: false,
      error: { code: "AUTH_REQUIRED", message: "Sign in to continue." },
    });
    return;
  }

  try {
    const payload = jwt.verify(match[1], readSessionSecret()) as JwtPayload;
    const subject = typeof payload.sub === "string" ? payload.sub : "";
    const user = users.find((candidate) => candidate.id === subject);
    if (!user) {
      response.status(401).json({
        success: false,
        error: { code: "SESSION_EXPIRED", message: "Your session has expired." },
      });
      return;
    }
    response.locals.authUser = { id: user.id, role: user.role } satisfies AuthUser;
    next();
  } catch {
    response.status(401).json({
      success: false,
      error: { code: "INVALID_SESSION", message: "Your session is invalid or expired." },
    });
  }
}

export function allowRoles(...allowedRoles: UserRole[]) {
  return (_request: Request, response: Response, next: NextFunction): void => {
    const user = getAuthenticatedUser(response);
    if (!user) {
      response.status(401).json({
        success: false,
        error: { code: "AUTH_REQUIRED", message: "Sign in to continue." },
      });
      return;
    }
    if (!allowedRoles.includes(user.role)) {
      response.status(403).json({
        success: false,
        error: { code: "FORBIDDEN", message: "Your account cannot perform this action." },
      });
      return;
    }
    next();
  };
}

export { readSessionSecret };
