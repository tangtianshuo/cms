// Explicit local candidate mode initializes CMS identity without claiming registry publication.
import { execFileSync } from 'node:child_process';
import { readEnv, saveEnv } from './runtime.mjs';
export async function bootstrapLocal() {
    const e = await readEnv();
    let token;
    const api = async (route, body, scope = {}) => {
        const r = await fetch(`http://127.0.0.1:18080/api/v4/${route}`, {
            method: body === undefined ? 'GET' : 'POST',
            headers: {
                'content-type': 'application/json',
                ...scope,
                ...(token ? { authorization: `Bearer ${token}` } : {}),
            },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
        if (!r.ok)
            throw new Error(`CMS bootstrap ${route} returned ${r.status}`);
        return r.json();
    };
    if ((await api('auth/should-signup')).yes) {
        const logs = execFileSync(
            'docker',
            ['logs', `${e.COMPOSE_PROJECT_NAME}-cms-1`],
            { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
        );
        const serverToken = /Server token: ([a-f0-9]{128})/.exec(logs)?.[1];
        if (!serverToken)
            throw new Error('Disposable administrator token missing');
        await api('auth/signup-admin', {
            serverToken,
            email: e.E2E_EMAIL,
            password: e.E2E_PASSWORD,
            firstName: 'Local',
            lastName: 'Acceptance',
        });
    }
    token = (
        await api('auth/login', {
            email: e.E2E_EMAIL,
            password: e.E2E_PASSWORD,
        })
    ).accessToken;
    if (!e.E2E_CMS_WORKSPACE) {
        const workspace = await api('workspaces', {
            name: 'A4 disposable acceptance',
        });
        const site = await api(
            'workspaces/current/sites',
            { name: 'A4 local candidate' },
            { 'x-bcms-workspace': workspace._id },
        );
        e.E2E_CMS_WORKSPACE = workspace._id;
        e.E2E_CMS_SITE = site._id;
        await saveEnv(e);
    }
    console.log(
        'Local CMS identity initialized. Public registry publication remains awaiting B2.',
    );
}
