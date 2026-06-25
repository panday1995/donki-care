const DEFAULT_REPO = "panday1995/donki-care";
const DEFAULT_BRANCH = "main";
const DATA_PATH = "data/care-log.json";

function send(res, statusCode, body) {
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "POST, OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type");
  res.status(statusCode).send(JSON.stringify(body));
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

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") return send(res, 204, {});
  if (req.method !== "POST") return send(res, 405, { error: "Method not allowed" });

  const repo = process.env.DONKI_GITHUB_REPO || DEFAULT_REPO;
  const branch = process.env.DONKI_GITHUB_BRANCH || DEFAULT_BRANCH;
  const encodedPath = DATA_PATH.split("/").map(encodeURIComponent).join("/");

  try {
    const incoming = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
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

    return send(res, 200, { ok: true, entry: newEntry });
  } catch (error) {
    return send(res, 500, { ok: false, error: error.message });
  }
};
