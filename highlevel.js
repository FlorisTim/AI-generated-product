// highlevel.js

(function () {

    function findMatchingBrace(source, openIndex) {

        let depth = 1;

        for (let i = openIndex + 1; i < source.length; i++) {

            if (source[i] === "{") depth++;
            else if (source[i] === "}") depth--;

            if (depth === 0) return i;
        }

        throw new Error("Missing closing brace");
    }

    function parseClasses(source) {

        const classes = new Map();

        let pos = 0;

        while (true) {

            const classPos =
                source.indexOf("class ", pos);

            if (classPos === -1) break;

            const headerMatch =
                /class\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(
                    source.slice(classPos)
                );

            if (!headerMatch)
                throw new Error("Invalid class");

            const className = headerMatch[1];

            const braceStart =
                source.indexOf("{", classPos);

            if (braceStart === -1)
                throw new Error(
                    `Class '${className}' missing '{'`
                );

            const braceEnd =
                findMatchingBrace(
                    source,
                    braceStart
                );

            const body =
                source.slice(
                    braceStart + 1,
                    braceEnd
                );

            const methods =
                parseMethods(body);

            classes.set(
                className,
                methods
            );

            pos = braceEnd + 1;
        }

        return classes;
    }

    function parseMethods(body) {

        const methods = new Map();

        let pos = 0;

        while (true) {

            const methodPos =
                body.indexOf(
                    "method ",
                    pos
                );

            if (methodPos === -1)
                break;

            const headerMatch =
                /method\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(\s*\)/
                    .exec(
                        body.slice(methodPos)
                    );

            if (!headerMatch)
                throw new Error(
                    "Invalid method"
                );

            const methodName =
                headerMatch[1];

            const braceStart =
                body.indexOf(
                    "{",
                    methodPos
                );

            if (braceStart === -1)
                throw new Error(
                    `Method '${methodName}' missing '{'`
                );

            const braceEnd =
                findMatchingBrace(
                    body,
                    braceStart
                );

            const methodBody =
                body
                    .slice(
                        braceStart + 1,
                        braceEnd
                    )
                    .trim();

            methods.set(
                methodName,
                methodBody
            );

            pos = braceEnd + 1;
        }

        return methods;
    }

    function removeClasses(source) {

        let result = "";
        let pos = 0;

        while (true) {

            const classPos =
                source.indexOf(
                    "class ",
                    pos
                );

            if (classPos === -1) {

                result +=
                    source.slice(pos);

                break;
            }

            result +=
                source.slice(
                    pos,
                    classPos
                );

            const braceStart =
                source.indexOf(
                    "{",
                    classPos
                );

            const braceEnd =
                findMatchingBrace(
                    source,
                    braceStart
                );

            pos = braceEnd + 1;
        }

        return result;
    }

    function transpileHighLevel(source) {

        const classes =
            parseClasses(source);

        source =
            removeClasses(source);

        const objects =
            new Map();

        const objectRegex =
            /([A-Za-z_][A-Za-z0-9_]*)\s+([A-Za-z_][A-Za-z0-9_]*)\s*;/g;

        let match;

        while (
            (match =
                objectRegex.exec(
                    source
                )) !== null
            ) {

            const className =
                match[1];

            const objectName =
                match[2];

            if (
                classes.has(
                    className
                )
            ) {

                objects.set(
                    objectName,
                    className
                );
            }
        }

        source =
            source.replace(
                objectRegex,
                ""
            );

        const output = [];

        const callRegex =
            /([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)\(\)\s*;/g;

        while (
            (match =
                callRegex.exec(
                    source
                )) !== null
            ) {

            const objectName =
                match[1];

            const methodName =
                match[2];

            const className =
                objects.get(
                    objectName
                );

            if (!className)
                throw new Error(
                    `Unknown object '${objectName}'`
                );

            const methods =
                classes.get(
                    className
                );

            if (
                !methods.has(
                    methodName
                )
            ) {
                throw new Error(
                    `Unknown method '${methodName}'`
                );
            }

            output.push(
                methods.get(
                    methodName
                )
            );
        }

        return output.join("\n");
    }

    window.transpileHighLevel =
        transpileHighLevel;

})();