# Production Infrastructure Requirements

This document specifies the infrastructure required to deploy the Queue Management System to production.

## Overview

The Queue Management System follows a **stateless, horizontally scalable** architecture. The production infrastructure must provide:

1. **PostgreSQL 16+** database
2. **Redis 7+** cache/session store
3. **Node.js 20+** runtime
4. **Reverse proxy** (nginx or equivalent)
5. **SSL/TLS certificates**
6. **Monitoring & logging**
7. **Backup & disaster recovery**

## Infrastructure Topology

```
┌────────────────────┐
│   Users / Clients  │
└────────────┬───────┘
             │
      ┌──────┴──────────┐
      │                 │
      ▼                 ▼
   ┌──────┐         ┌──────┐
   │HTTPS │         │HTTPS │
   │  80  │         │ 443  │
   └──┬───┘         └──┬───┘
      │                │
      └────────┬───────┘
               │
         ┌─────▼──────┐
         │   Nginx    │
         │   (SSL     │
         │  Termination)
         └─────┬──────┘
               │
        ┌──────┴──────────┐
        │                 │
        ▼                 ▼
     ┌─────┐           ┌─────┐
     │ API │  ┌─────┐  │ Web │
     │:4000│  │     │  │:3000│
     └─────┘  │     │  └─────┘
              │     │
         ┌────▼─────▼────┐
         │                │
         ▼                ▼
      ┌───────┐      ┌────────┐
      │  PG   │      │ Redis  │
      │:5432  │      │ :6379  │
      └───────┘      └────────┘
```

## Compute Requirements

### API Server (NestJS)

**Single Instance**:
- CPU: 2 cores minimum
- RAM: 1 GB minimum
- Disk: 10 GB (SSD recommended for logs)

**Scaling to 3 instances**:
- CPU: 6 cores total
- RAM: 3 GB total
- Disk: 30 GB total

**⚠️ Multi-Instance Note**: When scaling to multiple API instances:
1. SSE pub/sub must be moved to Redis (currently process-local)
2. Rate limiting must use Redis backend (currently in-memory)
3. Session handling must use Redis (if needed)
4. Load balancer configuration required

### Web Server (Next.js)

**Single Instance**:
- CPU: 1 core minimum
- RAM: 512 MB minimum
- Disk: 10 GB (SSD recommended)

**Scaling to 3 instances**:
- CPU: 3 cores total
- RAM: 1.5 GB total
- Disk: 30 GB total

### Database (PostgreSQL 16+)

**Development/Small**:
- CPU: 2 cores
- RAM: 2 GB
- Storage: 50 GB SSD (high IOPS)

**Production/Medium**:
- CPU: 4+ cores
- RAM: 8+ GB
- Storage: 200+ GB SSD (high IOPS)

**Production/Large**:
- CPU: 8+ cores (or RDS with burstable CPU)
- RAM: 16+ GB
- Storage: 1+ TB SSD (high IOPS)

**Features Required**:
- ✓ SSL/TLS support
- ✓ Automated backups (point-in-time recovery)
- ✓ Connection pooling (PgBouncer or equivalent)
- ✓ Replication (for high availability)
- ✓ WAL archiving (for disaster recovery)

### Cache (Redis 7+)

**Development**:
- Memory: 256 MB
- Persistence: Optional

**Production**:
- Memory: 2+ GB
- Persistence: AOF (Append-Only File) enabled
- Replication: Enabled (for failover)

**Options**:
1. Redis standalone with persistence
2. Redis Sentinel for high availability
3. Redis Cluster for horizontal scaling
4. Managed service (AWS ElastiCache, Azure Cache, GCP Memorystore)

## Database Services

### PostgreSQL Provisioning Options

#### 1. Managed Services (Recommended for Production)

**AWS RDS PostgreSQL**
```
Type: PostgreSQL 16 or later
Class: db.t3.medium minimum (2 vCPU, 4 GB RAM)
Multi-AZ: Enabled (high availability)
Automated Backups: 30 days retention
Monitoring: Enhanced monitoring enabled
Encryption: AWS KMS encryption at rest
SSL: Enforced for all connections
Cost: ~$0.50/hour ($365/month)
```

**Azure Database for PostgreSQL**
```
Tier: General Purpose
vCores: 2 minimum
Storage: 32 GB minimum, auto-scale to 1 TB
Backup: Geo-redundant
SSL/TLS: Enforced
Availability: 99.99% SLA
Cost: ~$0.40/hour ($292/month)
```

**Google Cloud SQL PostgreSQL**
```
Machine Type: db-custom-2-7680 (2 vCPU, 7.5 GB RAM)
Backup: Automated daily + on-demand
High Availability: Multi-region
SSL: Enforced
Monitoring: Integrated with Cloud Monitoring
Cost: ~$0.35/hour ($256/month)
```

#### 2. Self-Hosted PostgreSQL

**VPS Requirements**:
```
OS: Ubuntu 22.04 LTS or RHEL 8+
CPU: 4+ cores
RAM: 8+ GB
Storage: 200+ GB SSD (io1/gp3)
Network: Private subnet with security groups
Backup: EBS snapshots + WAL archiving to S3/blob storage
```

**High Availability Setup**:
- Primary + Standby replication
- Streaming replication with WAL archiving
- Automated failover using pg_auto_failover or Patroni

### Redis Provisioning Options

#### 1. Managed Services (Recommended)

**AWS ElastiCache for Redis**
```
Engine: Redis 7.0+
Node Type: cache.t3.micro (minimal) to cache.r6g.xlarge (production)
Number of Nodes: 2 (primary + replica)
Automatic Failover: Enabled
Encryption at Rest: KMS
Encryption in Transit: TLS
Backup: Automated daily snapshots
Retention: 35 days
Cost: ~$0.15/hour ($109/month) for cache.t3.micro
```

**Azure Cache for Redis**
```
Tier: Basic 250 MB to Standard 25 GB (production)
High Availability: Premium tier with replication
Encryption: At rest (AES-256)
SSL/TLS: Required
Persistence: RDB or AOF
Cost: ~$0.10/hour ($73/month) for Basic tier
```

#### 2. Self-Hosted Redis

**Docker Container** (in docker-compose.prod.yml):
```yaml
redis:
  image: redis:7-alpine
  restart: always
  command: >
    redis-server
    --appendonly yes
    --requirepass [STRONG_PASSWORD]
    --maxmemory 2gb
    --maxmemory-policy allkeys-lru
  volumes:
    - redis_data:/data
  healthcheck:
    test: ["CMD", "redis-cli", "ping"]
    interval: 10s
    timeout: 5s
    retries: 5
```

**Standalone Server**:
```
OS: Ubuntu 22.04 LTS
CPU: 2+ cores
RAM: 4+ GB (with 2+ GB allocated to Redis)
Storage: 50 GB SSD (for AOF persistence)
Backup: Automated RDB snapshots to S3/blob storage
```

## Reverse Proxy Configuration

### Nginx (Recommended)

**Basic Production Setup**:

```nginx
# /etc/nginx/nginx.conf

worker_processes auto;
worker_connections 2048;

upstream api {
  least_conn;
  server 127.0.0.1:4000 max_fails=3 fail_timeout=30s;
  server 127.0.0.1:4001 max_fails=3 fail_timeout=30s;  # If scaling
}

upstream web {
  least_conn;
  server 127.0.0.1:3000 max_fails=3 fail_timeout=30s;
  server 127.0.0.1:3001 max_fails=3 fail_timeout=30s;  # If scaling
}

server {
  listen 80;
  server_name example.com api.example.com www.example.com;
  
  # Redirect HTTP to HTTPS
  location / {
    return 301 https://$server_name$request_uri;
  }
}

server {
  listen 443 ssl http2;
  server_name example.com www.example.com;

  ssl_certificate /etc/nginx/ssl/cert.pem;
  ssl_certificate_key /etc/nginx/ssl/key.pem;
  ssl_protocols TLSv1.2 TLSv1.3;
  ssl_ciphers HIGH:!aNULL:!MD5;
  ssl_prefer_server_ciphers on;
  ssl_session_cache shared:SSL:10m;
  ssl_session_timeout 10m;

  # HSTS Header
  add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

  # Root location
  location / {
    proxy_pass http://web;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}

server {
  listen 443 ssl http2;
  server_name api.example.com;

  ssl_certificate /etc/nginx/ssl/cert.pem;
  ssl_certificate_key /etc/nginx/ssl/key.pem;
  ssl_protocols TLSv1.2 TLSv1.3;
  ssl_ciphers HIGH:!aNULL:!MD5;

  # API routes
  location / {
    proxy_pass http://api;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    
    # For SSE support
    proxy_buffering off;
    proxy_request_buffering off;
    proxy_set_header Connection "";
    proxy_http_version 1.1;
    
    # Timeouts for long-lived connections
    proxy_connect_timeout 60s;
    proxy_send_timeout 3600s;
    proxy_read_timeout 3600s;
  }
}
```

### HAProxy Alternative

```haproxy
# /etc/haproxy/haproxy.cfg

global
  log stdout local0
  maxconn 4096

defaults
  log global
  mode http
  timeout connect 5000
  timeout client 50000
  timeout server 50000

frontend http_in
  bind *:80
  default_backend http_redirect

backend http_redirect
  redirect scheme https code 301

frontend https_in
  bind *:443 ssl crt /etc/haproxy/ssl/cert.pem
  acl is_api hdr(host) -i api.example.com
  acl is_web hdr(host) -i example.com www.example.com
  
  use_backend api_servers if is_api
  use_backend web_servers if is_web
  default_backend web_servers

backend api_servers
  mode http
  balance leastconn
  option httpchk GET /health/live
  server api1 127.0.0.1:4000 check
  server api2 127.0.0.1:4001 check

backend web_servers
  mode http
  balance roundrobin
  option httpchk GET /
  server web1 127.0.0.1:3000 check
  server web2 127.0.0.1:3001 check
```

## SSL/TLS Certificate Provisioning

### Let's Encrypt (Recommended)

**Installation** (on proxy server):
```bash
# Ubuntu/Debian
apt-get install certbot python3-certbot-nginx

# Generate certificate
certbot certonly --webroot -w /var/www/letsencrypt \
  -d example.com -d www.example.com -d api.example.com

# Auto-renewal (automatic with systemd timer)
systemctl enable certbot-renewal.timer
```

**Certificate Renewal**:
```bash
# Manual renewal
certbot renew

# Nginx reload after renewal (add hook)
certbot renew --nginx
```

**Cost**: FREE (limit 50 certificates/domain per week)

### Self-Signed (Testing Only)

```bash
# Generate self-signed certificate (2-year validity)
openssl req -x509 -newkey rsa:4096 -keyout key.pem \
  -out cert.pem -days 730 -nodes \
  -subj "/C=US/ST=State/L=City/O=Org/CN=example.com"
```

**⚠️ WARNING**: Self-signed certificates cause browser warnings and are NOT suitable for production.

### Commercial Certificates

- DigiCert, Comodo, GlobalSign, etc.
- Cost: $50-300/year
- Support for wildcards
- Organization validation

## Domain & DNS Configuration

### DNS Records Required

```dns
# A Record - Point domain to server
example.com          A    1.1.1.1

# A Record - Point API subdomain
api.example.com      A    1.1.1.1

# A Record - Point www subdomain  
www.example.com      A    1.1.1.1

# AAAA Record (IPv6) - Optional
example.com          AAAA 2001:0db8:85a3::8a2e:0370:7334

# MX Record (if sending email)
example.com          MX   10  mail.example.com

# TXT Record (DKIM, SPF, DMARC - if needed)
example.com          TXT  "v=spf1 include:provider.com ~all"
```

### TTL Recommendations

- During setup: TTL=300 (5 minutes) for quick propagation
- After verification: TTL=3600 (1 hour) for cache efficiency
- Never use TTL=0 in production

## Monitoring & Logging Infrastructure

### Required Monitoring

1. **Application Performance Monitoring (APM)**
   - Response times
   - Error rates
   - Transaction tracing

2. **Infrastructure Monitoring**
   - CPU, Memory, Disk usage
   - Network I/O
   - Container metrics

3. **Database Monitoring**
   - Query performance
   - Connection count
   - Lock waits

4. **Logging**
   - Application logs (JSON)
   - Reverse proxy logs
   - System logs

### Recommended Logging Solutions

**AWS CloudWatch**
```
Cost: ~$0.50 per GB ingested
Retention: Configurable (1 month to 15 years)
Integration: Native AWS services
Features: Log Insights, alarms, dashboards
```

**Datadog**
```
Cost: ~$15/host/month
Retention: 15 days (free tier)
Features: APM, infrastructure monitoring, dashboards
Integration: 500+ integrations
```

**ELK Stack (Self-Hosted)**
```
Cost: Infrastructure only (no licensing)
Retention: User-configured
Features: Full customization
Maintenance: Operator responsibility
```

**Grafana + Prometheus**
```
Cost: Open source (self-hosted)
Retention: User-configured
Features: Highly customizable dashboards
Maintenance: Operator responsibility
```

## Backup & Disaster Recovery

### Database Backups

**Automated Backups**:
- Frequency: Daily, 4-hour RPO (Recovery Point Objective)
- Retention: 30 days minimum
- Location: Off-site (different region/account)
- Encryption: AES-256 at rest

**Backup Strategy**:
1. **Automated daily full backups** via managed service
2. **Continuous WAL archiving** to S3/blob storage
3. **Point-in-time recovery** capability
4. **Monthly restore test** to verify backup integrity

**Verification**:
```bash
# Test restore procedure monthly (on staging)
pg_restore -d test_database backup_file.dump

# Verify data integrity
SELECT COUNT(*) FROM organizations;  # Must match production
SELECT COUNT(*) FROM users;
SELECT COUNT(*) FROM queues;
```

### Application Deployment Backups

**Docker Image Versioning**:
```bash
# Tag images with date and commit hash
docker build -t api:2026-08-10-abc1234 .
docker build -t web:2026-08-10-abc1234 .

# Push to registry
docker push api:2026-08-10-abc1234
docker push web:2026-08-10-abc1234

# Keep last 10 versions available for rollback
```

### Configuration Backups

```bash
# Backup .env files (in secure location, NOT git)
gpg --encrypt --recipient [key-id] .env.production

# Backup reverse proxy configuration
tar czf nginx-backup-$(date +%Y%m%d).tar.gz /etc/nginx/
```

## High Availability Considerations

### Single Region Deployment

```
┌─────────────────────┐
│   Load Balancer     │
│    (Nginx/HA)       │
└────────┬────────────┘
         │
    ┌────┴──────┐
    │            │
  API-1        API-2
    │            │
    └────┬───────┘
         │
    ┌────┴─────────────┐
    │                  │
 PostgreSQL         Redis
 (Primary+          (Primary+
  Standby)          Replica)
```

**Configuration**:
- 2-3 API instances behind load balancer
- 2-3 Web instances behind load balancer
- PostgreSQL with streaming replication + automatic failover
- Redis with replication + Sentinel

**Requirements**:
- Load balancer (AWS ALB, Azure LB, GCP LB)
- Monitoring for failover triggers
- Automated backup validation
- Regular disaster recovery drills

### Multi-Region Deployment (Advanced)

**Not recommended for initial production deployment.**

Consider after single-region is stable and proven.

## Security Considerations

### Network Security

- Database accessible ONLY from application servers
- Redis accessible ONLY from application servers
- Reverse proxy on public network, backends on private network
- VPC/Security Group restrictions in place
- DDoS protection (CloudFlare, AWS Shield, etc.)

### Secrets Management

- Generate production secrets using cryptographically secure methods
- Store secrets in:
  - AWS Secrets Manager (recommended)
  - HashiCorp Vault
  - Azure Key Vault
  - Environment variables (with restricted access)
- Never hardcode or version control secrets
- Rotate secrets periodically (recommended quarterly)

### Access Control

- SSH key-based authentication only (no passwords)
- 2FA for all production access
- Minimal permissions (principle of least privilege)
- Audit logging for all access
- VPN or bastion host for administrative access

## Cost Estimation

### Development/Small Deployment (Single Instance)

| Component | Service | Monthly Cost |
|-----------|---------|--------------|
| Compute (API + Web) | VPS (2 vCPU, 2GB RAM) | $20-40 |
| Database | AWS RDS db.t3.micro | $25-50 |
| Cache | AWS ElastiCache cache.t3.micro | $10-15 |
| Reverse Proxy | Included in compute | $0 |
| **Total** | | **$55-105** |

### Production/Medium Deployment (HA)

| Component | Service | Monthly Cost |
|-----------|---------|--------------|
| Compute (API x2) | VPS (4 vCPU, 4GB RAM) | $60-100 |
| Compute (Web x2) | VPS (2 vCPU, 2GB RAM) | $40-60 |
| Database | AWS RDS db.t3.small HA | $100-150 |
| Cache | AWS ElastiCache cache.t3.small HA | $40-60 |
| Load Balancer | AWS ALB | $20-30 |
| Monitoring | Datadog (1 host) | $15-30 |
| **Total** | | **$275-430** |

### Production/Large Deployment (Multi-Zone HA)

| Component | Service | Monthly Cost |
|-----------|---------|--------------|
| Compute (API x3) | AWS ECS/EKS | $200-300 |
| Compute (Web x3) | AWS ECS/EKS | $150-200 |
| Database | AWS RDS db.r6g.large Multi-AZ | $300-400 |
| Cache | AWS ElastiCache cluster-mode HA | $150-200 |
| Load Balancer | AWS ALB | $20-30 |
| Monitoring | Datadog (multi-node) | $60-100 |
| NAT Gateway | AWS NAT | $30-45 |
| Backups | S3 storage + snapshots | $50-100 |
| **Total** | | **$960-1,375** |

## Next Steps

1. Choose infrastructure provider (AWS, Azure, GCP, or self-hosted)
2. Provision PostgreSQL database
3. Provision Redis cache
4. Set up reverse proxy with SSL
5. Register production domain
6. Install SSL certificates
7. Configure backup procedures
8. Set up monitoring and logging
9. Deploy application using docker-compose.prod.yml
10. Verify all health endpoints
11. Execute smoke test suite
12. Monitor production metrics

Refer to `docs/DEPLOYMENT.md` for step-by-step deployment guide.
