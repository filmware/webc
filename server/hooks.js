import * as path from "path";

export async function resolve(specifier, context, nextResolve) {
    if (specifier.substring(0, 1) == "@") {
        // map @/* to /web/src/*
        let old = specifier;
        specifier = `../../web/src/${specifier.substring(2)}.js`;
        console.log(`resolve(${old} -> ${specifier});`);
        console.log("context", context);
    } else if (
        specifier.substring(0, 1) == "." && context.parentURL.includes("/web")
    ) {
        // resolve ./* in the web directory
        let old = specifier;
        specifier = `${path.dirname(context.parentURL)}/${specifier}.js`;
        console.log(`resolve(${old} -> ${specifier});`);
    } else {
        console.log(`resolve(${specifier});`);
    }
    let out = await nextResolve(specifier, context);
    return out;
}
