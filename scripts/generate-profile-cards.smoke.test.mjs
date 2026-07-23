import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { generateCards, parseArgs } from "./generate-profile-cards.mjs";

test("parseArgs reads required card options", () => {
  const result = parseArgs([
    "--username",
    "octocat",
    "--stats-output",
    "dist/stats.svg",
    "--languages-output",
    "dist/top-langs.svg",
    "--stats-options",
    "show_icons=true",
  ]);

  assert.equal(result.username, "octocat");
  assert.deepEqual(result.statsOptions, { show_icons: "true" });
});

test("generateCards writes both SVG files", async () => {
  const outputDirectory = await mkdtemp(
    path.join(os.tmpdir(), "profile-cards-"),
  );
  const calls = [];
  const createHandler = (content) => async (options, token) => {
    calls.push({ options, token });
    return { status: "success", content };
  };

  try {
    const statsOutput = path.join(outputDirectory, "stats.svg");
    const languagesOutput = path.join(outputDirectory, "top-langs.svg");
    await generateCards({
      apiHandler: createHandler("<svg>stats</svg>"),
      topLanguagesHandler: createHandler("<svg>languages</svg>"),
      username: "octocat",
      statsOutput,
      languagesOutput,
      statsOptions: { show_icons: "true" },
      languagesOptions: { langs_count: "10" },
      token: "test-token",
    });

    assert.equal(await readFile(statsOutput, "utf8"), "<svg>stats</svg>");
    assert.equal(
      await readFile(languagesOutput, "utf8"),
      "<svg>languages</svg>",
    );
    assert.deepEqual(calls, [
      {
        options: { show_icons: "true", username: "octocat" },
        token: "test-token",
      },
      {
        options: { langs_count: "10", username: "octocat" },
        token: "test-token",
      },
    ]);
  } finally {
    await rm(outputDirectory, { recursive: true, force: true });
  }
});
