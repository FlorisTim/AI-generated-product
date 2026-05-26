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
]);

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
            return tokens;
        })
        .filter(tokens => tokens.length > 0 && METHODS.has(tokens[0]));
}


// ─────────────────────────────────────────
//  Syntax Highlighter
//  Returns an HTML string with spans applied.
//  Call this whenever the editor content changes.
// ─────────────────────────────────────────
function highlight(source) {
    return source
        .split("\n")
        .map(line => highlightLine(line))
        .join("\n");
}

function highlightLine(line) {
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

        // Everything else (variable names, operators…)
        result += escapeHtml(token) + semi;
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