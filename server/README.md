# Generic CORS Proxy Server

A simple Node.js proxy server to bypass CORS and Referer header restrictions when accessing web services and tile servers.

## Features

- **Generic proxy endpoint** - Works with any URL, not just specific services
- **Custom Referer headers** - Bypass Referer-based restrictions
- **CORS enabled** - Full CORS support for browser requests
- **Caching** - Configurable cache duration for responses
- **Health check** - Monitor server status and configuration

## Use Cases

- Accessing ISRO Bhuvan satellite imagery tiles
- Bypassing CORS restrictions on web services
- Proxying tile requests with custom headers
- Any HTTP resource that requires specific headers

## Local Development

### Prerequisites
- Node.js 18 or higher

### Setup

1. Install dependencies:
```bash
cd server
npm install
```

2. Start the server:
```bash
npm start
```

The proxy will run on `http://localhost:8080`

3. Test it:
```bash
curl http://localhost:8080/health
```

### API Endpoints

#### `/proxy` - Generic proxy endpoint

Fetches any URL with custom headers and CORS support.

**Parameters:**
- `url` (required) - Target URL to fetch
- `referer` (optional) - Custom Referer header (defaults to target origin)
- `cache` (optional) - Cache duration in seconds (default: 3600)

**Examples:**
```bash
# Simple proxy request
curl "http://localhost:8080/proxy?url=https://example.com/image.jpg"

# With custom Referer
curl "http://localhost:8080/proxy?url=https://api.example.com/data&referer=https://example.com/"

# With custom cache duration
curl "http://localhost:8080/proxy?url=https://api.example.com/live-data&cache=60"
```

**Usage in layer configs:**
```json
{
  "id": "bhuvan-satellite",
  "type": "raster",
  "url": "https://your-proxy.railway.app/proxy?url=https://bhuvan.nrsc.gov.in/tile/{z}/{x}/{y}.png&referer=https://bhuvan.nrsc.gov.in/"
}
```

#### `/health` - Health check endpoint

Returns server status and API documentation.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2026-01-20T12:00:00.000Z",
  "endpoint": "/proxy",
  "parameters": { ... },
  "examples": { ... }
}
```

## Deployment

### Current Production Deployment

The proxy is deployed on Railway at:
```
https://amche-atlas-production.up.railway.app
```

**Test it:**
```bash
curl "https://amche-atlas-production.up.railway.app/health"
```

### Deploy Your Own Instance

#### Option 1: Railway (Recommended)

Railway automatically detects and deploys the server when you push to GitHub.

1. Install Railway CLI:
```bash
npm install -g @railway/cli
```

2. Login and link to your project:
```bash
railway login
railway link
```

3. Deploy:
```bash
railway up
```

4. Get your deployment URL:
```bash
railway domain
```

The server uses `railway.json` for configuration:
```json
{
  "build": { "builder": "NIXPACKS" },
  "deploy": {
    "startCommand": "node server.js",
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 10
  }
}
```

#### Option 2: Render (Free Tier)

1. Push code to GitHub
2. Go to https://render.com
3. Click "New +" → "Web Service"
4. Connect your GitHub repo
5. Configure:
   - **Root Directory**: `server`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Plan**: Free

#### Option 3: Local with ngrok (Testing)

1. Start the proxy locally:
```bash
npm start
```

2. Install and run ngrok:
```bash
ngrok http 8080
```

3. Use the ngrok URL in your layer configs

## Environment Variables

- `PORT` - Server port (default: 8080)

Set in Railway dashboard or your deployment platform.

## Layer Configuration Examples

### Bhuvan Satellite Imagery
```json
{
  "id": "bhuvan-satellite",
  "type": "raster",
  "tiles": [
    "https://amche-atlas-production.up.railway.app/proxy?url=https://bhuvan.nrsc.gov.in/tile/{z}/{x}/{y}.png&referer=https://bhuvan.nrsc.gov.in/"
  ]
}
```

### Generic WMS Service
```json
{
  "id": "custom-wms",
  "type": "raster",
  "tiles": [
    "https://amche-atlas-production.up.railway.app/proxy?url=https://example.com/wms?bbox={bbox}&width=256&height=256&cache=3600"
  ]
}
```

## Monitoring and Logs

View Railway logs:
```bash
railway logs
```

Or visit the Railway dashboard to monitor:
- Request volume
- Error rates
- Response times
- Resource usage

## Security and Best Practices

- **Public data only**: Designed for accessing public web services
- **Rate limiting**: Consider implementing rate limiting for production
- **Monitor usage**: Stay within free tier limits (Railway: 500 hours/month)
- **CORS headers**: Automatically set for browser compatibility
- **Cache headers**: Reduces redundant requests and improves performance
- **Error handling**: Returns appropriate HTTP status codes

## Troubleshooting

**Server not responding:**
```bash
# Check health endpoint
curl https://amche-atlas-production.up.railway.app/health

# Check Railway status
railway status
```

**CORS errors:**
- Verify the proxy URL is correct
- Check browser console for specific error messages
- Ensure `Access-Control-Allow-Origin` is set in response headers

**Slow responses:**
- Increase cache duration with `?cache=7200`
- Check Railway resource usage
- Consider upgrading Railway plan for better performance

## Development Workflow

1. Make changes to `server.js`
2. Test locally: `npm start`
3. Commit and push to GitHub
4. Railway automatically deploys
5. Monitor logs: `railway logs`

## License

Same as parent project (amche-atlas)
