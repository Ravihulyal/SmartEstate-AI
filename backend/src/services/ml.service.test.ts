import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";

const originalApiKey = process.env.ML_API_KEY;
const originalServiceUrl = process.env.ML_SERVICE_URL;
const requestPaths: string[] = [];
const requestApiKeys: string[] = [];
const testApiKey = "test-api-key-for-ml-client";
let mlService: typeof import("./ml.service");
let server: ReturnType<typeof createServer>;

before(async () => {
  server = createServer((request, response) => {
    requestPaths.push(request.url ?? "");
    const apiKeyHeader = request.headers["x-api-key"];
    requestApiKeys.push(
      Array.isArray(apiKeyHeader) ? apiKeyHeader.join(",") : apiKeyHeader ?? ""
    );
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ ok: true }));
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address() as AddressInfo;
  process.env.ML_SERVICE_URL = `http://127.0.0.1:${address.port}`;
  process.env.ML_API_KEY = testApiKey;
  mlService = await import("./ml.service.js");
});

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  if (originalApiKey === undefined) {
    delete process.env.ML_API_KEY;
  } else {
    process.env.ML_API_KEY = originalApiKey;
  }
  if (originalServiceUrl === undefined) {
    delete process.env.ML_SERVICE_URL;
  } else {
    process.env.ML_SERVICE_URL = originalServiceUrl;
  }
});

describe("ML service API-key authentication", () => {
  it("sends the API key with every ML request", async () => {
    await mlService.predictPrice({
      location: "Whitefield",
      total_sqft: 1200,
      bhk: 2,
      bath: 2
    });
    await mlService.detectFraud({
      location: "Whitefield",
      total_sqft: 1200,
      bhk: 2,
      bath: 2,
      price: 65
    });
    await mlService.classifyRisk({
      location: "Whitefield",
      total_sqft: 1200,
      bhk: 2,
      bath: 2,
      price: 65
    });
    await mlService.recommendProperties({
      location: "Whitefield",
      budget: 100,
      bhk: 2,
      area: 1200
    });

    assert.deepEqual(requestPaths, [
      "/predict-price",
      "/detect-fraud",
      "/classify-risk",
      "/recommend"
    ]);
    assert.deepEqual(requestApiKeys, Array(4).fill(testApiKey));
  });

  it("rejects requests without an API key before making a network request", async () => {
    delete process.env.ML_API_KEY;
    const requestCount = requestPaths.length;
    const input = {
      location: "Whitefield",
      total_sqft: 1200,
      bhk: 2,
      bath: 2
    };
    const fraudInput = { ...input, price: 65 };

    const requestsWithoutKey = [
      () => mlService.predictPrice(input),
      () => mlService.detectFraud(fraudInput),
      () => mlService.classifyRisk(fraudInput),
      () => mlService.recommendProperties({
        location: "Whitefield",
        budget: 100,
        bhk: 2,
        area: 1200
      })
    ];
    for (const request of requestsWithoutKey) {
      await assert.rejects(request(), /ML_API_KEY must be configured/);
    }
    assert.equal(requestPaths.length, requestCount);
  });
});
