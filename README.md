# Utah Graphic Design Jobs Board

A lightweight website that shows **current Utah graphic design job postings** and filters for roles that are **non-degree dependent**.

## What it does

- Pulls live jobs from Adzuna on the backend
- Filters to Utah + graphic design-related titles
- Excludes listings that explicitly require a degree
- Refreshes automatically every 15 minutes
- Lets you manually refresh at any time

## Setup

1. Copy `.env.example` to `.env`
2. Add your Adzuna credentials:
   - `ADZUNA_APP_ID`
   - `ADZUNA_APP_KEY`
3. Start the app:

```bash
npm start
```

4. Open `http://localhost:3000`

## Notes

- Results are cached for 15 minutes to avoid hitting rate limits.
- If no jobs are shown, either there were no matches at that moment or your API credentials are missing/invalid.
