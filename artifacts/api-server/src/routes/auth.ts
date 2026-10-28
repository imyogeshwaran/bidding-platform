import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { LoginBody, RegisterBody } from "@workspace/api-zod";
import { authenticate, getAuthenticatedUser, readSessionSecret } from "../middlewares/auth";
import { addActivity, createId, users, type UserRecord, type UserRole } from "../repositories/memory-store";

const router: IRouter = Router();

function publicUser(user: UserRecord) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    isSuspended: user.isSuspended === true,
    createdAt: user.createdAt,
    lastActiveAt: user.lastActiveAt,
  };
}

function issueToken(user: UserRecord): string {
  return jwt.sign({ role: user.role }, readSessionSecret(), {
    subject: user.id,
    expiresIn: "7d",
  });
}

router.post("/auth/register", async (request, response): Promise<void> => {
  const parsed = RegisterBody.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({
      success: false,
      error: { code: "INVALID_REQUEST", message: "Check the name, email, password, and account type." },
    });
    return;
  }

  const email = parsed.data.email.toLowerCase().trim();
  if (users.some((user) => user.email === email)) {
    response.status(409).json({
      success: false,
      error: { code: "EMAIL_EXISTS", message: "An account with that email already exists." },
    });
    return;
  }

  const configuredAdminEmail = process.env.INITIAL_ADMIN_EMAIL?.trim().toLowerCase();
  const role: UserRole =
    configuredAdminEmail && configuredAdminEmail === email ? "ADMIN" : parsed.data.role;
  const user: UserRecord = {
    id: createId(),
    name: parsed.data.name.trim(),
    email,
    role,
    isSuspended: false,
    passwordHash: await bcrypt.hash(parsed.data.password, 12),
    createdAt: new Date().toISOString(),
    lastActiveAt: new Date().toISOString(),
  };
  users.push(user);
  addActivity("New account", `${user.name} joined the marketplace`, "user", user.id);
  response.status(201).json({
    success: true,
    data: { token: issueToken(user), user: publicUser(user) },
    message: "Your account is ready.",
  });
});

router.post("/auth/login", async (request, response): Promise<void> => {
  const parsed = LoginBody.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({
      success: false,
      error: { code: "INVALID_REQUEST", message: "Enter a valid email and password." },
    });
    return;
  }

  const user = users.find((candidate) => candidate.email === parsed.data.email.toLowerCase().trim());
  const validPassword = user
    ? await bcrypt.compare(parsed.data.password, user.passwordHash)
    : false;
  if (!user || !validPassword) {
    response.status(401).json({
      success: false,
      error: { code: "INVALID_CREDENTIALS", message: "Email or password is incorrect." },
    });
    return;
  }
  if (user.isSuspended) {
    response.status(403).json({
      success: false,
      error: { code: "ACCOUNT_SUSPENDED", message: "This account is suspended. Contact support for assistance." },
    });
    return;
  }

  user.lastActiveAt = new Date().toISOString();
  addActivity("Signed in", `${user.name} returned to the marketplace`, "user", user.id);
  response.json({
    success: true,
    data: { token: issueToken(user), user: publicUser(user) },
    message: "Welcome back.",
  });
});

router.get("/auth/me", authenticate, (_request, response): void => {
  const session = getAuthenticatedUser(response);
  const user = users.find((candidate) => candidate.id === session?.id);
  if (!user) {
    response.status(401).json({
      success: false,
      error: { code: "SESSION_EXPIRED", message: "Your session has expired." },
    });
    return;
  }
  response.json({ success: true, data: publicUser(user), message: "Current account." });
});

router.post("/auth/logout", authenticate, (_request, response): void => {
  response.locals.skipStatePersistence = true;
  response.sendStatus(204);
});

export default router;
