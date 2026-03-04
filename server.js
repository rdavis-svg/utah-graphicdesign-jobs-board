import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, 'public');

const DEGREE_REQUIRED_PATTERNS = [
  /bachelor'?s degree/i,
  /bs degree/i,
  /ba degree/i,
  /master'?s degree/i,
  /degree required/i,
  /college degree/i,
  /four-year degree/i
];

const NON_DEGREE_PATTERNS = [
  /no degree required/i,
  /degree not required/i,
  /self-taught/i,
  /portfolio required/i,
  /equivalent experience/i,
  /experience in lieu of degree/i
];

const DEGREE_PREFERRED_PATTERNS = [
  /degree preferred/i,
  /bachelor'?s preferred/i,
  /college preferred/i
];

const TARGET_ROLE_TERMS = [
  'graphic designer',
  'junior graphic designer',
  'motion designer',
  'production artist',
  'production designer',
  'layout artist',
  'digital illustrator',
  'marketing designer',
  'multimedia designer',
  'visual artist',
  'prepress',
  'marketing coordinator',
  'content designer'
];

const ROLE_MATCH_PATTERN =
  /graphic designer|junior graphic designer|motion designer|production artist|production designer|layout artist|digital illustrator|marketing designer|multimedia designer|visual artist|prepress|marketing coordinator|content designer|graphic design|brand designer|visual designer|creative designer/i;
const BROAD_MATCH_PATTERN = /design|designer|illustrat|creative|marketing|production|brand|layout|motion|multimedia|prepress/i;

const SEARCH_PAGE_COUNT = Number(process.env.SEARCH_PAGE_COUNT || '3');
const SEARCH_MAX_DAYS_OLD = Number(process.env.SEARCH_MAX_DAYS_OLD || '30');
const CACHE_TTL_MS = 30 * 60 * 1000;

const cacheByMode = {
  strict: { jobs: [], fetchedAt: null, expiresAt: 0 },
  broad: { jobs: [], fetchedAt: null, expiresAt: 0 }
};

function parseEnvFile(raw) {
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    env[key] = value;
  }
  return env;
}

async function loadLocalEnv() {
  try {
    const raw = await fs.readFile(path.join(__dirname, '.env'), 'utf8');
    const values = parseEnvFile(raw);
    for (const [k, v] of Object.entries(values)) {
      if (!process.env[k]) process.env[k] = v;
    }
  } catch {
    // .env is optional
  }
}

function toJSON(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store'
  });
  res.end(payload);
}

function isStaticAsset(p) {
  return p.startsWith('/assets/') || p.endsWith('.css') || p.endsWith('.js') || p.endsWith('.png') || p.endsWith('.svg');
}

async function serveStatic(reqPath, res) {
  const safePath = reqPath === '/' ? '/index.html' : reqPath;
  const normalized = path.normalize(safePath).replace(/^\.\.(\/|\\|$)/, '');
  const filePath = path.join(PUBLIC_DIR, normalized);

  try {
    const file = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const contentType = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.png': 'image/png',
      '.svg': 'image/svg+xml'
    }[ext] || 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': isStaticAsset(reqPath) ? 'public, max-age=300' : 'no-cache'
    });
    res.end(file);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }
}

function classifyDegreeRequirement(description = '') {
  const matchesDegreeRequired = DEGREE_REQUIRED_PATTERNS.some((pattern) => pattern.test(description));
  const matchesNonDegreeSignal = NON_DEGREE_PATTERNS.some((pattern) => pattern.test(description));
  const matchesDegreePreferred = DEGREE_PREFERRED_PATTERNS.some((pattern) => pattern.test(description));

  if (matchesNonDegreeSignal) return 'non-degree-friendly';
  if (matchesDegreeRequired) return 'degree-required';
  if (matchesDegreePreferred) return 'degree-preferred';
  return 'not-specified';
}

function normalizeJob(job, degreeSignal) {
  return {
    id: job.id,
    title: job.title,
    company: job.company?.display_name || 'Unknown company',
    location: job.location?.display_name || 'Utah',
    salary: job.salary_is_predicted === '1' ? 'Salary estimate only' : formatSalary(job.salary_min, job.salary_max),
    contractType: job.contract_type || 'not-specified',
    contractTime: job.contract_time || 'not-specified',
    created: job.created,
    description: (job.description || '').replace(/\s+/g, ' ').trim(),
    degreeSignal,
    redirectUrl: job.redirect_url
  };
}

function formatSalary(min, max) {
  if (!min && !max) return 'Not listed';
  const dollars = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0
  });
  if (min && max) return `${dollars.format(min)} - ${dollars.format(max)}`;
  return dollars.format(min || max);
}

async function fetchAdzunaJobs(mode = 'strict') {
  const appId = process.env.ADZUNA_APP_ID;
  const appKey = process.env.ADZUNA_APP_KEY;
  const isBroadMode = mode === 'broad';

  if (!appId || !appKey) {
    throw new Error('ADZUNA_APP_ID and ADZUNA_APP_KEY are required.');
  }

  const strictKeywords = [
    'graphic designer',
    'motion designer',
    'production artist',
    'layout artist',
    'digital illustrator',
    'marketing designer'
  ];
  const broadKeywords = ['designer', 'graphic', 'creative'];
  const keywords = isBroadMode ? broadKeywords : strictKeywords;

  const payloads = [];
  for (const keyword of keywords) {
    const pages = [1];
    for (const page of pages) {
      const url = new URL(`https://api.adzuna.com/v1/api/jobs/us/search/${page}`);
      url.searchParams.set('app_id', appId);
      url.searchParams.set('app_key', appKey);
      url.searchParams.set('what', keyword);
      url.searchParams.set('where', 'Utah');
      url.searchParams.set('results_per_page', '50');
      url.searchParams.set('max_days_old', String(isBroadMode ? 90 : SEARCH_MAX_DAYS_OLD));
      url.searchParams.set('content-type', 'application/json');

      const response = await fetch(url);
      if (!response.ok) {
        const retryAfter = response.headers.get('retry-after');
        const error = new Error(`Adzuna request failed with ${response.status} ${response.statusText}`);
        error.status = response.status;
        error.retryAfter = retryAfter;
        throw error;
      }

      payloads.push(await response.json());
    }
  }

  const seen = new Set();
  const jobs = [];
  let rawCount = 0;

  for (const payload of payloads) {
    for (const result of payload.results || []) {
      rawCount += 1;
      if (seen.has(result.id)) continue;
      seen.add(result.id);

      const description = result.description || '';
      const title = result.title || '';
      const searchableText = `${title} ${description}`;
      const matches = isBroadMode ? BROAD_MATCH_PATTERN.test(searchableText) : ROLE_MATCH_PATTERN.test(searchableText);
      if (!matches) continue;

      const degreeSignal = classifyDegreeRequirement(description);
      jobs.push(normalizeJob(result, degreeSignal));
    }
  }

  const rank = {
    'non-degree-friendly': 0,
    'not-specified': 1,
    'degree-preferred': 2,
    'degree-required': 3
  };

  jobs.sort((a, b) => {
    const rankDiff = (rank[a.degreeSignal] ?? 99) - (rank[b.degreeSignal] ?? 99);
    if (rankDiff !== 0) return rankDiff;
    return new Date(b.created) - new Date(a.created);
  });
  return {
    jobs,
    matchMode: mode,
    diagnostics: {
      keywords,
      rawCount,
      uniqueCount: seen.size,
      filteredCount: jobs.length
    }
  };
}

async function getJobs(mode = 'strict') {
  const selectedMode = mode === 'broad' ? 'broad' : 'strict';
  const modeCache = cacheByMode[selectedMode];
  const now = Date.now();
  if (modeCache.expiresAt > now && modeCache.jobs.length > 0) {
    return {
      jobs: modeCache.jobs,
      fetchedAt: modeCache.fetchedAt,
      source: 'cache',
      matchMode: selectedMode
    };
  }

  try {
    const result = await fetchAdzunaJobs(selectedMode);
    modeCache.jobs = result.jobs;
    modeCache.fetchedAt = new Date().toISOString();
    modeCache.expiresAt = now + CACHE_TTL_MS;

    return {
      jobs: result.jobs,
      fetchedAt: modeCache.fetchedAt,
      source: 'live',
      matchMode: result.matchMode,
      diagnostics: result.diagnostics
    };
  } catch (error) {
    if (modeCache.jobs.length > 0) {
      return {
        jobs: modeCache.jobs,
        fetchedAt: modeCache.fetchedAt,
        source: 'stale-cache',
        matchMode: selectedMode,
        diagnostics: {
          cache: true,
          filteredCount: modeCache.jobs.length
        }
      };
    }
    throw error;
  }
}

function routeRequest(req, res) {
  const url = new URL(req.url || '/', 'http://localhost');

  if (req.method === 'GET' && url.pathname === '/api/jobs') {
    const mode = url.searchParams.get('mode') === 'broad' ? 'broad' : 'strict';
    getJobs(mode)
      .then(({ jobs, fetchedAt, source, matchMode, diagnostics }) => {
        toJSON(res, 200, {
          jobs,
          count: jobs.length,
          fetchedAt,
          source,
          matchMode,
          diagnostics,
          filters: {
            title: mode === 'broad' ? 'broadened design/creative terms' : TARGET_ROLE_TERMS.join(' | '),
            location: 'Utah',
            nonDegree: 'soft (shows more results, labels degree requirements)'
          }
        });
      })
      .catch((error) => {
        const retryAfterHint =
          error.status === 429
            ? `Adzuna rate limit reached. Try again in ${error.retryAfter || 'a few minutes'}.`
            : undefined;
        toJSON(res, 500, {
          error: error.message,
          retryAfter: error.retryAfter || null,
          hint: retryAfterHint || 'Create a .env from .env.example with valid Adzuna credentials.'
        });
      });
    return;
  }

  if (req.method === 'GET') {
    serveStatic(url.pathname, res);
    return;
  }

  res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Method not allowed');
}

await loadLocalEnv();

const port = Number(process.env.PORT || '3000');
const server = http.createServer(routeRequest);

server.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
