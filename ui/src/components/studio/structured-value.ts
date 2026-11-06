import type { PropValue } from '@bcms/selfhosted-backend/prop/models/main';
import type { StructuredStudioValue } from '@bcms/selfhosted-backend/studio/business';

// Prop data is JSON-shaped, but may be reactive and contain undefined defaults.
// Traverse it instead of structuredClone(Proxy) or a lossy JSON round-trip.
export function structuredValue(
    data: PropValue['data'],
): StructuredStudioValue {
    function copy<T>(value: T): T {
        if (Array.isArray(value)) return value.map((item) => copy(item)) as T;
        if (value && typeof value === 'object')
            return Object.fromEntries(
                Object.entries(value).map(([key, item]) => [key, copy(item)]),
            ) as T;
        return value;
    }
    return { kind: 'prop-data', data: copy(data) };
}
