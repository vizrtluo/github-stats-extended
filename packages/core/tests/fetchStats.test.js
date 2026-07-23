import axios from "axios";
import MockAdapter from "axios-mock-adapter";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { calculateRank } from "../src/calculateRank.js";
import { loadConfigFromEnv } from "../src/common/config.js";
import { fetchStats } from "../src/fetchers/stats.js";

vi.mock(import("../src/common/log.js"), async () => {
  const { createLoggerMock } = await import("./utils.js");
  return createLoggerMock();
});

// Test parameters.
const data_stats = {
  data: {
    user: {
      name: "Anurag Hazra",
      repositoriesContributedTo: { totalCount: 61 },
      commits: {
        totalCommitContributions: 100,
      },
      reviews: {
        totalPullRequestReviewContributions: 50,
      },
      pullRequests: { totalCount: 300 },
      mergedPullRequests: { totalCount: 240 },
      openIssues: { totalCount: 100 },
      closedIssues: { totalCount: 100 },
      followers: { totalCount: 100 },
      repositoryDiscussions: { totalCount: 10 },
      repositoryDiscussionComments: { totalCount: 40 },
      repositories: {
        totalCount: 3,
        nodes: [
          { id: "repo-1", name: "test-repo-1" },
          { id: "repo-2", name: "test-repo-2" },
          { id: "repo-3", name: "test-repo-3" },
        ],
        pageInfo: {
          hasNextPage: true,
          endCursor: "cursor",
        },
      },
    },
  },
};

const data_year2003 = JSON.parse(JSON.stringify(data_stats));
data_year2003.data.user.commits.totalCommitContributions = 428;

const data_without_pull_requests = {
  data: {
    user: {
      ...data_stats.data.user,
      pullRequests: { totalCount: 0 },
      mergedPullRequests: { totalCount: 0 },
    },
  },
};

const data_repo = {
  data: {
    user: {
      repositories: {
        nodes: [
          { id: "repo-4", name: "test-repo-4" },
          { id: "repo-5", name: "test-repo-5" },
        ],
        pageInfo: {
          hasNextPage: false,
          endCursor: "cursor",
        },
      },
    },
  },
};

const data_repo_zero_stars = {
  data: {
    user: {
      repositories: {
        totalCount: 5,
        nodes: [
          { id: "repo-1", name: "test-repo-1" },
          { id: "repo-2", name: "test-repo-2" },
          { id: "repo-3", name: "test-repo-3" },
          { id: "repo-zero-4", name: "test-repo-4" },
          { id: "repo-zero-5", name: "test-repo-5" },
        ],
        pageInfo: {
          hasNextPage: true,
          endCursor: "cursor",
        },
      },
    },
  },
};

const error = {
  errors: [
    {
      type: "NOT_FOUND",
      path: ["user"],
      locations: [],
      message: "Could not resolve to a User with the login of 'noname'.",
    },
  ],
};

const mock = new MockAdapter(axios);
const repositoryStarCounts = new Map([
  ["repo-1", 100],
  ["repo-2", 100],
  ["repo-3", 100],
  ["repo-4", 50],
  ["repo-5", 50],
  ["repo-zero-4", 0],
  ["repo-zero-5", 0],
]);

beforeEach(() => {
  process.env.FETCH_MULTI_PAGE_STARS = "false"; // Set to `false` to fetch only one page of stars.
  loadConfigFromEnv();
  mock.onPost("https://api.github.com/graphql").reply((cfg) => {
    let req = JSON.parse(cfg.data);

    if (
      req.variables &&
      req.variables.startTime &&
      req.variables.startTime.startsWith("2003")
    ) {
      return [200, data_year2003];
    }
    if (req.query.includes("repositoryStars")) {
      return [
        200,
        {
          data: {
            node: {
              stargazerCount: repositoryStarCounts.get(req.variables.id) ?? 0,
            },
          },
        },
      ];
    }
    return [
      200,
      req.query.includes("totalCommitContributions") ? data_stats : data_repo,
    ];
  });
});

afterEach(() => {
  mock.reset();
});

describe("Test fetchStats", () => {
  it("should fetch correct stats", async () => {
    let stats = await fetchStats("anuraghazra");
    const rank = calculateRank({
      all_commits: false,
      commits: 100,
      prs: 300,
      reviews: 50,
      issues: 200,
      repos: 5,
      stars: 300,
      followers: 100,
    });

    expect(stats).toStrictEqual({
      contributedTo: 61,
      name: "Anurag Hazra",
      totalCommits: 100,
      totalIssues: 200,
      totalPRs: 300,
      totalPRsMerged: 0,
      mergedPRsPercentage: 0,
      totalReviews: 50,
      totalStars: 300,
      totalDiscussionsStarted: 0,
      totalDiscussionsAnswered: 0,
      totalPRsAuthored: 0,
      totalPRsCommented: 0,
      totalPRsReviewed: 0,
      totalIssuesAuthored: 0,
      totalIssuesCommented: 0,
      rank,
    });
  });

  it("should fetch repository star counts in series", async () => {
    const dataWithoutStarConnections = structuredClone(data_stats);
    dataWithoutStarConnections.data.user.repositories.nodes = [
      { id: "repo-1", name: "test-repo-1" },
      { id: "repo-2", name: "test-repo-2" },
      { id: "repo-3", name: "test-repo-3" },
    ];
    let activeStarRequests = 0;
    let maxActiveStarRequests = 0;
    const queriedRepositoryIds = [];

    mock.reset();
    mock.onPost("https://api.github.com/graphql").reply(async (config) => {
      const requestBody = JSON.parse(config.data);
      if (requestBody.query.includes("repositoryStars")) {
        activeStarRequests++;
        maxActiveStarRequests = Math.max(
          maxActiveStarRequests,
          activeStarRequests,
        );
        queriedRepositoryIds.push(requestBody.variables.id);
        await new Promise((resolve) => setTimeout(resolve, 1));
        activeStarRequests--;
        return [200, { data: { node: { stargazerCount: 100 } } }];
      }

      expect(requestBody.query).not.toContain("stargazers {");
      return [200, dataWithoutStarConnections];
    });

    const stats = await fetchStats("anuraghazra");

    expect(stats.totalStars).toBe(300);
    expect(queriedRepositoryIds).toStrictEqual(["repo-1", "repo-2", "repo-3"]);
    expect(maxActiveStarRequests).toBe(1);
  });

  it("should stop fetching when there are repos with zero stars", async () => {
    process.env.FETCH_MULTI_PAGE_STARS = "true";
    loadConfigFromEnv();
    const dataStatsWithZeroStars = structuredClone(data_stats);
    dataStatsWithZeroStars.data.user.repositories =
      data_repo_zero_stars.data.user.repositories;
    let repositoryPageRequests = 0;

    mock.reset();
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
      repositoryPageRequests++;
      return [200, dataStatsWithZeroStars];
    });

    let stats = await fetchStats("anuraghazra");
    const rank = calculateRank({
      all_commits: false,
      commits: 100,
      prs: 300,
      reviews: 50,
      issues: 200,
      repos: 5,
      stars: 300,
      followers: 100,
    });

    expect(stats).toStrictEqual({
      contributedTo: 61,
      name: "Anurag Hazra",
      totalCommits: 100,
      totalIssues: 200,
      totalPRs: 300,
      totalPRsMerged: 0,
      mergedPRsPercentage: 0,
      totalReviews: 50,
      totalStars: 300,
      totalDiscussionsStarted: 0,
      totalDiscussionsAnswered: 0,
      totalPRsAuthored: 0,
      totalPRsCommented: 0,
      totalPRsReviewed: 0,
      totalIssuesAuthored: 0,
      totalIssuesCommented: 0,
      rank,
    });
    expect(repositoryPageRequests).toBe(1);
  });

  it("should throw error", async () => {
    mock.reset();
    mock.onPost("https://api.github.com/graphql").reply(200, error);

    await expect(fetchStats("anuraghazra")).rejects.toThrow(
      "Could not resolve to a User with the login of 'noname'.",
    );
  });

  it("should fetch total commits", async () => {
    mock
      .onGet(
        "https://api.github.com/search/commits?per_page=1&q=author:anuraghazra",
      )
      .reply(200, { total_count: 1000 });

    let stats = await fetchStats("anuraghazra", true);
    const rank = calculateRank({
      all_commits: true,
      commits: 1000,
      prs: 300,
      reviews: 50,
      issues: 200,
      repos: 5,
      stars: 300,
      followers: 100,
    });

    expect(stats).toStrictEqual({
      contributedTo: 61,
      name: "Anurag Hazra",
      totalCommits: 1000,
      totalIssues: 200,
      totalPRs: 300,
      totalPRsMerged: 0,
      mergedPRsPercentage: 0,
      totalReviews: 50,
      totalStars: 300,
      totalDiscussionsStarted: 0,
      totalDiscussionsAnswered: 0,
      totalPRsAuthored: 0,
      totalPRsCommented: 0,
      totalPRsReviewed: 0,
      totalIssuesAuthored: 0,
      totalIssuesCommented: 0,
      rank,
    });
  });

  it("should throw specific error when include_all_commits true and invalid username", async () => {
    await expect(fetchStats("asdf///---", true)).rejects.toThrow(
      "Invalid username provided.",
    );
  });

  it("should throw specific error when include_all_commits true and API returns error", async () => {
    mock
      .onGet(
        "https://api.github.com/search/commits?per_page=1&q=author:anuraghazra",
      )
      .reply(200, { error: "Some test error message" });

    await expect(fetchStats("anuraghazra", true)).rejects.toThrow(
      "Could not fetch data from GitHub REST API.",
    );
  });

  it("should exclude stars of the `test-repo-1` repository", async () => {
    mock
      .onGet(
        "https://api.github.com/search/commits?per_page=1&q=author:anuraghazra",
      )
      .reply(200, { total_count: 1000 });

    let stats = await fetchStats("anuraghazra", true, ["test-repo-1"]);
    const rank = calculateRank({
      all_commits: true,
      commits: 1000,
      prs: 300,
      reviews: 50,
      issues: 200,
      repos: 5,
      stars: 200,
      followers: 100,
    });

    expect(stats).toStrictEqual({
      contributedTo: 61,
      name: "Anurag Hazra",
      totalCommits: 1000,
      totalIssues: 200,
      totalPRs: 300,
      totalPRsMerged: 0,
      mergedPRsPercentage: 0,
      totalReviews: 50,
      totalStars: 200,
      totalDiscussionsStarted: 0,
      totalDiscussionsAnswered: 0,
      totalPRsAuthored: 0,
      totalPRsCommented: 0,
      totalPRsReviewed: 0,
      totalIssuesAuthored: 0,
      totalIssuesCommented: 0,
      rank,
    });
  });

  it("should fetch two pages of stars if 'FETCH_MULTI_PAGE_STARS' env variable is set to `true`", async () => {
    process.env.FETCH_MULTI_PAGE_STARS = true;
    loadConfigFromEnv();

    let stats = await fetchStats("anuraghazra");
    const rank = calculateRank({
      all_commits: false,
      commits: 100,
      prs: 300,
      reviews: 50,
      issues: 200,
      repos: 5,
      stars: 400,
      followers: 100,
    });

    expect(stats).toStrictEqual({
      contributedTo: 61,
      name: "Anurag Hazra",
      totalCommits: 100,
      totalIssues: 200,
      totalPRs: 300,
      totalPRsMerged: 0,
      mergedPRsPercentage: 0,
      totalReviews: 50,
      totalStars: 400,
      totalDiscussionsStarted: 0,
      totalDiscussionsAnswered: 0,
      totalPRsAuthored: 0,
      totalPRsCommented: 0,
      totalPRsReviewed: 0,
      totalIssuesAuthored: 0,
      totalIssuesCommented: 0,
      rank,
    });
  });

  it("should fetch one page of stars if 'FETCH_MULTI_PAGE_STARS' env variable is set to `false`", async () => {
    process.env.FETCH_MULTI_PAGE_STARS = "false";
    loadConfigFromEnv();

    let stats = await fetchStats("anuraghazra");
    const rank = calculateRank({
      all_commits: false,
      commits: 100,
      prs: 300,
      reviews: 50,
      issues: 200,
      repos: 5,
      stars: 300,
      followers: 100,
    });

    expect(stats).toStrictEqual({
      contributedTo: 61,
      name: "Anurag Hazra",
      totalCommits: 100,
      totalIssues: 200,
      totalPRs: 300,
      totalPRsMerged: 0,
      mergedPRsPercentage: 0,
      totalReviews: 50,
      totalStars: 300,
      totalDiscussionsStarted: 0,
      totalDiscussionsAnswered: 0,
      totalPRsAuthored: 0,
      totalPRsCommented: 0,
      totalPRsReviewed: 0,
      totalIssuesAuthored: 0,
      totalIssuesCommented: 0,
      rank,
    });
  });

  it("should fetch one page of stars if 'FETCH_MULTI_PAGE_STARS' env variable is not set", async () => {
    process.env.FETCH_MULTI_PAGE_STARS = undefined;
    loadConfigFromEnv();

    let stats = await fetchStats("anuraghazra");
    const rank = calculateRank({
      all_commits: false,
      commits: 100,
      prs: 300,
      reviews: 50,
      issues: 200,
      repos: 5,
      stars: 300,
      followers: 100,
    });

    expect(stats).toStrictEqual({
      contributedTo: 61,
      name: "Anurag Hazra",
      totalCommits: 100,
      totalIssues: 200,
      totalPRs: 300,
      totalPRsMerged: 0,
      mergedPRsPercentage: 0,
      totalReviews: 50,
      totalStars: 300,
      totalDiscussionsStarted: 0,
      totalDiscussionsAnswered: 0,
      totalPRsAuthored: 0,
      totalPRsCommented: 0,
      totalPRsReviewed: 0,
      totalIssuesAuthored: 0,
      totalIssuesCommented: 0,
      rank,
    });
  });

  it("should not fetch additional stats data when it not requested", async () => {
    let stats = await fetchStats("anuraghazra");
    const rank = calculateRank({
      all_commits: false,
      commits: 100,
      prs: 300,
      reviews: 50,
      issues: 200,
      repos: 5,
      stars: 300,
      followers: 100,
    });

    expect(stats).toStrictEqual({
      contributedTo: 61,
      name: "Anurag Hazra",
      totalCommits: 100,
      totalIssues: 200,
      totalPRs: 300,
      totalPRsMerged: 0,
      mergedPRsPercentage: 0,
      totalReviews: 50,
      totalStars: 300,
      totalDiscussionsStarted: 0,
      totalDiscussionsAnswered: 0,
      totalPRsAuthored: 0,
      totalPRsCommented: 0,
      totalPRsReviewed: 0,
      totalIssuesAuthored: 0,
      totalIssuesCommented: 0,
      rank,
    });
  });

  it("should fetch additional stats when it requested", async () => {
    let stats = await fetchStats("anuraghazra", false, [], true, true, true);
    const rank = calculateRank({
      all_commits: false,
      commits: 100,
      prs: 300,
      reviews: 50,
      issues: 200,
      repos: 5,
      stars: 300,
      followers: 100,
    });

    expect(stats).toStrictEqual({
      contributedTo: 61,
      name: "Anurag Hazra",
      totalCommits: 100,
      totalIssues: 200,
      totalPRs: 300,
      totalPRsMerged: 240,
      mergedPRsPercentage: 80,
      totalReviews: 50,
      totalStars: 300,
      totalDiscussionsStarted: 10,
      totalDiscussionsAnswered: 40,
      totalPRsAuthored: 0,
      totalPRsCommented: 0,
      totalPRsReviewed: 0,
      totalIssuesAuthored: 0,
      totalIssuesCommented: 0,
      rank,
    });
  });

  it("should get commits of provided year", async () => {
    let stats = await fetchStats(
      "anuraghazra",
      false,
      [],
      false,
      false,
      false,
      2003,
    );

    const rank = calculateRank({
      all_commits: false,
      commits: 428,
      prs: 300,
      reviews: 50,
      issues: 200,
      repos: 5,
      stars: 300,
      followers: 100,
    });

    expect(stats).toStrictEqual({
      contributedTo: 61,
      name: "Anurag Hazra",
      totalCommits: 428,
      totalIssues: 200,
      totalPRs: 300,
      totalPRsMerged: 0,
      mergedPRsPercentage: 0,
      totalReviews: 50,
      totalStars: 300,
      totalDiscussionsStarted: 0,
      totalDiscussionsAnswered: 0,
      totalIssuesAuthored: 0,
      totalIssuesCommented: 0,
      totalPRsAuthored: 0,
      totalPRsCommented: 0,
      totalPRsReviewed: 0,
      rank,
    });
  });

  it("should return correct data when user don't have any pull requests", async () => {
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
      return [200, data_without_pull_requests];
    });
    const stats = await fetchStats("anuraghazra", false, [], true);
    const rank = calculateRank({
      all_commits: false,
      commits: 100,
      prs: 0,
      reviews: 50,
      issues: 200,
      repos: 5,
      stars: 300,
      followers: 100,
    });

    expect(stats).toStrictEqual({
      contributedTo: 61,
      name: "Anurag Hazra",
      totalCommits: 100,
      totalIssues: 200,
      totalPRs: 0,
      totalPRsMerged: 0,
      mergedPRsPercentage: 0,
      totalReviews: 50,
      totalStars: 300,
      totalDiscussionsStarted: 0,
      totalDiscussionsAnswered: 0,
      totalIssuesAuthored: 0,
      totalIssuesCommented: 0,
      totalPRsAuthored: 0,
      totalPRsCommented: 0,
      totalPRsReviewed: 0,
      rank,
    });
  });
});
