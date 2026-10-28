import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

test(
    'CMS image embeds the exact configured preview origins',
    { skip: !process.env.E2E_CMS_IMAGE },
    () => {
        const output = execFileSync(
            'docker',
            [
                'run',
                '--rm',
                '--entrypoint',
                'node',
                process.env.E2E_CMS_IMAGE,
                '-e',
                "const fs=require('fs');const p='/app/ui/dist/assets';process.stdout.write(fs.readdirSync(p).filter(f=>f.endsWith('.js')).map(f=>fs.readFileSync(p+'/'+f,'utf8')).join(''))",
            ],
            { encoding: 'utf8', maxBuffer: 12 * 1024 * 1024 },
        );
        for (const origin of [
            'http://127.0.0.1:13001',
            'http://127.0.0.1:18081',
        ]) {
            assert.ok(
                output.includes(origin),
                `UI build must contain configured public preview origin ${origin}`,
            );
        }
    },
);
