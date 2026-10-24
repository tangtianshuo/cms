import { randomUUID } from 'node:crypto';

export function createMultipartFile(
    fileName: string,
    mimeType: string,
    base64: string,
) {
    if (
        !base64 ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
            base64,
        )
    ) {
        throw new Error(
            'fileBase64 must contain valid, non-empty base64 data.',
        );
    }
    const bytes = Buffer.from(base64, 'base64');
    if (!bytes.length) throw new Error('Uploaded file must not be empty.');

    const safeName =
        fileName.replace(/[\r\n"\\]/g, '_').slice(0, 255) || 'upload.bin';
    const safeMimeType = /^[\w.+-]+\/[\w.+-]+$/.test(mimeType)
        ? mimeType
        : 'application/octet-stream';
    const boundary = `bcms-mcp-${randomUUID()}`;
    const body = Buffer.concat([
        Buffer.from(
            `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${safeName}"\r\nContent-Type: ${safeMimeType}\r\n\r\n`,
        ),
        bytes,
        Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}
