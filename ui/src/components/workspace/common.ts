export const formClass =
    'rounded border border-gray bg-white px-3 py-2 text-sm text-dark dark:bg-darkGray dark:text-white';
export const panelClass =
    'mt-6 rounded border border-gray/60 p-5 dark:border-gray';
export function errorMessage(cause: unknown): string {
    return (cause as { message?: string })?.message || String(cause);
}
