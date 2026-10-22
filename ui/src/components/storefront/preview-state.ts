export function createPreviewGate() {
    let current = 0;
    return {
        next: () => ++current,
        isCurrent: (sequence: number) => sequence === current,
    };
}

export function sendPreview(
    frame: { contentWindow?: { postMessage: (message: unknown, targetOrigin: string) => void } | null },
    origin: string,
    payload: unknown,
) {
    frame.contentWindow?.postMessage({ type: 'storefront:preview', payload }, origin);
}
