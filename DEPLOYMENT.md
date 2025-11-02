# Deployment Guide

This guide covers deploying the FlixQuest Scraper API to Vercel and Render.

## 📋 Prerequisites

Before deploying, make sure you have:

- A TMDB API key (get it from https://www.themoviedb.org/settings/api)
- A GitHub account (for both platforms)
- Your code pushed to a GitHub repository

## 🚀 Deploy to Vercel

### Option 1: Vercel CLI (Recommended)

1. **Install Vercel CLI:**

   ```bash
   npm i -g vercel
   ```

2. **Login to Vercel:**

   ```bash
   vercel login
   ```

3. **Deploy:**

   ```bash
   vercel
   ```

4. **Set Environment Variables:**

   ```bash
   vercel env add TMDB_API_KEY production
   ```

   Paste your TMDB API key when prompted.

5. **Deploy to Production:**
   ```bash
   vercel --prod
   ```

### Option 2: Vercel Dashboard

1. **Go to** https://vercel.com/new

2. **Import your GitHub repository**

3. **Configure Project:**

   - **Framework Preset:** Other
   - **Build Command:** `pnpm build`
   - **Output Directory:** `dist`
   - **Install Command:** `pnpm install`

4. **Add Environment Variables:**

   - Click "Environment Variables"
   - Add: `TMDB_API_KEY` = `your_api_key_here`
   - Environment: Production, Preview, Development

5. **Deploy!**

### Vercel Configuration

The `vercel.json` file is already configured:

```json
{
  "version": 2,
  "builds": [
    {
      "src": "dist/index.js",
      "use": "@vercel/node"
    }
  ],
  "routes": [
    {
      "src": "/(.*)",
      "dest": "dist/index.js"
    }
  ]
}
```

### Test Your Deployment

Once deployed, test with:

```bash
curl "https://your-app.vercel.app/stream-movie?tmdbId=556574"
```

---

## 🔵 Deploy to Render

### Option 1: Using render.yaml (Infrastructure as Code)

1. **Push your code to GitHub** (including `render.yaml`)

2. **Go to** https://dashboard.render.com/

3. **Click "New" → "Blueprint"**

4. **Connect your GitHub repository**

5. **Render will detect `render.yaml` automatically**

6. **Add Environment Variable:**

   - Go to your service settings
   - Add: `TMDB_API_KEY` = `your_api_key_here`

7. **Deploy!**

### Option 2: Manual Setup

1. **Go to** https://dashboard.render.com/

2. **Click "New" → "Web Service"**

3. **Connect your GitHub repository**

4. **Configure:**

   - **Name:** flixquest-scraper
   - **Region:** Oregon (US West)
   - **Branch:** main
   - **Root Directory:** (leave blank)
   - **Runtime:** Node
   - **Build Command:** `pnpm install && pnpm build`
   - **Start Command:** `pnpm start`
   - **Plan:** Free

5. **Add Environment Variables:**

   - `NODE_ENV` = `production`
   - `TMDB_API_KEY` = `your_api_key_here`

6. **Create Web Service**

### Render Configuration

The `render.yaml` file is already configured:

```yaml
services:
  - type: web
    name: flixquest-scraper
    env: node
    region: oregon
    plan: free
    buildCommand: pnpm install && pnpm build
    startCommand: pnpm start
    envVars:
      - key: TMDB_API_KEY
        sync: false
```

### Test Your Deployment

Once deployed, test with:

```bash
curl "https://flixquest-scraper.onrender.com/stream-movie?tmdbId=556574"
```

---

## 🔧 Post-Deployment Configuration

### Environment Variables Required

Both platforms need these environment variables:

| Variable       | Required    | Description           |
| -------------- | ----------- | --------------------- |
| `TMDB_API_KEY` | ✅ Yes      | Your TMDB API key     |
| `NODE_ENV`     | ⚠️ Optional | Set to `production`   |
| `PORT`         | ⚠️ Optional | Auto-set by platforms |

### Vercel Environment Variables

```bash
# Via CLI
vercel env add TMDB_API_KEY production

# Via Dashboard
1. Go to Project Settings
2. Click "Environment Variables"
3. Add TMDB_API_KEY
4. Select all environments
```

### Render Environment Variables

```bash
# Via Dashboard
1. Go to your service
2. Click "Environment"
3. Add "TMDB_API_KEY"
4. Click "Save Changes"
```

---

## 📊 Platform Comparison

| Feature                   | Vercel                  | Render                    |
| ------------------------- | ----------------------- | ------------------------- |
| **Free Tier**             | ✅ Generous             | ✅ Limited                |
| **Auto Deploy**           | ✅ Yes                  | ✅ Yes                    |
| **Custom Domain**         | ✅ Yes                  | ✅ Yes                    |
| **Environment Variables** | ✅ Easy                 | ✅ Easy                   |
| **Build Time**            | ⚡ Fast                 | 🐢 Slower                 |
| **Always On**             | ❌ Serverless           | ✅ Yes (free tier sleeps) |
| **Cold Starts**           | ⚡ Fast                 | 🐢 ~30s on free tier      |
| **Best For**              | Low latency, global CDN | Always-on services        |

---

## 🔍 Monitoring & Logs

### Vercel Logs

```bash
# Via CLI
vercel logs

# Via Dashboard
1. Go to your deployment
2. Click "Functions"
3. View logs in real-time
```

### Render Logs

```bash
# Via Dashboard
1. Go to your service
2. Click "Logs" tab
3. View logs in real-time
```

---

## 🐛 Troubleshooting

### Build Fails

**Issue:** "Cannot find module '@p-stream/providers'"
**Solution:** Make sure GitHub dependencies can be accessed. Check your repository is public or add SSH keys.

**Issue:** "TMDB_API_KEY is not configured"
**Solution:** Add the environment variable in your platform's dashboard.

**Issue:** "TypeScript compilation errors"
**Solution:** Run `pnpm build` locally first to catch errors.

### Runtime Errors

**Issue:** "Module not found" in production
**Solution:** Check that all dependencies are in `dependencies`, not `devDependencies`.

**Issue:** "Port already in use"
**Solution:** Platforms auto-assign ports. Your code uses `process.env.PORT || 3000` which is correct.

**Issue:** Cold starts are slow (Render)
**Solution:** Use a paid plan or keep your service warm with uptime monitoring.

---

## 🎯 Performance Tips

### 1. Enable Caching

Consider adding response caching for frequently requested content:

```typescript
app.use((req, res, next) => {
  res.set("Cache-Control", "public, max-age=300"); // 5 minutes
  next();
});
```

### 2. Add Request Rate Limiting

Install `express-rate-limit`:

```bash
pnpm add express-rate-limit
```

### 3. Monitor Performance

- Use Vercel Analytics
- Use Render's built-in metrics
- Consider adding Sentry for error tracking

---

## 🔐 Security Best Practices

### 1. Environment Variables

- ✅ Never commit `.env` files
- ✅ Use platform-specific environment variable management
- ✅ Rotate API keys regularly

### 2. Rate Limiting

Add rate limiting to prevent abuse:

```typescript
import rateLimit from "express-rate-limit";

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
});

app.use(limiter);
```

### 3. CORS Configuration

Add CORS if needed for browser clients:

```bash
pnpm add cors @types/cors
```

---

## 📚 Additional Resources

- **Vercel Docs:** https://vercel.com/docs
- **Render Docs:** https://render.com/docs
- **TMDB API Docs:** https://developers.themoviedb.org/3

---

## ✅ Deployment Checklist

Before deploying, make sure:

- [ ] Code is pushed to GitHub
- [ ] `.env` is in `.gitignore`
- [ ] `vercel.json` is configured (for Vercel)
- [ ] `render.yaml` is configured (for Render)
- [ ] TMDB API key is ready
- [ ] Project builds successfully locally (`pnpm build`)
- [ ] All tests pass (`tsx test.ts`)
- [ ] Environment variables are documented
- [ ] README is up to date

---

## 🎉 You're Ready to Deploy!

Choose your platform and follow the steps above. Both Vercel and Render offer excellent free tiers for getting started.

**Need help?** Check the troubleshooting section or open an issue on GitHub.
