import crypto from "crypto";

const sessions = new Map();

function createSession(userId) {
  return {
    id: crypto.randomUUID(),
    userId,
    hfChatStarted: false,
    hfConversationId: null,
    hfAccessToken: null,
    hfTokenFetchedAt: 0,
    hfSessionCookie: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export function sessionMiddleware(req, res, next) {
  const headerUserId = req.header("x-user-id");
  const cookieUserId = req.header("x-session-id");
  const userId = headerUserId || cookieUserId || "demo-user";

  let session = sessions.get(userId);
  if (!session) {
    session = createSession(userId);
    sessions.set(userId, session);
  }

  session.updatedAt = Date.now();
  req.userId = userId;
  req.session = session;
  res.setHeader("x-session-id", userId);
  next();
}

export function updateSession(userId, patch) {
  const session = sessions.get(userId) || createSession(userId);
  Object.assign(session, patch, { updatedAt: Date.now() });
  sessions.set(userId, session);
  return session;
}
