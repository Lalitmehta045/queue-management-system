import request from "supertest";
import type { Server } from "node:http";
import { createApplication } from "../src/main";

type HealthResponseBody = {
  status?: unknown;
  service?: unknown;
  timestamp?: unknown;
  uptimeSeconds?: unknown;
  DATABASE_URL?: unknown;
  JWT_ACCESS_SECRET?: unknown;
};

describe("Health endpoint", () => {
  it("returns API health information", async () => {
    const app = await createApplication();
    await app.init();

    const server = app.getHttpServer() as Server;

    await request(server)
      .get("/health")
      .expect(200)
      .expect((response) => {
        const body = response.body as HealthResponseBody;

        expect(body.status).toBe("ok");
        expect(body.service).toBe("queue-management-api");
        expect(typeof body.timestamp).toBe("string");
        expect(typeof body.uptimeSeconds).toBe("number");
        expect(body).not.toHaveProperty("DATABASE_URL");
        expect(body).not.toHaveProperty("JWT_ACCESS_SECRET");
      });

    if (typeof app !== "undefined" && app) { await app.close(); }
  });
});
