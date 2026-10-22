export function productSeo(page, origin) {
    const canonical = `${origin.replace(/\/$/, '')}/products/${encodeURIComponent(page.product.slug)}`;
    const structuredData = JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: page.product.name,
        description: page.product.description,
        image: page.product.images.map((image) => image.src),
        offers: {
            '@type': 'Offer',
            price: page.product.price,
            priceCurrency: page.site.currency,
            url: canonical,
        },
    }).replace(/</g, '\\u003c');
    return {
        title: `${page.product.name} | ${page.site.name}`,
        description: page.product.description,
        canonical,
        structuredData,
    };
}
