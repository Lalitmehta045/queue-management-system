import { validateEnvironment } from "../src/config/env.validation";

describe("validateEnvironment", () => {
  it("provides safe development defaults", () => {
    const config = validateEnvironment({});

    expect(config.NODE_ENV).toBe("development");
    expect(config.PORT).toBe(4000);
    expect(config.DATABASE_URL).toContain("postgresql://");
  });

  it("fails fast when production secrets are missing", () => {
    expect(() =>
      validateEnvironment({
        NODE_ENV: "production",
        DATABASE_URL: "postgresql://user:pass@localhost:5432/db",
        CORS_ORIGIN: "https://example.com",
        PORT: "4000"
      })
    ).toThrow("JWT_ACCESS_SECRET is required in production");
  });

  it("rejects placeholder production secrets", () => {
    expect(() =>
      validateEnvironment({
        NODE_ENV: "production",
        DATABASE_URL: "postgresql://user:pass@localhost:5432/db",
        JWT_ACCESS_SECRET: "replace-with-a-long-random-access-secret",
        JWT_REFRESH_SECRET: "replace-with-a-long-random-refresh-secret",
        CORS_ORIGIN: "https://example.com",
        TOKEN_TIME_ZONE: "Asia/Kolkata",
        PORT: "4000"
      })
    ).toThrow("JWT_ACCESS_SECRET must not use placeholder values in production");
  });
});
