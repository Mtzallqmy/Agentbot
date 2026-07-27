import assert from "node:assert/strict";
import test from "node:test";

const developmentPreviewMeta =
  /<meta(?=[^>]*\bname=["']codex-preview["'])(?=[^>]*\bcontent=["']development["'])[^>]*>/i;

test("renders development preview metadata", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  const response = await worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );

  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-type") ?? "",
    /^text\/html\b/i,
  );
  assert.match(await response.text(), developmentPreviewMeta);
});

function databaseWithUser() {
  return {
    prepare(sql) {
      return {
        bind() {
          return this;
        },
        async first() {
          if (sql.includes("FROM users")) {
            return { id: "user-1", email: "owner@example.com", fullName: "Owner", role: "superadmin" };
          }
          return { value: 1 };
        },
        async all() {
          return { results: [] };
        },
        async run() {
          return { success: true };
        },
      };
    },
  };
}

async function loadWorker() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("api-test", `${process.pid}-${Date.now()}-${Math.random()}`);
  return (await import(workerUrl.href)).default;
}

test("serves a real database health response", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(
    new Request("https://site.example/api/edge/health"),
    { DB: databaseWithUser() },
    { waitUntil() {}, passThroughOnException() {} },
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    status: "ok",
    database: "connected",
    runtime: "cloudflare-edge",
  });
});

test("protects owner APIs when the platform identity is absent", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(
    new Request("https://site.example/api/edge/files"),
    { DB: databaseWithUser() },
    { waitUntil() {}, passThroughOnException() {} },
  );
  assert.equal(response.status, 401);
});

test("rejects private provider URLs before storing credentials", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(
    new Request("https://site.example/api/edge/providers", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "oai-authenticated-user-email": "owner@example.com",
      },
      body: JSON.stringify({
        name: "Unsafe",
        base_url: "http://127.0.0.1:11434/v1",
        api_key: "not-a-real-key",
        default_model: "model",
      }),
    }),
    {
      DB: databaseWithUser(),
      ENCRYPTION_MASTER_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    },
    { waitUntil() {}, passThroughOnException() {} },
  );
  assert.equal(response.status, 422);
});
