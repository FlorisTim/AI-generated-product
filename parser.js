// ─────────────────────────────────────────
//  Known methods
// ─────────────────────────────────────────
const METHODS = new Set([
    "DRAW_SQUARE",
    "DRAW_CIRCLE",
    "DECLARE",
    "SET",
    "INCREMENT",
    "DECREMENT",
    "IFMORE",
    "IFLESS",
    "IFEQUAL",
    "ENDIF",
    "LOG",
    "P",
    "JUMP",
    "IF"   // so IF gets method-colored
]);
const varValues = new Map();

function setVarValue(name, value) {
    varValues.set(name, value);
}

function getVarValue(name) {
    return varValues.get(name);
}


// ─────────────────────────────────────────
//  Parser
//  Returns an array of instruction arrays.
//  Each instruction: [method, arg1, arg2, ...]
//  Blank lines and lines with no method are skipped.
//  Quoted strings are kept as a single token.
// ─────────────────────────────────────────
function parse(source) {
    // Split on ';' as the statement terminator
    return source
        .split(";")
        .map(line => line.trim())
        .filter(line => line.length > 0)
        .map(line => {
            // Tokenise respecting quoted strings
            const tokens = [];
            const re = /(["']).*?\1|\S+/g;
            let m;
            while ((m = re.exec(line)) !== null) tokens.push(m[0]);


            // Auto-rewrite IF a > b;
            if (tokens[0] === "IF" && tokens.length === 4) {
                const left = tokens[1];
                const op = tokens[2];
                const right = tokens[3];

                if (op === ">") {
                    return ["IFMORE", left, right];
                }
                if (op === "<") {
                    return ["IFLESS", left, right];
                }
                if (op === "==") {
                    return ["IFEQUAL", left, right];
                }
            }
            return tokens;
        })
        .filter(tokens => tokens.length > 0 && METHODS.has(tokens[0]));
}
function parseAndEncode(source) {
    const instructions = parse(source);
    console.log("Parsed:", instructions);

    const bytes = encodeProgram(instructions);
    console.log("Bytecode:", bytes);

    return instructions;
}

// ─────────────────────────────────────────
//  Bytecode encoder
//  Feed this directly with the result of parse(source)
//  instructions: Array<[method, arg1, arg2, ...]>
//  Returns: Uint8Array of bytes
// ─────────────────────────────────────────
// ─────────────────────────────────────────
//  Bytecode encoder with variable indexing
// ─────────────────────────────────────────
function encodeProgram(instructions) {
    const METHOD_LIST = Array.from(METHODS);
    const bytes = [];

    // Symbol table for variables
    const varTable = new Map();
    let varCount = 0;

    function getVarIndex(name) {
        if (!varTable.has(name)) {
            varTable.set(name, varCount++);
        }
        return varTable.get(name);
    }

    for (const inst of instructions) {
        if (inst.length === 0) continue;

        const method = inst[0];
        const args = inst.slice(1);

        const methodIndex = METHOD_LIST.indexOf(method);
        if (methodIndex === -1) {
            console.warn("Unknown method:", method);
            continue;
        }

        // Method prefix
        bytes.push(0, methodIndex);

        // Encode arguments
        for (const token of args) {
            encodeToken(token, bytes, getVarIndex, getVarValue);
        }

    }

    return Uint8Array.from(bytes);
}

// Helpers
function stringToBytes(str) {
    return [...str].map(c => c.charCodeAt(0) & 0xFF);
}

function float32ToBytes(num) {
    const buf = new ArrayBuffer(4);
    const view = new DataView(buf);
    view.setFloat32(0, num, false);
    return [
        view.getUint8(0),
        view.getUint8(1),
        view.getUint8(2),
        view.getUint8(3)
    ];
}


// ─────────────────────────────────────────
//  Token encoder
//  - small ints (-128..+128): prefix 1 + 1 byte
//  - other ints: prefix 2 + 2 bytes (signed)
//  - decimals: prefix 3 + 4 bytes (float32)
//  - strings: prefix 4 + 1 byte length + bytes
// ─────────────────────────────────────────
function encodeToken(token, out, getVarIndex, getVarValue) {
    // 1. VAR VALUE ($var)
    if (token.startsWith("$")) {
        const varName = token.slice(1);
        const value = getVarValue(varName); // you must implement this
        const { type, bytes } = encodeRawValue(value);

        out.push(5);      // var-value prefix
        out.push(type);   // underlying type (1,2,3,4)
        for (const b of bytes) out.push(b);
        return;
    }

    // 2. STRING literal
    if (/^(["']).*\1$/.test(token)) {
        const inner = token.slice(1, -1);
        const strBytes = stringToBytes(inner);
        out.push(4, strBytes.length);
        for (const b of strBytes) out.push(b);
        return;
    }

    // 3. NUMBER (int or float)
    if (/^-?\d+(\.\d+)?$/.test(token)) {
        const { type, bytes } = encodeRawValue(token);
        out.push(type);
        for (const b of bytes) out.push(b);
        return;
    }

    // 4. VARIABLE reference (normal var)
    const idx = getVarIndex(token);
    out.push(idx & 0xFF);
}

function encodeRawValue(value) {
    // STRING
    if (typeof value === "string" && !/^-?\d/.test(value)) {
        const bytes = stringToBytes(value);
        return { type: 4, bytes: [bytes.length, ...bytes] };
    }

    // DECIMAL
    if (typeof value === "number" && !Number.isInteger(value)) {
        const f = float32ToBytes(value);
        return { type: 3, bytes: f };
    }

    // INTEGER
    if (typeof value === "number") {
        if (value >= -128 && value <= 128) {
            return { type: 1, bytes: [value & 0xFF] };
        } else {
            return { type: 2, bytes: [(value >> 8) & 0xFF, value & 0xFF] };
        }
    }

    throw new Error("Unsupported var-value type: " + value);
}

// ─────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────
function stringToBytes(str) {
    const arr = [];
    for (let i = 0; i < str.length; i++) {
        arr.push(str.charCodeAt(i) & 0xFF);
    }
    return arr;
}

function float32ToBytes(num) {
    const buf = new ArrayBuffer(4);
    const view = new DataView(buf);
    view.setFloat32(0, num, false); // big-endian
    return [
        view.getUint8(0),
        view.getUint8(1),
        view.getUint8(2),
        view.getUint8(3),
    ];
}

// ─────────────────────────────────────────
//  IF/ENDIF block line computation
//  Returns a Set of line indices that belong
//  to any IF…ENDIF block (inclusive).
// ─────────────────────────────────────────
function computeIfBlockLines(source) {
    const lines = source.split("\n");
    const marked = new Set();
    const stack = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Tokenise like the parser (but per line)
        const tokens = [];
        const re = /(["']).*?\1|\S+/g;
        let m;
        while ((m = re.exec(line)) !== null) tokens.push(m[0]);

        if (tokens.length === 0) continue;

        const method = tokens[0];

        if (method === "IFMORE" || method === "IFLESS" || method === "IFEQUAL") {
            stack.push(i);
        } else if (method === "ENDIF") {
            const start = stack.pop();
            if (start !== undefined) {
                for (let j = start; j <= i; j++) {
                    marked.add(j);
                }
            }
        }
    }

    return marked;
}

// ─────────────────────────────────────────
//  Syntax Highlighter
//  Returns an HTML string with spans applied.
//  Call this whenever the editor content changes.
// ─────────────────────────────────────────
function highlight(source) {
    const ifLines = computeIfBlockLines(source);

    return source
        .split("\n")
        .map((line, idx) => highlightLine(line, ifLines.has(idx)))
        .join("\n");
}

function highlightLine(line, inIfBlock = false) {
    // Tokenise keeping quoted strings intact as one token,
    // while also preserving whitespace runs for layout.
    //
    // Match priority:
    //   1. quoted string  (["']).*?\1
    //   2. whitespace run \s+
    //   3. non-whitespace \S+
    const TOKEN_RE = /(["']).*?\1|\s+|\S+/g;
    let result = "";
    let m;

    while ((m = TOKEN_RE.exec(line)) !== null) {
        const part = m[0];

        // Pure whitespace — pass through unchanged
        if (/^\s+$/.test(part)) {
            result += part;
            continue;
        }

        // Strip trailing semicolon before classifying, re-attach after
        const hasSemi = part.endsWith(";");
        const token = hasSemi ? part.slice(0, -1) : part;
        const semi = hasSemi ? '<span class="hl-semi">;</span>' : "";

        if (token.length === 0) { result += semi; continue; }

        // String literal — opens and closes with matching quote
        if (/^(["']).*\1$/.test(token)) {
            result += '<span class="hl-string">' + escapeHtml(token) + "</span>" + semi;
            continue;
        }

        // Number — integer or float, optionally negative
        if (/^-?\d+(\.\d+)?$/.test(token)) {
            result += '<span class="hl-number">' + escapeHtml(token) + "</span>" + semi;
            continue;
        }

        // Known method keyword
        if (METHODS.has(token)) {
            result += '<span class="hl-method">' + escapeHtml(token) + "</span>" + semi;
            continue;
        }
// Variable name (simple rule: starts with letter or _)
        if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(token)) {
            result += '<span class="hl-var">' + escapeHtml(token) + "</span>" + semi;
            continue;
        }
        // Everything else (variable names, operators…)

        result += escapeHtml(token) + semi;
    }

    // If this line is part of an IF block, wrap it with a subtle guide
    if (inIfBlock) {
        return '<span class="hl-if-block">' + result + "</span>";
    }

    return result;
}

function escapeHtml(str) {
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}


// ─────────────────────────────────────────
//  Wire up the editor
// ─────────────────────────────────────────
(function init() {
    const textarea = document.querySelector(".editor");
    if (!textarea) return;

    const wrapper = document.createElement("div");
    wrapper.className = "editor-wrapper";

    const backdrop = document.createElement("div");
    backdrop.className = "editor-backdrop";

    const highlighted = document.createElement("div");
    highlighted.className = "editor-highlighted";
    backdrop.appendChild(highlighted);

    textarea.classList.add("editor-input");
    textarea.parentNode.insertBefore(wrapper, textarea);
    wrapper.appendChild(backdrop);
    wrapper.appendChild(textarea);

    function syncHighlight() {
        highlighted.innerHTML = highlight(textarea.value) + "\n";
    }

    textarea.addEventListener("input", syncHighlight);
    textarea.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            parseAndEncode(textarea.value);
        }
    });


    textarea.addEventListener("scroll", () => {
        backdrop.scrollTop = textarea.scrollTop;
        backdrop.scrollLeft = textarea.scrollLeft;
    });

    // Seed with example code
    textarea.value =
        "DECLARE x 0;\n" +
        "SET x 42;\n" +
        "INCREMENT x;\n" +
        "DRAW_SQUARE 0 0 100 100;\n" +
        "DRAW_CIRCLE 50 50 25;\n" +
        "IFMORE x 10;\n" +
        '  LOG "x is big";\n' +
        '  LOG "hello world";\n' +
        "ENDIF;\n" +
        "DECREMENT x;\n";

    syncHighlight();
})();
