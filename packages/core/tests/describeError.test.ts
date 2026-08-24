import axios from "axios";
import MockAdapter from "axios-mock-adapter";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import api from "../src/api/index.js";
import {
  CustomError,
  MissingParamError,
  describeError,
} from "../src/common/error.js";

vi.mock(import("../src/common/log.js"), async () => {
  const { createLoggerMock } = await import("./utils.js");
  return createLoggerMock();
});

describe("Test describeError", () => {
  it("should return message only for errors without a type", () => {
    expect(describeError(new Error("boom"))).toStrictEqual({
      message: "boom",
    });
  });

  it("should return type and message for custom errors", () => {
    expect(
      describeError(
        new CustomError(
          "Downtime due to GitHub API rate limiting",
          CustomError.MAX_RETRY,
        ),
      ),
    ).toStrictEqual({
      type: CustomError.MAX_RETRY,
      message: "Downtime due to GitHub API rate limiting",
    });
  });

  it("should omit the type for missing param errors", () => {
    expect(describeError(new MissingParamError(["username"]))).toStrictEqual({
      message:
        'Missing params "username" make sure you pass the parameters in URL',
    });
  });
});

describe("Test API result error contract", () => {
  let mock: MockAdapter;

  beforeEach(() => {
    mock = new MockAdapter(axios);
  });

  afterEach(() => {
    mock.restore();
  });

  it("stats handler should attach typed details on rate limit exhaustion", async () => {
    mock.onPost("https://api.github.com/graphql").reply(200, {
      errors: [{ type: "RATE_LIMITED" }],
    });

    const result = await api({ username: "octocat" });

    // status keeps its exact value for comparisons in apps/backend/router.js
    expect(result.status).toBe("error - temporary");
    expect(result).toMatchObject({
      status: "error - temporary",
      error: {
        type: CustomError.MAX_RETRY,
        message: "Downtime due to GitHub API rate limiting",
      },
    });
  });

  it("stats handler should attach message-only details for missing params", async () => {
    const result = await api({});
    const { error } = result as {
      error?: Partial<Record<string, string>>;
    };

    expect(result.status).toBe("error - temporary");
    expect(error).not.toHaveProperty("type");
    expect(error?.message).toContain('Missing params "username"');
  });
});
