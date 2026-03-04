const jobsList = document.getElementById('jobs');
const countEl = document.getElementById('job-count');
const updatedEl = document.getElementById('last-updated');
const refreshBtn = document.getElementById('refresh-button');
const jobTemplate = document.getElementById('job-template');

function formatDate(dateValue) {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return 'Unknown date';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  }).format(date);
}

function formatDateTime(dateValue) {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return 'Unknown update time';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(date);
}

function modeLabel(mode) {
  const labels = {
    strict: 'Exact roles',
    relaxed: 'Related design roles',
    'relaxed-fallback': 'Broadened fallback',
    cached: 'Cached results'
  };
  return labels[mode] || 'Search results';
}

function summarize(text, max = 240) {
  if (!text) return 'No description provided.';
  if (text.length <= max) return text;
  return `${text.slice(0, max).trim()}...`;
}

function degreeSignalLabel(value) {
  const labels = {
    'non-degree-friendly': 'No degree required / experience accepted',
    'degree-preferred': 'Degree preferred',
    'degree-required': 'Degree required',
    'not-specified': 'Degree requirement not specified'
  };
  return labels[value] || labels['not-specified'];
}

function renderError(message) {
  jobsList.innerHTML = `<li class="error">${message}</li>`;
}

function renderJobs(jobs) {
  jobsList.innerHTML = '';

  if (jobs.length === 0) {
    renderError('No Utah design postings found right now. Try Refresh in a few minutes.');
    return;
  }

  const fragment = document.createDocumentFragment();

  for (const job of jobs) {
    const node = jobTemplate.content.cloneNode(true);
    node.querySelector('.title').textContent = job.title;
    node.querySelector('.company').textContent = job.company;
    node.querySelector('.meta').textContent = `${job.location} | Posted ${formatDate(job.created)} | ${job.contractTime}`;
    node.querySelector('.degree').textContent = `Education: ${degreeSignalLabel(job.degreeSignal)}`;
    node.querySelector('.salary').textContent = `Salary: ${job.salary}`;
    node.querySelector('.description').textContent = summarize(job.description);

    const link = node.querySelector('.apply-link');
    link.href = job.redirectUrl;

    fragment.appendChild(node);
  }

  jobsList.appendChild(fragment);
}

async function loadJobs() {
  countEl.textContent = 'Refreshing jobs...';

  try {
    const response = await fetch(`/api/jobs?ts=${Date.now()}`);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Unable to load jobs');
    }

    renderJobs(data.jobs || []);
    countEl.textContent = `${data.count} current postings found (${modeLabel(data.matchMode)})`;
    updatedEl.textContent = `Last updated: ${formatDateTime(data.fetchedAt)} (${data.source})`;
  } catch (error) {
    renderError(`Could not load jobs: ${error.message}`);
    countEl.textContent = 'Could not load postings';
    updatedEl.textContent = 'Last updated: unavailable';
  }
}

refreshBtn.addEventListener('click', () => {
  loadJobs();
});

loadJobs();
setInterval(loadJobs, 30 * 60 * 1000);
