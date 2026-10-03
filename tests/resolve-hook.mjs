// Node module customization hook: redirect the platform-only
// '@appdeploy/sdk' import to the in-memory test stub.
import { pathToFileURL } from 'node:url';

const stubUrl = new URL('./stubs/appdeploy-sdk.mjs', import.meta.url).href;

export async function resolve(specifier, context, nextResolve) {
    if (specifier === '@appdeploy/sdk') {
        return { url: stubUrl, shortCircuit: true };
    }
    return nextResolve(specifier, context);
}
