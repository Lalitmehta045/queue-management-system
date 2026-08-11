export type NodeEnvironment = "development" | "test" | "production";

export type ValidatedEnvironment = {
  NODE_ENV: NodeEnvironment;
  PORT: number;
  DATABASE_URL: string;
  JWT_ACCESS_SECRET: string;
  JWT_REFRESH_SECRET: string;
  CORS_ORIGIN: string;
  TOKEN_TIME_ZONE: string;
  NOTIFICATION_PROVIDER: "noop" | "mock";
};

const DEVELOPMENT_DEFAULTS = {
  DATABASE_URL:
    "postgresql://queue_user:queue_password@localhost:5432/queue_management?schema=public",
  JWT_ACCESS_SECRET: "development-only-access-secret-change-before-production",
  JWT_REFRESH_SECRET: "development-only-refresh-secret-change-before-production",
  CORS_ORIGIN: "http://localhost:3000",
  TOKEN_TIME_ZONE: "Asia/Kolkata",
  PORT: "4000",
  NOTIFICATION_PROVIDER: "noop"
} as const;

const ALLOWED_NODE_ENV: NodeEnvironment[] = [
  "development",
  "test",
  "production"
];

function readString(
  config: Record<string, unknown>,
  key: keyof typeof DEVELOPMENT_DEFAULTS,
  nodeEnv: NodeEnvironment
): string {
  const value = config[key];

  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }

  if (nodeEnv === "production") {
    throw new Error(`${key} is required in production`);
  }

  return DEVELOPMENT_DEFAULTS[key];
}

function validateSecret(secret: string, key: string, nodeEnv: NodeEnvironment) {
  if (nodeEnv !== "production") {
    return;
  }

  if (secret.length < 32) {
    throw new Error(`${key} must be at least 32 characters in production`);
  }

  if (secret.includes("replace-with") || secret.includes("development-only")) {
    throw new Error(`${key} must not use placeholder values in production`);
  }
}

export function validateEnvironment(
  config: Record<string, unknown>
): ValidatedEnvironment {
  const rawNodeEnv = config.NODE_ENV ?? "development";

  if (
    typeof rawNodeEnv !== "string" ||
    !ALLOWED_NODE_ENV.includes(rawNodeEnv as NodeEnvironment)
  ) {
    throw new Error("NODE_ENV must be development, test, or production");
  }

  const nodeEnv = rawNodeEnv as NodeEnvironment;
  const rawPort = readString(config, "PORT", nodeEnv);
  const port = Number.parseInt(rawPort, 10);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be a valid TCP port");
  }

  const databaseUrl = readString(config, "DATABASE_URL", nodeEnv);
  const jwtAccessSecret = readString(config, "JWT_ACCESS_SECRET", nodeEnv);
  const jwtRefreshSecret = readString(config, "JWT_REFRESH_SECRET", nodeEnv);
  const corsOrigin = readString(config, "CORS_ORIGIN", nodeEnv);
  const tokenTimeZone = readString(config, "TOKEN_TIME_ZONE", nodeEnv);

  const rawNotificationProvider = config.NOTIFICATION_PROVIDER ?? "noop";
  if (rawNotificationProvider !== "noop" && rawNotificationProvider !== "mock") {
    throw new Error("NOTIFICATION_PROVIDER must be noop or mock");
  }

  validateSecret(jwtAccessSecret, "JWT_ACCESS_SECRET", nodeEnv);
  validateSecret(jwtRefreshSecret, "JWT_REFRESH_SECRET", nodeEnv);

  return {
    NODE_ENV: nodeEnv,
    PORT: port,
    DATABASE_URL: databaseUrl,
    JWT_ACCESS_SECRET: jwtAccessSecret,
    JWT_REFRESH_SECRET: jwtRefreshSecret,
    CORS_ORIGIN: corsOrigin,
    TOKEN_TIME_ZONE: tokenTimeZone,
    NOTIFICATION_PROVIDER: rawNotificationProvider
  };
}
