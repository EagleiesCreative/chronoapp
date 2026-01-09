---
description: How to run ChronoSnap photobooth application
---

# Running ChronoSnap

## Development Mode (Web)

// turbo
1. Start the Next.js development server:
```bash
cd /Users/christinaindahsetiyorini/Documents/Eagleies\ Creative/chronoapp && npm run dev
```

2. Open http://localhost:3000 in your browser

## Development Mode (Desktop with Tauri)

1. Make sure Rust is installed and configured
// turbo
2. Run Tauri development mode:
```bash
cd /Users/christinaindahsetiyorini/Documents/Eagleies\ Creative/chronoapp && npm run tauri:dev
```

## Production Build

// turbo
1. Build the Next.js application:
```bash
cd /Users/christinaindahsetiyorini/Documents/Eagleies\ Creative/chronoapp && npm run build
```

2. Build the Tauri desktop application:
```bash
cd /Users/christinaindahsetiyorini/Documents/Eagleies\ Creative/chronoapp && npm run tauri:build
```

## Admin Access

- Press `Ctrl+Shift+A` to open the admin panel from the booth
- Or navigate to http://localhost:3000/admin for the full admin dashboard

## Configuration

Before running, make sure to:
1. Create `.env.local` with your Supabase and Xendit credentials
2. Set up the Supabase database tables (see README.md for SQL)
3. Create the `photos` storage bucket in Supabase
