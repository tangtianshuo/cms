FROM nginx

COPY nginx.conf /etc/nginx/nginx.conf.template
COPY nginx.prod.conf /etc/nginx/nginx.prod.conf.template
COPY 19-preview-origin.sh /docker-entrypoint.d/19-preview-origin.sh
