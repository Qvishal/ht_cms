# Docker Compose Update for Caching Infrastructure

## Add Redis and Varnish to Existing docker-compose.yml

---

## Current Setup (Database Only)

If your `docker-compose.yml` looks like this:

```yaml
version: '3.8'

services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_PASSWORD: "${DB_PASSWORD:-postgres}"
      POSTGRES_DB: "ht_cms"
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data

volumes:
  postgres_data:
```

---

## Updated Setup: Add Redis

```yaml
version: '3.8'

services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_PASSWORD: "${DB_PASSWORD:-postgres}"
      POSTGRES_DB: "ht_cms"
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    networks:
      - ht-cms-network
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 10s
      timeout: 5s
      retries: 5

  # ✨ NEW: Redis for caching
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    networks:
      - ht-cms-network
    # Persistence
    volumes:
      - redis_data:/data
    # Optimization
    command: redis-server --maxmemory 256mb --maxmemory-policy allkeys-lru
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  postgres_data:
  redis_data:

networks:
  ht-cms-network:
    driver: bridge
```

---

## Full Setup: Add Redis + Varnish (Optional)

For production-grade caching:

```yaml
version: '3.8'

services:
  postgres:
    image: postgres:16-alpine
    container_name: ht-cms-postgres
    environment:
      POSTGRES_PASSWORD: "${DB_PASSWORD:-postgres}"
      POSTGRES_DB: "${DB_NAME:-ht_cms}"
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    networks:
      - ht-cms-network
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    container_name: ht-cms-redis
    ports:
      - "6379:6379"
    networks:
      - ht-cms-network
    volumes:
      - redis_data:/data
    command: >
      redis-server
      --maxmemory 256mb
      --maxmemory-policy allkeys-lru
      --appendonly yes
      --appendfsync everysec
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped

  # Optional: Varnish for edge caching
  varnish:
    image: varnish:latest
    container_name: ht-cms-varnish
    ports:
      - "6081:80"
    networks:
      - ht-cms-network
    volumes:
      - ./config/varnish.vcl:/etc/varnish/default.vcl:ro
    environment:
      VARNISH_CONFIG: /etc/varnish/default.vcl
      VARNISH_BACKEND_ADDRESS: backend:4000
      VARNISH_BACKEND_PORT: "4000"
    command: varnishd -f /etc/varnish/default.vcl -s malloc,256M -a 0.0.0.0:80
    depends_on:
      - backend
    restart: unless-stopped

  backend:
    build:
      context: ./backend
      dockerfile: Dockerfile
    container_name: ht-cms-backend
    environment:
      DATABASE_URL: "postgresql://postgres:${DB_PASSWORD:-postgres}@postgres:5432/ht_cms"
      REDIS_HOST: "redis"
      REDIS_PORT: "6379"
      REDIS_URL: "redis://redis:6379"
      VARNISH_HOST: "${VARNISH_HOST:-varnish:6081}"
      CACHE_STRATEGY: "${CACHE_STRATEGY:-HYBRID}"
      NODE_ENV: "${NODE_ENV:-development}"
    ports:
      - "4000:4000"
    networks:
      - ht-cms-network
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    restart: unless-stopped

  frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile
    container_name: ht-cms-frontend
    ports:
      - "3000:3000"
    environment:
      NEXT_PUBLIC_API_URL: "http://localhost:4000"
    networks:
      - ht-cms-network
    depends_on:
      - backend
    restart: unless-stopped

volumes:
  postgres_data:
  redis_data:

networks:
  ht-cms-network:
    driver: bridge
```

---

## Minimal Setup (Redis Only, No Varnish)

For development with just Redis:

```yaml
version: '3.8'

services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: ht_cms
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    networks:
      - ht-cms-network

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    networks:
      - ht-cms-network
    volumes:
      - redis_data:/data
    command: redis-server --maxmemory 256mb --maxmemory-policy allkeys-lru

volumes:
  postgres_data:
  redis_data:

networks:
  ht-cms-network:
    driver: bridge
```

---

## Backend Dockerfile Example

Create `backend/Dockerfile`:

```dockerfile
FROM oven/bun:latest as base
WORKDIR /app

# Copy package files
COPY package.json bun.lockb* ./

# Install dependencies
RUN bun install

# Copy source
COPY . .

# Expose port
EXPOSE 4000

# Start app
CMD ["bun", "run", "start"]
```

---

## Environment Variables (.env)

Create `.env` file in project root:

```bash
# Database
DB_PASSWORD=postgres
DB_NAME=ht_cms
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ht_cms

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_URL=redis://localhost:6379

# Varnish (optional)
VARNISH_ENABLED=true
VARNISH_HOST=localhost:6081

# Cache Strategy
CACHE_STRATEGY=HYBRID  # HYBRID | REDIS_ONLY | DISABLED
CACHE_PUBLIC_ONLY=true

# Runtime
NODE_ENV=development
JWT_SECRET=your-secret-key-here
```

---

## Docker Commands

### Start All Services

```bash
# Start with docker-compose
docker-compose up -d

# Verify services are running
docker-compose ps

# Expected output:
# NAME                COMMAND                  SERVICE      STATUS      PORTS
# ht-cms-postgres     postgres                 postgres     Up 2 sec    5432/tcp
# ht-cms-redis        redis-server ...         redis        Up 2 sec    6379/tcp
# ht-cms-varnish      varnishd ...             varnish      Up 2 sec    6081/tcp
# ht-cms-backend      bun src/index.ts         backend      Up 2 sec    4000/tcp
# ht-cms-frontend     npm start                frontend     Up 2 sec    3000/tcp
```

### View Logs

```bash
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f redis
docker-compose logs -f backend
docker-compose logs -f postgres

# Last 100 lines
docker-compose logs --tail 100 backend
```

### Stop Services

```bash
# Stop all (keeps volumes)
docker-compose stop

# Stop and remove (keeps volumes)
docker-compose down

# Stop, remove, AND delete volumes
docker-compose down -v
```

### Interactive Access

```bash
# Access Redis CLI
docker-compose exec redis redis-cli

# Access PostgreSQL
docker-compose exec postgres psql -U postgres -d ht_cms

# Access backend bash
docker-compose exec backend bash

# Check Redis memory
docker-compose exec redis redis-cli info memory

# Check Redis keys
docker-compose exec redis redis-cli KEYS "*"
```

---

## Production Optimization

### Use `.env.production`

```bash
# Larger Redis memory for production
VARNISH_BACKEND_ADDRESS=backend
VARNISH_BACKEND_PORT=4000
CACHE_STRATEGY=HYBRID
REDIS_MEMORY=512mb  # Increased from 256mb
```

### Optimized docker-compose for Production

```yaml
version: '3.8'

services:
  redis:
    image: redis:7-alpine
    command: >
      redis-server
      --maxmemory 512mb
      --maxmemory-policy allkeys-lru
      --appendonly yes
      --appendfsync everysec
      --save 900 1
      --save 300 10
      --save 60 10000
    volumes:
      - redis_data:/data
    # Add backup volume
    networks:
      - ht-cms-network
    restart: always

  # Enable Redis replication for HA (optional)
  redis-replica:
    image: redis:7-alpine
    command: redis-server --slaveof redis 6379
    depends_on:
      - redis
    networks:
      - ht-cms-network
    restart: always
```

---

## Monitoring and Debugging

### Redis Performance

```bash
# Enter Redis container
docker-compose exec redis redis-cli

# Inside redis-cli:
> INFO stats
> INFO memory
> KEYS *
> FLUSHDB  # Warning: clears all cache!
> DBSIZE
> MONITOR  # Live stream of commands
```

### Varnish Performance

```bash
# Enter Varnish container (if running)
docker-compose exec varnish varnishstat -1

# Watch cache performance
docker-compose exec varnish varnishadm "stats"
```

### Database Size

```bash
# Check PostgreSQL database size
docker-compose exec postgres psql -U postgres -d ht_cms -c "\l+"

# Check table sizes
docker-compose exec postgres psql -U postgres -d ht_cms -c "\dt+ public.*"
```

---

## Troubleshooting

### Redis Connection Failed

```bash
# Check if Redis is running
docker-compose ps redis

# Check Redis logs
docker-compose logs redis

# Test connection from backend
docker-compose exec backend redis-cli -h redis ping
# Should return: PONG
```

### Varnish Not Working

```bash
# Check Varnish logs
docker-compose logs varnish

# Test cache manually
curl -v http://localhost:6081/api/public/products

# Check Varnish stats
docker-compose exec varnish varnishstat -1 | grep -i cache
```

### Out of Memory

```bash
# Check Redis memory usage
docker-compose exec redis redis-cli info memory | grep used_memory_human

# Increase in docker-compose.yml
command: redis-server --maxmemory 1gb --maxmemory-policy allkeys-lru
```

---

## Integration with Existing Stack

### If Already Running Locally

Stop local services:

```bash
# Stop local Redis (if running)
redis-cli shutdown

# Kill local Node process
pkill -f "bun run start"
```

Then use docker-compose to manage everything.

### If Using Different Port

Update `.env`:

```bash
# Use different port if 6379 is taken
REDIS_PORT=6380

# Update docker-compose.yml
ports:
  - "6380:6379"
```

---

## Health Checks

Verify all services are healthy:

```bash
# PostgreSQL
docker-compose exec postgres pg_isready -U postgres

# Redis
docker-compose exec redis redis-cli ping

# Backend
curl http://localhost:4000/health

# Varnish (if running)
curl -v http://localhost:6081/
```

---

## Backup and Recovery

### Backup Redis

```bash
# Create backup
docker-compose exec redis redis-cli BGSAVE

# Copy backup from container
docker cp ht-cms-redis:/data/dump.rdb ./backups/redis-$(date +%s).rdb
```

### Backup PostgreSQL

```bash
# Create backup
docker-compose exec postgres pg_dump -U postgres ht_cms > backup.sql

# Alternative: full backup with compression
docker-compose exec postgres pg_dump -U postgres ht_cms | gzip > backup.sql.gz
```

---

## Next Steps

1. **Update your docker-compose.yml** with Redis section
2. **Create backend/Dockerfile** if not exists
3. **Set up .env** file with configuration
4. **Run `docker-compose up -d`**
5. **Verify services**: `docker-compose ps`
6. **Check logs**: `docker-compose logs -f`
7. **Test Redis**: `docker-compose exec redis redis-cli ping`
8. **Deploy caching code** using CACHE_IMPLEMENTATION_PATCHES.md
