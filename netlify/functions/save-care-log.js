const DEFAULT_REPO = "panday1995/donki-care";
const DEFAULT_BRANCH = "main";
const DATA_PATH = "data/care-log.json";

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type",
    },
    body: JSON.stringify(body),
  };
}

function decodeBase64(content) {
  return Buffer.from(content || "", "base64").toString("utf8");
}

function encodeBase64(content) {
  return Buffer.from(content, "utf8").toString("base64");
}

function normaliseEntry(raw) {
  const entry = raw && typeof raw === "object" ? raw : {};
  const dates = entry.dates && typeof entry.dates === "object" ? entry.dates : {};

  return {
    submitted_at: new Date().toISOString(),
    source: "donki-care-page",
    dates: {
      "2026-06-26": {
        morning_pee: String(dates["2026-06-26"]?.morning_pee || "").slice(0, 80),
        evening_pee: String(dates["2026-06-26"]?.evening_pee || "").slice(0, 80),
        prednisolone_given: Boolean(dates["2026-06-26"]?.prednisolone_given),
      },
      "2026-06-27": {
        morning_pee: String(dates["2026-06-27"]?.morning_pee || "").slice(0, 80),
        evening_pee: String(dates["2026-06-27"]?.evening_pee || "").slice(0, 80),
        prednisolone_given: Boolean(dates["2026-06-27"]?.prednisolone_given),
      },
    },
    notes: String(entry.notes || "").slice(0, 1000),
  };
}

async function githubRequest(path, options = {}) {
  const token = process.env.DONKI_GITHUB_TOKEN || process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error("Missing DONKI_GITHUB_TOKEN or GITHUB_TOKEN environment variable.");
  }

  const response = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "x-github-api-version": "2022-11-28",
      ...(options.headers || {}),
    },
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(payload?.message || `GitHub API request failed with ${response.status}`);
  }
  return payload;
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return json(204, {});
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  const repo = process.env.DONKI_GITHUB_REPO || DEFAULT_REPO;
  const branch = process.env.DONKI_GITHUB_BRANCH || DEFAULT_BRANCH;
  const encodedPath = DATA_PATH.split("/").map(encodeURIComponent).join("/");

  try {
    const incoming = JSON.parse(event.body || "{}");
    const newEntry = normaliseEntry(incoming);

    let current = { entries: [] };
    let sha = null;
    try {
      const file = await githubRequest(`/repos/${repo}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`);
      sha = file.sha;
      current = JSON.parse(decodeBase64(file.content));
      if (!Array.isArray(current.entries)) current.entries = [];
    } catch (error) {
      if (!String(error.message).includes("Not Found")) throw error;
    }

    current.entries.push(newEntry);
    const nextContent = JSON.stringify(current, null, 2) + "\n";

    await githubRequest(`/repos/${repo}/contents/${encodedPath}`, {
      method: "PUT",
      body: JSON.stringify({
        message: `Add Donki care log ${newEntry.submitted_at}`,
        content: encodeBase64(nextContent),
        sha: sha || undefined,
        branch,
      }),
    });

    return json(200, { ok: true, entry: newEntry });
  } catch (error) {
    return json(500, { ok: false, error: error.message });
  }
};
