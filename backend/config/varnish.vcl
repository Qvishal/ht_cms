# Varnish Cache Configuration (VCL 4.0)
# Handles edge caching for public APIs
# Docker host mapping: varnish -> backend (port 4000)

vcl 4.0;

# Backend specification (in Docker, this resolves via service name)
backend default {
  .host = "host.docker.internal";
  .port = "4000";
  .connect_timeout = 600ms;
  .first_byte_timeout = 600s;
  .between_bytes_timeout = 60s;
}

# ACL for cache management (purge, ban)
acl purge_acl {
  "127.0.0.1";
  "localhost";
  "192.168.1.0"/24;
}

# Called at the start of a request (after it is received)
sub vcl_recv {
  # Only cache GET and HEAD requests
  if (req.method != "GET" && req.method != "HEAD") {
    return (pass);
  }

  # Skip caching for admin routes
  if (req.url ~ "^/auth/" || 
      req.url ~ "^/setup/" || 
      req.url ~ "^/admin/") {
    return (pass);
  }

  # Skip caching for authenticated requests UNLESS it's the specific /data/ API edge cache
  if ((req.http.Cookie ~ "auth" || req.http.Authorization) && req.url !~ "^/data/") {
    return (pass);
  }

  # Only cache public API and private data routes
  if (req.url !~ "^/api/public/" && req.url !~ "^/data/") {
    return (pass);
  }

  # Remove all cookies for public endpoints
  unset req.http.Cookie;

  # Standard cache bypass headers
  if (req.http.Cache-Control ~ "no-cache" || 
      req.http.Cache-Control ~ "no-store" ||
      req.http.Pragma ~ "no-cache") {
    return (pass);
  }

  return (hash);
}

# Called when a cache object is about to be used to answer a client request
sub vcl_hit {
  if (obj.ttl >= 0s) {
    # Cache hit - will be marked in vcl_deliver
    return (deliver);
  }

  # Expired cache, fetch fresh
  return (restart);
}

# Called after a cache miss
sub vcl_miss {
  return (fetch);
}

# Called after a pass
sub vcl_pass {
  return (fetch);
}

# Called after the backend request is received
sub vcl_backend_response {
  # Don't cache errors
  if (beresp.status >= 400) {
    set beresp.uncacheable = true;
    set beresp.ttl = 5s;
    return (deliver);
  }

  # Cache only public and authorized edge responses
  if (beresp.http.Cache-Control ~ "no-cache" ||
      beresp.http.Cache-Control ~ "no-store") {
    set beresp.uncacheable = true;
    return (deliver);
  }

  # Extract TTL from Cache-Control header
  if (beresp.http.Cache-Control ~ "max-age=([0-9]+)") {
    set beresp.ttl = 120s; # Use fixed TTL for public API responses
  } else if (beresp.http.Cache-Control ~ "public") {
    set beresp.ttl = 120s; # Default 2 minutes
  } else {
    set beresp.uncacheable = true;
    return (deliver);
  }

  # Allow stale serving
  set beresp.grace = 300s;

  return (deliver);
}

# Called after the response is ready to be sent to the client
sub vcl_deliver {
  # Add cache status header
  if (obj.hits > 0) {
    set resp.http.X-Cache = "HIT";
  } else {
    set resp.http.X-Cache = "MISS";
  }

  if (obj.uncacheable) {
    set resp.http.X-Cache = "UNCACHEABLE";
  }

  # Remove sensitive headers
  unset resp.http.X-Powered-By;
  unset resp.http.Server;
  unset resp.http.Via;

  return (deliver);
}

# Handle purge requests
sub vcl_recv {
  if (req.method == "PURGE") {
    if (!client.ip ~ purge_acl) {
      return (synth(403, "Forbidden"));
    }

    # Support different purge patterns:
    # PURGE /api/public/products -> Purge exact URL
    # PURGE "^/api/public/products" -> Regex pattern
    if (req.http.X-Purge-Regex) {
      ban("req.url ~ " + req.http.X-Purge-Regex);
    } else {
      ban("req.url == " + req.url);
    }
    
    return (synth(200, "Purged"));
  }
}

# Handle synthetic responses
sub vcl_synth {
  set resp.http.Content-Type = "text/plain; charset=utf-8";
  synthetic(resp.reason + " " + resp.status);
  return (deliver);
}

# Error handling
sub vcl_backend_error {
  set beresp.http.Content-Type = "text/html; charset=utf-8";
  synthetic("Service Unavailable - " + beresp.status);
  return (deliver);
}

# ACL-based access control (optional)
sub vcl_recv {
  # Example: Block specific User-Agents
  if (req.http.User-Agent ~ "bot|crawler|spider") {
    return (pass);
  }

  # Example: Rate limiting patterns (would need separate implementation)
  # if (client.ip ~ suspicious_ips) {
  #   return (synth(429, "Too Many Requests"));
  # }
}

# =============================================================================
# CACHE CONFIGURATION PRESETS
# =============================================================================

# Public endpoint with 2-minute cache (default)
# Example: /api/public/products
# Cache-Control: public, max-age=120

# Private endpoint with 5-minute cache
# Example: /api/private/user/dashboard
# Cache-Control: private, max-age=300
# Retrieved from backend, cached in Redis, NOT in Varnish

# Never-cache endpoint
# Example: /auth/login, /setup/tables
# Cache-Control: no-cache, no-store, must-revalidate

# =============================================================================
# USAGE INSTRUCTIONS
# =============================================================================

# 1. Install Varnish
#    Ubuntu: sudo apt-get install varnish
#    macOS: brew install varnish
#
# 2. Start Varnish
#    varnishd -f /path/to/this/varnish.vcl -s malloc,256M -a 0.0.0.0:6081
#
# 3. Proxy requests to Varnish (nginx/Apache config)
#    upstream backend {
#      server localhost:6081;
#    }
#    server {
#      listen 80;
#      location / {
#        proxy_pass http://backend;
#        proxy_cache_bypass $http_pragma $http_cache_control;
#      }
#    }
#
# 4. Purge cache
#    # Purge exact URL
#    curl -X PURGE http://localhost:6081/api/public/products
#
#    # Purge pattern (be careful!)
#    curl -X PURGE \
#      -H "X-Purge-Regex: ^/api/public/products" \
#      http://localhost:6081/api/public/products
#
# 5. Monitor cache
#    varnishlog - Live request logs
#    varnishtop - Top requests
#    varnishstat - Cache statistics

# =============================================================================
# MONITORING COMMANDS
# =============================================================================

# View Varnish statistics
# varnishstat -1
# Shows: Cache hits, misses, evictions, etc.

# View request logs with cache status
# varnishlog -g request -q "ReqURL ~ \"^/api/public\""

# Force cache flush (DANGEROUS!)
# varnishadm ban all

# =============================================================================
