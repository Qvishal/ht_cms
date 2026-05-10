vcl 4.0;

# Backend pointing to Next.js frontend
backend default {
  .host = "host.docker.internal";
  .port = "3000";
  .connect_timeout = 600ms;
  .first_byte_timeout = 600s;
  .between_bytes_timeout = 60s;
}

sub vcl_recv {
  # Only cache GET and HEAD
  if (req.method != "GET" && req.method != "HEAD") {
    return (pass);
  }

  # Aggressively cache Next.js static assets
  if (req.url ~ "^/_next/static/" || req.url ~ "^/_next/image" || req.url ~ "\.(css|js|woff2?|png|jpe?g|gif|ico|svg)$") {
    unset req.http.Cookie;
    return (hash);
  }

  # Bypass cache for Next.js internal API and standard API
  if (req.url ~ "^/api/" || req.url ~ "^/_next/data/") {
    return (pass);
  }

  # Bypass cache for authenticated routes (e.g., dashboard, setup)
  if (req.url ~ "^/dashboard" || req.url ~ "^/setup" || req.http.Cookie ~ "auth") {
    return (pass);
  }

  # Cache public pages
  unset req.http.Cookie;
  return (hash);
}

sub vcl_backend_response {
  # Cache static assets for a long time
  if (bereq.url ~ "^/_next/static/" || bereq.url ~ "\.(css|js|woff2?|png|jpe?g|gif|ico|svg)$") {
    set beresp.ttl = 365d;
    set beresp.http.Cache-Control = "public, max-age=31536000, immutable";
    return (deliver);
  }

  # For public pages, cache for 1 hour
  if (beresp.status == 200) {
    set beresp.ttl = 1h;
    set beresp.http.Cache-Control = "public, max-age=3600";
  } else {
    set beresp.uncacheable = true;
    set beresp.ttl = 0s;
  }
  return (deliver);
}

sub vcl_deliver {
  # Add debug headers
  if (obj.hits > 0) {
    set resp.http.X-Cache = "HIT";
  } else {
    set resp.http.X-Cache = "MISS";
  }
  return (deliver);
}
