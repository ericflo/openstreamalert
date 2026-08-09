import type { NextFunction, Request, Response } from "express";
import { config } from "./config.js";
import { getAccountBySession, type Account } from "./database.js";

declare global {
  // Express exposes request augmentation through a namespace declaration.
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      account?: Account;
    }
  }
}

export function cookies(request: Request) {
  return Object.fromEntries(
    (request.headers.cookie ?? "")
      .split(";")
      .filter(Boolean)
      .map((part) => {
        const [name, ...value] = part.trim().split("=");
        return [decodeURIComponent(name), decodeURIComponent(value.join("="))];
      }),
  );
}

export function setCookie(
  response: Response,
  name: string,
  value: string,
  maxAge: number,
) {
  response.append(
    "Set-Cookie",
    `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${config.production ? "; Secure" : ""}`,
  );
}

export function clearCookie(response: Response, name: string) {
  setCookie(response, name, "", 0);
}

export function session(
  request: Request,
  _response: Response,
  next: NextFunction,
) {
  request.account = getAccountBySession(cookies(request).osa_session);
  next();
}

export function requireAccount(
  request: Request,
  response: Response,
  next: NextFunction,
) {
  if (!request.account)
    return response.status(401).json({ error: "Authentication required" });
  next();
}

export function requireSameOrigin(
  request: Request,
  response: Response,
  next: NextFunction,
) {
  const origin = request.get("origin");
  if (!origin && config.production)
    return response.status(403).json({ error: "Origin required" });
  if (origin && origin !== new URL(config.appUrl).origin)
    return response.status(403).json({ error: "Invalid origin" });
  next();
}
