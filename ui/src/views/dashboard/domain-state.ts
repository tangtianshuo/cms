export function domainActions(
    domain: {
        enabled: boolean;
        isPrimary: boolean;
        platformOwned?: boolean;
        ownershipStatus: string;
        connectionStatus: string;
        certificateStatus?: string;
    },
    pending: boolean,
) {
    return {
        primary:
            !pending &&
            !domain.isPrimary &&
            domain.enabled &&
            domain.ownershipStatus === 'verified' &&
            domain.connectionStatus === 'ready' &&
            (domain.certificateStatus === undefined ||
                domain.certificateStatus === 'ready'),
        disable: !pending && !domain.isPrimary && !domain.platformOwned,
        remove: !pending && !domain.isPrimary && !domain.platformOwned,
    };
}
export function connectionRecords(guidance: {
    entryHost: string;
    entryIp: string;
}) {
    return [
        guidance.entryHost ? `CNAME ${guidance.entryHost}` : '',
        guidance.entryIp ? `A ${guidance.entryIp}` : '',
    ]
        .filter(Boolean)
        .join('\n');
}
