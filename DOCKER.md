# 🐳 Docker Setup Guide

This guide will help you run DocGenius using Docker.

## Prerequisites

- Docker installed ([Get Docker](https://docs.docker.com/get-docker/))
- Docker Compose installed (included with Docker Desktop)

## Quick Start

### 1. Clone the repository
```bash
git clone https://github.com/Matheo93/claudelike.git
cd claudelike
```

### 2. Create environment file
```bash
cp .env.example .env
```

Edit `.env` and add your API keys:
- `DEEPSEEK_API_KEY` - Get from [DeepSeek Platform](https://platform.deepseek.com/api_keys)
- `RESEND_API_KEY` - Get from [Resend Dashboard](https://resend.com/api-keys)
- `OPENAI_API_KEY` - (Optional) Get from [OpenAI Platform](https://platform.openai.com/api-keys)

### 3. Build and run with Docker Compose
```bash
docker-compose up -d
```

The application will be available at: **http://localhost:3001**

## Docker Commands

### Build the image
```bash
docker build -t docgenius .
```

### Run the container
```bash
docker run -d \
  -p 3001:3001 \
  --env-file .env \
  --name docgenius-app \
  docgenius
```

### View logs
```bash
docker-compose logs -f
```

### Stop the application
```bash
docker-compose down
```

### Restart the application
```bash
docker-compose restart
```

### Rebuild after code changes
```bash
docker-compose up -d --build
```

## Health Check

Check if the application is healthy:
```bash
curl http://localhost:3001/health
```

Expected response:
```json
{
  "status": "healthy",
  "uptime": 123.45,
  "timestamp": 1234567890,
  "environment": "production"
}
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `NODE_ENV` | No | Environment (`production` or `development`) |
| `PORT` | No | Port to run on (default: 3001) |
| `DEEPSEEK_API_KEY` | Yes | DeepSeek AI API key for report generation |
| `RESEND_API_KEY` | Yes | Resend API key for email notifications |
| `OPENAI_API_KEY` | No | OpenAI API key (for future features) |

## Production Deployment

### Deploy to Railway (Recommended)

Railway automatically detects the Dockerfile and builds the image.

1. Connect your GitHub repository to Railway
2. Add environment variables in Railway dashboard
3. Deploy!

Railway will:
- Build the Docker image
- Run health checks
- Auto-scale based on traffic
- Provide HTTPS domain

### Deploy to other platforms

The Dockerfile works with:
- **Fly.io** - `fly launch`
- **Render** - Auto-detects Dockerfile
- **DigitalOcean App Platform** - Select Docker
- **AWS ECS/Fargate** - Use ECR for image registry
- **Google Cloud Run** - Deploy from source

## Troubleshooting

### Container won't start
```bash
# Check logs
docker logs docgenius-app

# Check if port 3001 is already in use
lsof -i :3001
```

### Out of memory errors
Increase Docker memory limit in Docker Desktop settings.

### Puppeteer/Chrome errors
The Dockerfile includes all required dependencies for Puppeteer. If you still have issues:
```bash
# Rebuild with --no-cache
docker-compose build --no-cache
```

## Development

For development with hot-reload, use nodemon:
```bash
# Install dependencies locally
npm install

# Run with nodemon (not Docker)
npm run dev
```

## License

MIT License - see LICENSE file for details
