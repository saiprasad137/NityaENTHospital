import { clerkClient, getAuth } from "@clerk/express";
import type { Request, RequestHandler } from "express";

export interface AdminIdentity {
  userId: string;
  email: string;
}

const getConfiguredAdminEmails = (): Set<string> =>
  new Set(
    (process.env.NITYA_ADMIN_EMAILS ?? process.env.ADMIN_EMAILS ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );

const isClerkKeyValid = (key?: string) =>
  Boolean(key && !key.includes("...") && (key.startsWith("sk_") || key.startsWith("pk_")));

export const isClerkConfigured = (): boolean =>
  isClerkKeyValid(process.env.CLERK_SECRET_KEY) &&
  isClerkKeyValid(process.env.CLERK_PUBLISHABLE_KEY);

export async function resolveAdminIdentity(
  req: Request,
): Promise<{ identity: AdminIdentity | null; signedIn: boolean }> {
  if (!isClerkConfigured()) {
    return { identity: null, signedIn: false };
  }

  const { userId } = getAuth(req);
  if (!userId) return { identity: null, signedIn: false };

  const user = await clerkClient.users.getUser(userId);
  const primaryEmail = user.emailAddresses.find(
    (email) => email.id === user.primaryEmailAddressId,
  );
  const email = primaryEmail?.emailAddress?.trim().toLowerCase();
  if (!email || primaryEmail?.verification?.status !== "verified") {
    return { identity: null, signedIn: true };
  }

  if (!getConfiguredAdminEmails().has(email)) {
    return { identity: { userId, email }, signedIn: true };
  }

  return { identity: { userId, email }, signedIn: true };
}

export const requireAdmin: RequestHandler = async (
  req,
  res,
  next,
): Promise<void> => {
  try {
    if (!isClerkConfigured()) {
      res.status(503).json({
        error: "Authentication is not configured. Please set valid CLERK_PUBLISHABLE_KEY and CLERK_SECRET_KEY in .env.",
      });
      return;
    }

    const { identity, signedIn } = await resolveAdminIdentity(req);
    if (!signedIn) {
      res.status(401).json({ error: "Sign in to continue." });
      return;
    }

    const admins = getConfiguredAdminEmails();
    if (admins.size === 0) {
      res.status(503).json({
        error: "Admin access is not configured for this hospital yet.",
      });
      return;
    }

    if (!identity || !admins.has(identity.email)) {
      res.status(403).json({ error: "This account does not have admin access." });
      return;
    }

    res.locals.admin = identity;
    next();
  } catch (error) {
    req.log.error({ err: error }, "Failed to verify administrator access");
    res.status(500).json({ error: "Could not verify admin access." });
  }
};
