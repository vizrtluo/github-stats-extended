import axios from "axios";
import MockAdapter from "axios-mock-adapter";
import { beforeAll, bench, describe, vi } from "vitest";

import { data_stats } from "../utils.js";

const mock = new MockAdapter(axios);
const repositoryStarCounts = new Map([
  ["repo-keep-1", 1500],
  ["repo-exclude-me", 9999],
  ["repo-keep-2", 2600],
]);

const createResponse = () => ({
  end: vi.fn(),
  setHeader: vi.fn(),
});

let router;

beforeAll(async () => {
  vi.stubEnv("CACHE_SECONDS", "");
  vi.stubEnv("GIST_WHITELIST", "");
  vi.stubEnv("POSTGRES_URL", "");
  vi.stubEnv("WHITELIST", "");

  ({ default: router } = await import("../../router.js"));

  mock.onPost("https://api.github.com/graphql").reply((config) => {
    const requestBody = JSON.parse(config.data);
    if (requestBody.query.includes("repositoryStars")) {
      return [
        200,
        {
          data: {
            node: {
              stargazerCount:
                repositoryStarCounts.get(requestBody.variables.id) ?? 0,
            },
          },
        },
      ];
    }
    return [200, data_stats];
  });
});

describe("bench /api", () => {
  bench(
    "base",
    async () => {
      const req = {
        headers: {},
        url: "/api?username=anuraghazra",
      };
      const res = createResponse();

      await router(req, res);
    },
    { warmupIterations: 50 },
  );
});
