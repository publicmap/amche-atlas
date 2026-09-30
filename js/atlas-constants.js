const REF = /^\$([A-Za-z_][\w-]*)$/;

function substitute(value, constants, resolving) {
    if (typeof value === 'string') {
        const match = REF.exec(value);
        if (!match || !Object.prototype.hasOwnProperty.call(constants, match[1])) return value;
        const name = match[1];
        if (resolving.has(name)) {
            console.warn(`[AtlasConstants] Circular constant reference: $${name}`);
            return value;
        }
        resolving.add(name);
        const resolved = substitute(constants[name], constants, resolving);
        resolving.delete(name);
        return structuredCloneValue(resolved);
    }
    if (Array.isArray(value)) return value.map(item => substitute(item, constants, resolving));
    if (value && typeof value === 'object') {
        const out = {};
        for (const key of Object.keys(value)) out[key] = substitute(value[key], constants, resolving);
        return out;
    }
    return value;
}

function structuredCloneValue(value) {
    return value !== null && typeof value === 'object' ? JSON.parse(JSON.stringify(value)) : value;
}

export function resolveConstants(config) {
    const constants = config && config.constants;
    if (!constants || typeof constants !== 'object' || Array.isArray(constants)) return config;
    const out = {};
    for (const key of Object.keys(config)) {
        out[key] = key === 'constants' ? constants : substitute(config[key], constants, new Set());
    }
    return out;
}
