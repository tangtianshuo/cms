export class Config {
    static readonly storefrontEnabled = process.env.STOREFRONT_ENABLED === 'true';
    static readonly storefrontHost = process.env.STOREFRONT_HOST || 'localhost:3000';
    static readonly storefrontSiteName = process.env.STOREFRONT_SITE_NAME || 'Example Store';
    static readonly storefrontLanguage = process.env.STOREFRONT_LANGUAGE || 'en';
    static readonly storefrontCurrency = process.env.STOREFRONT_CURRENCY || 'USD';
    static readonly storefrontMediaOrigin = process.env.STOREFRONT_MEDIA_ORIGIN || 'http://localhost:8080';
    static readonly jwtIssuer = process.env.JWT_SCOPE || 'localhost';
    static readonly jwtSecret = process.env.JWT_SECRET || 'secret';
    static readonly jwtExpIn = process.env.JWT_EXP_IN
        ? parseInt(process.env.JWT_EXP_IN, 10)
        : 60000;

    static readonly dbPrefix = process.env.BD_PREFIX || 'bcms';
    static readonly dbUrl =
        process.env.DB_URL || 'mongodb://test:test1234@db:27017/admin';

    static readonly bodySizeLimit = process.env.BODY_SIZE_LIMIT
        ? parseInt(process.env.BODY_SIZE_LIMIT, 10)
        : 2000000;
    static readonly plugins: string[] = process.env.PLUGINS
        ? process.env.PLUGINS.split(',')
        : [];

    static readonly storageScope = process.env.STORAGE_SCOPE || 'bcms';
}
