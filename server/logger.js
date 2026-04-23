const SERVICE_NAME = "campaign-calendar-api";

function toSafeError(error) {
  if (!error) return null;
  return {
    name: error.name,
    message: error.message,
    stack: error.stack,
  };
}

export function log(level, event, meta = {}) {
  const payload = {
    timestamp: new Date().toISOString(),
    level,
    service: SERVICE_NAME,
    event,
    ...meta,
  };

  const line = JSON.stringify(payload);
  if (level === "error") {
    console.error(line);
    return;
  }

  console.log(line);
}

export function logInfo(event, meta = {}) {
  log("info", event, meta);
}

export function logWarn(event, meta = {}) {
  log("warn", event, meta);
}

export function logError(event, error, meta = {}) {
  log("error", event, {
    ...meta,
    error: toSafeError(error),
  });
}
