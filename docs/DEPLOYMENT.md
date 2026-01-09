# ChronoSnap Deployment Guide

## Overview

This guide covers deploying ChronoSnap's backend API to Vercel so your Tauri photobooth app can connect to a remote server for payments and data management.

## Architecture

```
┌─────────────────────────────────────┐
│         Tauri App (Kiosk)           │
│  - Runs locally on photobooth       │
│  - Contains all UI/camera logic     │
│  - Calls remote API for backend     │
└──────────────────┬──────────────────┘
                   │ HTTPS
                   ↓
┌─────────────────────────────────────┐
│           Vercel (API)              │
│  - /api/frames                      │
│  - /api/payment/create              │
│  - /api/payment/status              │
│  - /api/payment/webhook (Xendit)    │
│  - /api/auth/booth-login            │
└──────────────────┬──────────────────┘
                   │
                   ↓
┌─────────────────────────────────────┐
│           Supabase                  │
│  - Database (PostgreSQL)            │
│  - Storage (photos/frames)          │
└─────────────────────────────────────┘
```

---

## Step 1: Prepare for Deployment

### 1.1 Install Vercel CLI

```bash
npm install -g vercel
```

### 1.2 Login to Vercel

```bash
vercel login
```

---

## Step 2: Deploy to Vercel

### 2.1 Initial Deployment

From your project root:

```bash
vercel
```

Follow the prompts:
- Set up and deploy? **Yes**
- Which scope? **Your account**
- Link to existing project? **No**
- Project name? **chronosnap** (or your choice)
- Directory with code? **./** (current directory)
- Override settings? **No**

### 2.2 Set Environment Variables

In Vercel Dashboard (https://vercel.com/dashboard):

1. Go to your project
2. Click **Settings** → **Environment Variables**
3. Add these variables for **Production**:

| Variable | Value | Notes |
|----------|-------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://xxx.supabase.co` | From Supabase dashboard |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Your anon key | From Supabase dashboard |
| `SUPABASE_SERVICE_ROLE_KEY` | Your service role key | Keep secret! |
| `XENDIT_SECRET_KEY` | `xnd_production_xxx` | From Xendit dashboard |
| `XENDIT_WEBHOOK_TOKEN` | Your callback token | From Xendit webhook settings |
| `ADMIN_PIN` | Your secure PIN | e.g., `8472` |
| `JWT_SECRET` | 32+ char secret | Generate: `openssl rand -base64 32` |

### 2.3 Deploy Production

```bash
vercel --prod
```

Your API is now live at: `https://your-project.vercel.app`

---

## Step 3: Configure Xendit Webhook

1. Go to [Xendit Dashboard](https://dashboard.xendit.co/) → **Settings** → **Developers** → **Callbacks**

2. Add callback URL:
   ```
   https://your-project.vercel.app/api/payment/webhook
   ```

3. Copy the **Callback Verification Token** and add to Vercel environment variables as `XENDIT_WEBHOOK_TOKEN`

---

## Step 4: Configure Tauri App

### Option A: Build for Production

Update your local `.env.local` to point to the deployed API:

```env
NEXT_PUBLIC_API_URL=https://your-project.vercel.app
```

Then build the Tauri app:

```bash
npm run tauri:build
```

### Option B: Development with Remote API

For testing locally with the production API:

```env
# .env.local
NEXT_PUBLIC_API_URL=https://your-project.vercel.app
```

---

## Environment Variable Summary

### Vercel (Production API)

All backend secrets go here:

```env
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=xxx
SUPABASE_SERVICE_ROLE_KEY=xxx
XENDIT_SECRET_KEY=xnd_production_xxx
XENDIT_WEBHOOK_TOKEN=xxx
ADMIN_PIN=xxx
JWT_SECRET=xxx
# NEXT_PUBLIC_API_URL is NOT needed on the API server itself
```

### Tauri App (Local Machine)

Only needs the API URL:

```env
NEXT_PUBLIC_API_URL=https://your-project.vercel.app
```

---

## Troubleshooting

### CORS Errors

The `vercel.json` includes CORS headers. If you still get errors:
1. Check that the Tauri app is using `credentials: 'include'` in fetch calls
2. Verify the API URL doesn't have a trailing slash

### Cookie Issues

Cookies require same-site or proper CORS configuration. If auth fails:
1. Ensure the API is on HTTPS
2. Try using `SameSite=None; Secure` in cookie settings (already configured)

### Webhook Not Working

1. Verify webhook URL in Xendit dashboard
2. Check Vercel function logs for errors
3. Ensure `XENDIT_WEBHOOK_TOKEN` matches Xendit's callback token

---

## Cost Estimate

| Service | Tier | Cost |
|---------|------|------|
| Vercel | Hobby (Free) | $0/month |
| Supabase | Free tier | $0/month |
| Xendit | Pay per transaction | ~1.5% per transaction |

**Total monthly cost: $0** (plus Xendit fees per transaction)

---

## Updating the Deployment

After code changes:

```bash
# Deploy to preview
vercel

# Deploy to production
vercel --prod
```

---

## Security Checklist

- [ ] Use strong `ADMIN_PIN` (not 1234)
- [ ] Generate secure `JWT_SECRET` (32+ characters)
- [ ] Never commit `.env.local` to git
- [ ] Use production Xendit keys in production
- [ ] Enable Supabase RLS policies
- [ ] Test webhook with Xendit's test mode first
