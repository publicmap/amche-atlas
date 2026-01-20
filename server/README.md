# Bhuvan Tile Proxy

A simple Node.js proxy server to bypass Referer header restrictions when accessing ISRO Bhuvan satellite imagery tiles.

## Problem

Bhuvan's tile servers check the `Referer` header and only serve tiles to whitelisted domains. Since browsers prevent JavaScript from modifying the `Referer` header, we need a backend proxy.

## Solution

This proxy server:
- Receives tile requests from your frontend
- Forwards them to Bhuvan servers with the correct `Referer` header
- Returns the tile images with appropriate CORS headers

## Local Development

### Prerequisites
- Node.js 18 or higher

### Setup

1. Install dependencies:
```bash
cd proxy
npm install
```

2. Start the server:
```bash
npm start
```

The proxy will run on `http://localhost:3000`

3. Test it:
```bash
curl http://localhost:3000/health
```

### Usage

The proxy exposes two endpoints:

**WMS Tiles** (via TileCache):
```
http://localhost:3000/bhuvan/tilecache/tilecache.py?service=WMS&...
```

**Direct Cache Tiles**:
```
http://localhost:3000/bhuvan-cache/cachebcg/bhuvan_img/17/000/184/789/000/076/823.jpeg
```

## Deployment Options

### Option 1: Railway (Recommended - Free Tier Available)

1. Install Railway CLI:
```bash
npm install -g @railway/cli
```

2. Login and deploy:
```bash
railway login
railway init
railway up
```

3. Get your deployment URL:
```bash
railway domain
```

### Option 2: Render (Free Tier Available)

1. Push this code to GitHub
2. Go to https://render.com
3. Click "New +" → "Web Service"
4. Connect your GitHub repo
5. Configure:
   - **Root Directory**: `proxy`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Plan**: Free

### Option 3: Vercel (Serverless)

Create `proxy/vercel.json`:
```json
{
  "version": 2,
  "builds": [{ "src": "server.js", "use": "@vercel/node" }],
  "routes": [{ "src": "/(.*)", "dest": "/server.js" }]
}
```

Deploy:
```bash
cd proxy
vercel
```

### Option 4: Local with ngrok (Testing)

1. Start the proxy locally
2. Install ngrok: https://ngrok.com/download
3. Expose it:
```bash
ngrok http 3000
```

Use the ngrok URL (e.g., `https://abc123.ngrok.io`) in your layer configs.

## Updating Layer Configs

Once deployed, update your layer URLs in `config/india.atlas.json`:

```json
{
  "id": "bhuvan-satellite",
  "type": "wms",
  "url": "https://your-proxy-url.com/bhuvan/tilecache/tilecache.py?service=WMS&version=1.1.1&request=GetMap&layers=bhuvan_ocm_wbase&styles=&format=image/png&transparent=true"
}
```

## Security Notes

- This proxy is designed for accessing public Bhuvan data
- Consider adding rate limiting for production use
- Monitor your proxy usage to stay within free tier limits
- The `Referer` header is set to match Bhuvan's official apps

## License

Same as parent project
