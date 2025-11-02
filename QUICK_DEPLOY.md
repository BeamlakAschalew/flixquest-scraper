# ⚡ Quick Deploy Reference

## 🚀 One-Command Deploys

### Vercel

```bash
npx vercel --prod
```

### Netlify

```bash
npx netlify-cli deploy --prod
```

### Render / Heroku / Railway

```bash
git push origin main
```

## 🔑 Required Environment Variable

```
TMDB_API_KEY=your_key_here
```

Get your key: https://www.themoviedb.org/settings/api

## 📁 Deployment Files Created

- `vercel.json` - Vercel config
- `render.yaml` - Render config
- `netlify.toml` - Netlify config
- `Procfile` - Heroku/Railway
- `.nvmrc` - Node version (18)
- `.github/workflows/ci.yml` - CI/CD

## ✅ Pre-Deploy Checklist

```bash
# 1. Build locally
pnpm build

# 2. Commit and push
git add .
git commit -m "ready for deployment"
git push origin main

# 3. Set environment variable on platform
# 4. Deploy!
```

## 🧪 Test Endpoints

Replace `YOUR_URL` with deployment URL:

```bash
# Health
curl YOUR_URL/

# Movie (Hamilton)
curl "YOUR_URL/stream-movie?tmdbId=556574"

# TV (The Office S1E1)
curl "YOUR_URL/stream-tv?tmdbId=2316&season=1&episode=1"
```

## 📊 Platform Quick Links

- **Vercel**: https://vercel.com/new
- **Render**: https://dashboard.render.com
- **Netlify**: https://app.netlify.com/start
- **Railway**: https://railway.app/new

## 🆘 Quick Troubleshooting

**Build fails?**

- Run `pnpm build` locally first
- Check Node version matches (18+)

**TMDB errors?**

- Verify `TMDB_API_KEY` is set
- Check key is valid

**Port errors?**

- Code uses `process.env.PORT` ✅
- Platform auto-assigns port

## 📚 Full Guides

- [DEPLOYMENT.md](DEPLOYMENT.md) - Complete guide
- [DEPLOYMENT_READY.md](DEPLOYMENT_READY.md) - What's included
- [DEPLOYMENT_CHECKLIST.md](DEPLOYMENT_CHECKLIST.md) - Full checklist

---

**Need help?** Check [DEPLOYMENT.md](DEPLOYMENT.md) for detailed instructions!
