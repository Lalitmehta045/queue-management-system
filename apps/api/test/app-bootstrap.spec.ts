import { createApplication } from "../src/main";

describe("API bootstrap", () => {
  it("creates the Nest application with global configuration", async () => {
    const app = await createApplication();

    expect(app).toBeDefined();

    if (typeof app !== "undefined" && app) { await app.close(); }
  });
});
