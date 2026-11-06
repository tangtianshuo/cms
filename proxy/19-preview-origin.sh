#!/bin/sh
set -eu
# Deployment input only. Never derive framing policy from request headers.
origin=${STOREFRONT_PREVIEW_PUBLIC_ORIGIN:-}
frame_source=''
if [ -z "$origin" ]; then
  if [ -n "${STOREFRONT_PREVIEW_SERVICE_URL:-}" ]; then
    echo 'Configured Preview service requires STOREFRONT_PREVIEW_PUBLIC_ORIGIN' >&2
    exit 1
  fi
else
  if ! printf '%s\n' "$origin" | LC_ALL=C grep -Eq '^https?://([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)*[a-z0-9]([a-z0-9-]*[a-z0-9])?(:[1-9][0-9]{0,4})?$'; then
    echo 'STOREFRONT_PREVIEW_PUBLIC_ORIGIN must be one canonical HTTP(S) origin' >&2
    exit 1
  fi
  # grep operates on lines; separately forbid any additional line.
  if [ "$(printf '%s' "$origin" | wc -l | tr -d ' ')" != 0 ]; then exit 1; fi
  case "$origin" in http://*:80|https://*:443) echo 'Default ports must be omitted from canonical origins' >&2; exit 1 ;; esac
  port=${origin##*:}
  case "$port" in *[!0-9]*) ;; *) [ "$port" -le 65535 ] || exit 1 ;; esac
  frame_source=" $origin"
fi
source=${CMS_NGINX_TEMPLATE:-/etc/nginx/nginx.conf.template}
target=${CMS_NGINX_OUTPUT:-/etc/nginx/nginx.conf}
sed 's|${STOREFRONT_PREVIEW_CSP_SOURCE}|'"$frame_source"'|g' "$source" > "$target"
