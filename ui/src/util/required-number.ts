export function isRequiredNumberMissing(value: unknown): boolean {
    return (
        value === undefined ||
        value === null ||
        (typeof value === 'number' && Number.isNaN(value)) ||
        (typeof value === 'string' && value.trim() === '')
    );
}

export function requiredNumbersAreComplete(values: unknown[]): boolean {
    return (
        values.length > 0 &&
        values.every((value) => !isRequiredNumberMissing(value))
    );
}
