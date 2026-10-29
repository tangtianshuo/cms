# Nova production relay

`nova-relay.conf` is the versioned configuration for the existing relay at
`/opt/novaintelligent/deploy/relay.conf`. The addresses are specific to the
inspected deployment; this is not the generic Docker Compose proxy.

Only successful GET/HEAD responses for `/assets/name-HASH.js` and `.css` with
the expected JavaScript/CSS content type and no explicit upstream cache policy
receive `public, max-age=31536000, immutable`. Missing files that fall back to
SPA HTML remain `no-store`. CMS HTML, APIs, draft previews and shop responses
retain `no-store`. A new build changes asset URLs, so HTML must remain uncached.

Verification from the deployment host:

```sh
CMS_CACHE_TEST_ORIGIN=http://172.18.0.1:18184 python3 ops/test/test_live_static_cache.py
```

Before activation, test a candidate using the existing relay image on a temporary
loopback port, then back up the live file. Preserve its inode when replacing
contents because Docker bind-mounts that file. Run `nginx -t` in the relay
container, reload, and rerun the HTTP checks. Restore the previous contents and
reload if verification fails. Check public responses for Cloudflare `MISS`
followed by `HIT` on repeat GET requests to the same asset at the same edge.

Activated on 2026-10-27 at 14:54:44 UTC. The server's backup, verified candidate
and deployment receipt are under
`/opt/novaintelligent/deploy/cache-optimization/`. This proxy change requires
no application image replacement.

On 2026-10-29, `fire.novaintelligent.cn` was added to the storefront relay
and the edge Nginx server names. The independent Gateway site is provisioned
with a pending domain; publication and DNS/HTTPS verification remain separate
steps. The candidate checks returned CMS 200, shop 200 and unpublished fire
404. Configuration and PostgreSQL backups, candidate files and the entry
receipt are in `/opt/novaintelligent/deploy/fireguard-provisioning/20261029T035613Z/`.
