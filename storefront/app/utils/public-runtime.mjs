const trustedHeaders = ['host', 'x-storefront-host', 'x-storefront-key'];

export function publicRuntimeHeaders(headers = {}) {
    return Object.fromEntries(trustedHeaders
        .filter((name) => typeof headers[name] === 'string' && headers[name])
        .map((name) => [name, headers[name]]));
}
