# Deploy storefront presets

Presets in this repository are built-in packages. They are compiled into the
CMS backend and Nuxt storefront images. Users select a preset in the CMS and
import it into their own site; they do not upload arbitrary source code.

## Prerequisites

- A Linux server with Docker Engine and Docker Compose v2.
- A CMS hostname, for example `cms.example.com`.
- Public storefront hostnames. A custom hostname per merchant is recommended.
- TLS termination in front of the two loopback services, usually by a host
  reverse proxy, Cloudflare Tunnel or a load balancer.
- MongoDB is provided by `docker-compose.prod.yml`. Persistent data lives in
  the `db-data`, `uploads` and `backups` volumes.

## Configure secrets and public hosts

Create the repository root `.env` from the variables documented in
`docker-compose.prod.yml`. Do not use `backend/.env` for production: that file
is only consumed by the development Compose file.

```dotenv
DB_ADMIN_USERNAME=bcms
DB_ADMIN_PASSWORD=replace-with-a-strong-password
JWT_SECRET=replace-with-a-long-random-secret
JWT_SCOPE=cms.example.com
CMS_ORIGIN=https://cms.example.com

STOREFRONT_ENABLED=true
STOREFRONT_HOST=shop.example.com
STOREFRONT_LANGUAGE=en
STOREFRONT_CURRENCY=USD
STOREFRONT_MEDIA_ORIGIN=https://cms.example.com

STOREFRONT_ENTRY_HOST=shop.example.com
STOREFRONT_ENTRY_IP=203.0.113.10
STOREFRONT_GATEWAY_SECRET=replace-with-gateway-secret
STOREFRONT_DOMAIN_SECRET=replace-with-a-different-domain-secret

HTTP_PORT=80
STOREFRONT_PORT=3000
```

Generate the two storefront secrets independently:

```sh
openssl rand -hex 32
openssl rand -hex 32
```

`STOREFRONT_GATEWAY_SECRET` is used by the private storefront gateway. The
domain secret signs HTTPS ownership checks. Do not place either secret in
browser-visible configuration.

Protect the environment file:

```sh
chmod 600 .env
```

## Start the production stack

From the repository root:

```sh
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml ps
```

The production stack exposes two loopback-only entry points:

- CMS and API: `127.0.0.1:${HTTP_PORT:-80}`
- Storefront gateway: `127.0.0.1:${STOREFRONT_PORT:-3000}`

Do not expose the backend or Nuxt container port directly to the internet. The
storefront gateway injects the private routing secret and must remain the only
path to Nuxt.

## Route public traffic

The outer TLS proxy must preserve the incoming HTTP `Host` and must not cache
public HTML, API responses or `sitemap.xml`.

For a server-side Nginx example:

```nginx
server {
    listen 443 ssl;
    server_name cms.example.com;

    location / {
        proxy_pass http://127.0.0.1:80;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

server {
    listen 443 ssl;
    server_name shop.example.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Host "";
        proxy_set_header X-Forwarded-Proto "";
        proxy_cache off;
    }
}
```

Add the TLS certificate paths and an HTTP-to-HTTPS redirect for production.
Repeat the storefront server block for every merchant hostname, or use a
wildcard hostname and certificate. Cloudflare can route all merchant hosts to
the same private storefront gateway when Full (strict) TLS is enabled.

## Make AeroFrame available to users

After the containers are healthy:

1. Open `https://cms.example.com` and complete the initial administrator
   setup.
2. Create or select a workspace and site.
3. Open `/d/presets`.
4. Select **AeroFrame** and verify its home, collection, product and company
   previews.
5. Set the site name, optionally include demo content, and select **Import**.
6. Edit the generated brand, product, collection, home and page Entries.
7. Open **Check publication differences**, then **Publish release**.
8. Add the merchant hostname in `/d/domains`, configure its TXT record and
   DNS target, run the ownership and HTTPS checks, then promote it as primary.

Each site can install one preset. Multiple sites and users can coexist when
they are assigned to the appropriate workspace. The preset catalog itself is
shared across the deployment because it ships with the application.

## Verify the deployment

```sh
curl -fsS https://cms.example.com/api/v4/presets/catalog
docker compose -f docker-compose.prod.yml logs --tail=100 backend storefront storefront-gateway
```

The catalog response must contain `aeroframe`. Before publication, a newly
imported site returns no public pages. After publication, open the primary
storefront hostname and check the home, collection, product and content pages.
Also check mobile navigation, image loading, contact links and the sitemap.

## Updates and rollback

Back up MongoDB, `/app/backend/uploads` and `/app/backend/backups` before an
upgrade. Then pull the new revision and rebuild:

```sh
docker compose -f docker-compose.prod.yml up -d --build
```

The storefront image is rebuilt from the current Nuxt source, and the catalog
change is included in the backend image. Imported sites keep their own content,
pages and Release history. Do not modify an already published preset version
in place; publish a new manifest version and keep the old version available
until affected sites have been reviewed and upgraded.

For a single content mistake, use the Release rollback in `/d/presets`. For an
application rollout problem, redeploy the previous Git revision and restore
only the application images; restore database volumes only after an explicit
backup and incident review.

## Current boundary

This deployment provides a built-in preset library. It does not provide a
third-party marketplace that accepts uploaded preset archives. Supporting
that would require a signed manifest registry, version storage, schema and
media validation, review and approval workflow, and isolated asset delivery.
