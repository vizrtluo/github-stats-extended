#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const HELP = `Usage:
  node scripts/generate-profile-cards.mjs [options]

Options:
  --username <name>              GitHub user to query.
  --stats-output <path>          Stats SVG output path.
  --languages-output <path>      Languages SVG output path.
  --stats-options <query>        Stats card options.
  --languages-options <query>    Languages card options.
  -h, --help                     Show this help.

The script reads the GitHub token from PAT_1.
Build packages/core before you run this script.
`;

const parseOptions = (value) => {
  return Object.fromEntries(new URLSearchParams(value));
};

const parseArgs = (args) => {
  const values = {};
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === "-h" || argument === "--help") {
      return { help: true };
    }
    if (!argument?.startsWith("--")) {
      throw new Error(`Unknown argument: ${argument}`);
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${argument}`);
    }
    values[argument.slice(2)] = value;
    index++;
  }

  const required = ["username", "stats-output", "languages-output"];
  for (const name of required) {
    if (!values[name]) {
      throw new Error(`Missing required option: --${name}`);
    }
  }

  return {
    help: false,
    username: values.username,
    statsOutput: values["stats-output"],
    languagesOutput: values["languages-output"],
    statsOptions: parseOptions(values["stats-options"] ?? ""),
    languagesOptions: parseOptions(values["languages-options"] ?? ""),
  };
};

const writeCard = async ({ handler, options, output, token }) => {
  const result = await handler(options, token);
  if (result.status !== "success") {
    const detail = [result.error?.type, result.error?.message]
      .filter(Boolean)
      .join(": ");
    throw new Error(
      detail
        ? `Card generation failed (${result.status}): ${detail}`
        : `Card generation failed with status: ${result.status}`,
    );
  }
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, result.content, "utf8");
};

const generateCards = async ({
  apiHandler,
  topLanguagesHandler,
  username,
  statsOutput,
  languagesOutput,
  statsOptions = {},
  languagesOptions = {},
  token,
}) => {
  await writeCard({
    handler: apiHandler,
    options: { ...statsOptions, username },
    output: statsOutput,
    token,
  });
  await writeCard({
    handler: topLanguagesHandler,
    options: { ...languagesOptions, username },
    output: languagesOutput,
    token,
  });
};

const runCli = async () => {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(HELP);
    return;
  }
  const token = process.env.PAT_1;
  if (!token) {
    throw new Error("PAT_1 is required.");
  }

  const { api, topLangs } = await import("../packages/core/build/index.js");
  await generateCards({
    apiHandler: api,
    topLanguagesHandler: topLangs,
    ...options,
    token,
  });
};

const entryPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : "";
if (entryPath === import.meta.url) {
  runCli().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

export { generateCards, parseArgs };
