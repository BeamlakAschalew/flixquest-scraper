# 🚀 Deployment Checklist

Use this checklist before deploying your FlixQuest Scraper API to production.

## Pre-Deployment Checklist

### 📝 Code Quality

- [ ] All TypeScript files compile without errors (`pnpm build`)
- [ ] No TypeScript errors in IDE
- [ ] All imports are correct (no `.js` extensions with current config)
- [ ] Code is properly formatted
- [ ] No console.errors or debug code left in production

### 🔧 Configuration Files

- [ ] `package.json` has correct `main` field pointing to `dist/index.js`
- [ ] `package.json` has `engines` field specifying Node version
- [ ] `tsconfig.json` is properly configured
- [ ] `vercel.json` exists (for Vercel deployment)
- [ ] `render.yaml` exists (for Render deployment)
- [ ] `Procfile` exists (for Heroku/Railway)
- [ ] `.nvmrc` exists with correct Node version
- [ ] `.gitignore` includes `node_modules`, `dist`, `.env`

### 🔐 Environment Variables

- [ ] `.env.example` is up to date
- [ ] `.env` is in `.gitignore`
- [ ] TMDB API key is obtained
- [ ] All required environment variables are documented
- [ ] Environment variables are set on deployment platform

### 📦 Dependencies

- [ ] All dependencies are in correct section (dependencies vs devDependencies)
- [ ] TypeScript and build tools are in devDependencies
- [ ] Runtime dependencies are in dependencies
- [ ] No unused dependencies
- [ ] Package versions are locked (using pnpm-lock.yaml)

### 🧪 Testing

- [ ] API endpoints tested locally
- [ ] `/stream-movie` endpoint works
- [ ] `/stream-tv` endpoint works
- [ ] `/sources` endpoint returns data
- [ ] `/embeds` endpoint returns data
- [ ] Error handling works correctly
- [ ] Test script runs successfully (`tsx test.ts`)

### 📚 Documentation

- [ ] README.md is complete and accurate
- [ ] API endpoints are documented
- [ ] Environment variables are documented
- [ ] Deployment instructions are clear
- [ ] Examples are working and up to date

### 🔒 Security

- [ ] API keys are not hardcoded
- [ ] `.env` file is not committed
- [ ] Sensitive data is not logged
- [ ] CORS is configured if needed
- [ ] Rate limiting is considered (optional but recommended)

### 🌐 Git & GitHub

- [ ] All changes are committed
- [ ] Code is pushed to GitHub
- [ ] Repository is public or accessible by deployment platform
- [ ] Branch is up to date with remote
- [ ] No merge conflicts

## Platform-Specific Checklists

### Vercel Deployment

- [ ] `vercel.json` is configured correctly
- [ ] Build command is set: `pnpm build`
- [ ] Output directory is set: `dist`
- [ ] Start command uses `dist/index.js`
- [ ] Environment variables are set in Vercel dashboard
- [ ] Project is linked to GitHub repository
- [ ] Auto-deployments are configured (optional)

### Render Deployment

- [ ] `render.yaml` is configured correctly
- [ ] Build command: `pnpm install && pnpm build`
- [ ] Start command: `pnpm start`
- [ ] Environment variables are set in Render dashboard
- [ ] Service region is selected
- [ ] Health check path is set to `/`
- [ ] Free tier limitations are understood

### Netlify Deployment (Bonus)

- [ ] `netlify.toml` is configured
- [ ] Functions are properly configured
- [ ] Build command is correct
- [ ] Environment variables are set

### Railway/Heroku Deployment (Alternative)

- [ ] `Procfile` exists
- [ ] Start command is correct
- [ ] Port is dynamically assigned from `process.env.PORT`
- [ ] Node version is specified

## Post-Deployment Checklist

### ✅ Verification

- [ ] Deployment completed successfully
- [ ] No build errors in deployment logs
- [ ] Application starts without errors
- [ ] Health check endpoint (`/`) returns 200
- [ ] Test movie endpoint works
- [ ] Test TV endpoint works
- [ ] Response times are acceptable
- [ ] Error responses are formatted correctly

### 📊 Monitoring

- [ ] Deployment URL is accessible
- [ ] API endpoints respond correctly
- [ ] Logs are accessible in platform dashboard
- [ ] No critical errors in logs
- [ ] Performance metrics look good

### 🔍 Testing in Production

```bash
# Replace YOUR_DOMAIN with your actual deployment URL

# Health check
curl https://YOUR_DOMAIN/

# Test movie endpoint
curl "https://YOUR_DOMAIN/stream-movie?tmdbId=556574"

# Test TV endpoint
curl "https://YOUR_DOMAIN/stream-tv?tmdbId=2316&season=1&episode=1"

# Test sources
curl https://YOUR_DOMAIN/sources

# Test embeds
curl https://YOUR_DOMAIN/embeds
```

### 📝 Documentation Updates

- [ ] README updated with production URL
- [ ] API documentation reflects production behavior
- [ ] Known issues are documented
- [ ] Support contact is provided

### 🎯 Optional Enhancements

- [ ] Custom domain configured
- [ ] SSL/HTTPS is working
- [ ] CDN is configured (if applicable)
- [ ] Rate limiting is implemented
- [ ] Caching strategy is in place
- [ ] Monitoring/alerting is set up (Sentry, etc.)
- [ ] Analytics are configured
- [ ] API documentation site (Swagger/OpenAPI)

## Troubleshooting Checklist

If deployment fails, check:

- [ ] Build logs for errors
- [ ] Environment variables are set correctly
- [ ] Node version matches local development
- [ ] All dependencies are installed
- [ ] TypeScript compiles successfully
- [ ] Port is correctly using `process.env.PORT`
- [ ] File paths are correct (case-sensitive on Linux)
- [ ] GitHub repository is accessible

## Environment Variables to Set

| Variable       | Platform       | Required       | Example           |
| -------------- | -------------- | -------------- | ----------------- |
| `TMDB_API_KEY` | All            | ✅ Yes         | `abc123def456...` |
| `NODE_ENV`     | All            | ⚠️ Recommended | `production`      |
| `PORT`         | Render/Railway | ✅ Auto-set    | `10000`           |

## Quick Deploy Commands

### Vercel

```bash
vercel --prod
```

### Render

```bash
# Deploys via GitHub push or dashboard
git push origin main
```

### Netlify

```bash
netlify deploy --prod
```

## Success Criteria

Your deployment is successful when:

- ✅ Build completes without errors
- ✅ Application starts and listens on correct port
- ✅ Health check endpoint returns 200
- ✅ All API endpoints are accessible
- ✅ TMDB integration works (metadata fetching)
- ✅ Stream scraping returns valid results
- ✅ Error handling works as expected
- ✅ No critical errors in logs

## Final Notes

- Remember to keep your TMDB API key secure
- Monitor your API usage to stay within rate limits
- Consider implementing caching for production
- Set up monitoring and alerts for downtime
- Keep dependencies updated regularly
- Back up your environment variables

---

**Ready to deploy?** Choose your platform and follow the [DEPLOYMENT.md](DEPLOYMENT.md) guide!

🎉 **Good luck with your deployment!**
