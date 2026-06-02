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
    "IF",
    "WAIT",
    "STOP",
    "CLEAR"
]);
const METHOD_LIST = Array.from(METHODS);

const varValues = new Map();
function setVarValue(name, value) { varValues.set(name, value); }
function getVarValue(name)        { return varValues.get(name); }


// ─────────────────────────────────────────
//  Parser
// ─────────────────────────────────────────
function parse(source) {
    return source
        .split(";")
        .map(line => line.trim())
        .filter(line => line.length > 0)
        .map(line => {
            const tokens = [];
            const re = /(["']).*?\1|\S+/g;
            let m;
            while ((m = re.exec(line)) !== null) tokens.push(m[0]);

            if (tokens[0] === "IF" && tokens.length === 4) {
                const left = tokens[1], op = tokens[2], right = tokens[3];
                if (op === ">")  return ["IFMORE",  left, right];
                if (op === "<")  return ["IFLESS",  left, right];
                if (op === "==") return ["IFEQUAL", left, right];
            }
            return tokens;
        })
        .filter(tokens => tokens.length > 0 && METHODS.has(tokens[0]));
}

function parseAndEncode(source) {
    const instructions = parse(source);
    const bytes = encodeProgram(instructions);
    return { instructions, bytes };
}


// ─────────────────────────────────────────
//  Bytecode encoder
// ─────────────────────────────────────────
function encodeProgram(instructions) {
    const bytes = [];
    const varTable = new Map();
    let varCount = 0;

    function getVarIndex(name) {
        if (!varTable.has(name)) varTable.set(name, varCount++);
        return varTable.get(name);
    }

    // Arg 0 of these instructions is a plain string name, not a var lookup
    const NAME_IN_ARG0 = new Set([
        "DECLARE", "SET", "INCREMENT", "DECREMENT", "P"
        // NOTE: JUMP is intentionally excluded so its arg goes through
        // normal token encoding — a bare word becomes a var-ref, a quoted
        // string becomes a string literal, and a $var gets its value inlined.
    ]);

    for (const inst of instructions) {
        if (inst.length === 0) continue;
        const method = inst[0];
        const args   = inst.slice(1);
        const methodIndex = METHOD_LIST.indexOf(method);
        if (methodIndex === -1) { console.warn("Unknown method:", method); continue; }

        bytes.push(0, methodIndex);

        for (let a = 0; a < args.length; a++) {
            const token = args[a];
            if (
                a === 0 &&
                NAME_IN_ARG0.has(method) &&
                !token.startsWith("$") &&
                !/^(["']).*\1$/.test(token)
            ) {
                // Encode as a plain string name
                const strBytes = stringToBytes(token);
                bytes.push(4, strBytes.length);
                for (const b of strBytes) bytes.push(b);
            } else {
                encodeToken(token, bytes, getVarIndex, getVarValue);
            }
        }

        bytes.push(0xFF); // end-of-instruction marker
    }

    return Uint8Array.from(bytes);
}

function stringToBytes(str) {
    const arr = [];
    for (let i = 0; i < str.length; i++) arr.push(str.charCodeAt(i) & 0xFF);
    return arr;
}

function float32ToBytes(num) {
    const buf  = new ArrayBuffer(4);
    const view = new DataView(buf);
    view.setFloat32(0, num, false);
    return [view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3)];
}

function encodeToken(token, out, getVarIndex, getVarValue) {
    if (token.startsWith("$")) {
        const varName = token.slice(1);
        const value   = getVarValue(varName);
        const { type, bytes } = encodeRawValue(value);
        out.push(5, type);
        for (const b of bytes) out.push(b);
        return;
    }
    if (/^(["']).*\1$/.test(token)) {
        const inner    = token.slice(1, -1);
        const strBytes = stringToBytes(inner);
        out.push(4, strBytes.length);
        for (const b of strBytes) out.push(b);
        return;
    }
    if (/^-?\d+(\.\d+)?$/.test(token)) {
        const { type, bytes } = encodeRawValue(parseFloat(token));
        out.push(type);
        for (const b of bytes) out.push(b);
        return;
    }
    // Bare word → variable reference
    const idx = getVarIndex(token);
    out.push(6, idx & 0xFF);
}

function encodeRawValue(value) {
    if (typeof value === "string" && !/^-?\d/.test(value)) {
        const bytes = stringToBytes(value);
        return { type: 4, bytes: [bytes.length, ...bytes] };
    }
    const num = typeof value === "string" ? parseFloat(value) : value;
    if (!Number.isInteger(num)) {
        return { type: 3, bytes: float32ToBytes(num) };
    }
    if (num >= -128 && num <= 127) {
        return { type: 1, bytes: [num & 0xFF] };
    }
    return { type: 2, bytes: [(num >> 8) & 0xFF, num & 0xFF] };
}


// ─────────────────────────────────────────
//  Bytecode decoder
// ─────────────────────────────────────────
function decodeProgram(bytes) {
    const instructions = [];
    let i = 0;

    function readByte()  { return bytes[i++]; }

    function readValue(type) {
        switch (type) {
            case 1: { const b = readByte(); return b > 127 ? b - 256 : b; }
            case 2: {
                const hi = readByte(), lo = readByte();
                const raw = (hi << 8) | lo;
                return raw > 32767 ? raw - 65536 : raw;
            }
            case 3: {
                const b0 = readByte(), b1 = readByte(),
                    b2 = readByte(), b3 = readByte();
                const buf  = new ArrayBuffer(4);
                const view = new DataView(buf);
                view.setUint8(0, b0); view.setUint8(1, b1);
                view.setUint8(2, b2); view.setUint8(3, b3);
                return view.getFloat32(0, false);
            }
            case 4: {
                const len = readByte();
                let str = "";
                for (let k = 0; k < len; k++) str += String.fromCharCode(readByte());
                return str;
            }
            default: throw new Error("Unknown value type: " + type);
        }
    }

    while (i < bytes.length) {
        const prefix = readByte();
        if (prefix !== 0x00) {
            console.warn("Expected method prefix 0x00 at byte", i - 1, "got", prefix);
            break;
        }

        const methodIndex = readByte();
        const method = METHOD_LIST[methodIndex];
        if (!method) { console.warn("Unknown method index:", methodIndex); break; }

        const args = [];

        while (i < bytes.length) {
            const tag = bytes[i];
            if (tag === 0xFF) { i++; break; }
            if (tag === 0x00) break;
            i++;

            switch (tag) {
                case 1: args.push(readValue(1)); break;
                case 2: args.push(readValue(2)); break;
                case 3: args.push(readValue(3)); break;
                case 4: args.push(readValue(4)); break;
                case 5: { const subType = readByte(); args.push(readValue(subType)); break; }
                case 6: { const idx = readByte(); args.push({ varRef: idx }); break; }
                default: console.warn("Unknown arg tag:", tag, "at byte", i - 1); break;
            }
        }

        instructions.push({ method, args });
    }

    return instructions;
}


// ─────────────────────────────────────────
//  Interpreter  (generator-based, frame-aware)
//
//  Returns a generator. Each call to .next() runs instructions
//  until one of:
//    • WAIT  n   — suspends for n frames, then resumes
//    • STOP      — halts; generator returns done=true
//    • end of program
//
//  The caller drives the generator from requestAnimationFrame so
//  each "frame" maps directly to one rAF tick.
// ─────────────────────────────────────────
function* interpretGen(decodedInstructions, ctx, log) {
    const STEP_LIMIT = 1_000_000;

    // ── Variable store ────────────────────
    const vars       = [];
    const varNames   = [];
    let   varCounter = 0;
    const nameToIdx  = new Map();

    function ensureVar(name) {
        if (!nameToIdx.has(name)) {
            nameToIdx.set(name, varCounter);
            varNames[varCounter] = name;
            varCounter++;
        }
        return nameToIdx.get(name);
    }

    function resolveArg(arg) {
        if (arg !== null && typeof arg === "object" && "varRef" in arg) {
            return vars[arg.varRef] ?? 0;
        }
        return arg;
    }

    // Pre-scan: register declared variable names in order
    for (const { method, args } of decodedInstructions) {
        if (method === "DECLARE" && args.length >= 1 && typeof args[0] === "string") {
            ensureVar(args[0]);
        }
    }

    // ── Label table ───────────────────────
    const labelMap = new Map();
    for (let i = 0; i < decodedInstructions.length; i++) {
        const { method, args } = decodedInstructions[i];
        if (method === "P" && args.length >= 1) {
            const name = String(resolveArg(args[0]));
            if (!labelMap.has(name)) labelMap.set(name, i);
            else log(`[warn] duplicate label "${name}", keeping first`);
        }
    }

    // Default canvas style
    ctx.strokeStyle = "#ffffff";
    ctx.fillStyle   = "rgba(255,255,255,0.15)";
    ctx.lineWidth   = 2;

    // ── Conditional stack ─────────────────
    const condStack = [];
    function isActive() { return condStack.every(c => c.active); }

    // ── Program counter loop ──────────────
    let pc    = 0;
    let steps = 0;
    const len = decodedInstructions.length;

    while (pc < len) {
        if (++steps > STEP_LIMIT) {
            log(`[error] step limit (${STEP_LIMIT}) reached — infinite loop?`);
            return;
        }

        const { method, args } = decodedInstructions[pc];
        let nextPc = pc + 1;

        // ── ENDIF ──────────────────────────
        if (method === "ENDIF") {
            condStack.pop();
            pc = nextPc;
            continue;
        }

        // ── Conditional openers ────────────
        if (method === "IFMORE" || method === "IFLESS" || method === "IFEQUAL") {
            if (!isActive()) {
                condStack.push({ active: false });
            } else {
                const a = resolveArg(args[0]);
                const b = resolveArg(args[1]);
                let active = false;
                if (method === "IFMORE")  active = a >  b;
                if (method === "IFLESS")  active = a <  b;
                if (method === "IFEQUAL") active = a == b;
                condStack.push({ active });
            }
            pc = nextPc;
            continue;
        }

        // ── P — label marker, no-op ────────
        if (method === "P") { pc = nextPc; continue; }

        // Skip body of false branch
        if (!isActive()) { pc = nextPc; continue; }

        // ── STOP ───────────────────────────
        if (method === "STOP") {
            log("[stopped]");
            return; // generator done
        }

        // ── WAIT n — suspend for n frames ──
        if (method === "WAIT") {
            let frames = Math.max(1, Math.round(Number(resolveArg(args[0])) || 1));
            while (frames-- > 0) yield; // yield once per frame to wait
            pc = nextPc;
            continue;
        }

        // ── JUMP — variable-friendly ────────
        // arg[0] may be:
        //   • a string literal  → use as label name directly
        //   • a { varRef }      → resolve the variable; its value is the label name
        if (method === "JUMP") {
            const raw    = args[0];
            const target = String(resolveArg(raw)); // works for both cases
            if (!labelMap.has(target)) {
                log(`[error] JUMP to unknown label "${target}"`);
                return;
            }
            condStack.length = 0;
            pc = labelMap.get(target);
            continue;
        }

        // ── CLEAR — clear canvas ───────────
        if (method === "CLEAR") {
            ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
            pc = nextPc;
            continue;
        }

        // ── Standard instructions ──────────
        switch (method) {

            case "DECLARE": {
                const name  = typeof args[0] === "string" ? args[0] : String(args[0]);
                const value = args.length > 1 ? resolveArg(args[1]) : 0;
                vars[ensureVar(name)] = value;
                break;
            }

            case "SET": {
                const name  = typeof args[0] === "string" ? args[0] : String(args[0]);
                const value = resolveArg(args[1]);
                vars[ensureVar(name)] = value;
                break;
            }

            case "INCREMENT": {
                const name = typeof args[0] === "string" ? args[0] : String(args[0]);
                const step = args.length > 1 ? resolveArg(args[1]) : 1;
                const idx  = ensureVar(name);
                vars[idx]  = (vars[idx] ?? 0) + step;
                break;
            }

            case "DECREMENT": {
                const name = typeof args[0] === "string" ? args[0] : String(args[0]);
                const step = args.length > 1 ? resolveArg(args[1]) : 1;
                const idx  = ensureVar(name);
                vars[idx]  = (vars[idx] ?? 0) - step;
                break;
            }

            case "DRAW_SQUARE": {
                const [x, y, w, h] = args.map(resolveArg);
                ctx.beginPath();
                ctx.rect(x, y, w, h);
                ctx.fill();
                ctx.stroke();
                break;
            }

            case "DRAW_CIRCLE": {
                const [cx, cy, r] = args.map(resolveArg);
                ctx.beginPath();
                ctx.arc(cx, cy, r, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
                break;
            }

            case "LOG": {
                const parts = args.map(a => String(resolveArg(a)));
                log(parts.join(" "));
                break;
            }

            default: break;
        }

        pc = nextPc;
    }
}


// ─────────────────────────────────────────
//  Frame runner — drives the generator via rAF
// ─────────────────────────────────────────
let _rafId   = null;
let _running = false;

function stopRunner() {
    if (_rafId !== null) { cancelAnimationFrame(_rafId); _rafId = null; }
    _running = false;
}

function startRunner(gen) {
    stopRunner();
    _running = true;

    function frame() {
        if (!_running) return;
        const result = gen.next();
        if (result.done) { _running = false; return; }
        _rafId = requestAnimationFrame(frame);
    }

    _rafId = requestAnimationFrame(frame);
}


// ─────────────────────────────────────────
//  Run — compile → decode → start frame loop
// ─────────────────────────────────────────
function runCode(source, ctx, log) {
    stopRunner();
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    const { instructions, bytes } = parseAndEncode(source);

    log("─── compile ───────────────────────────");
    log("instructions: " + instructions.length);
    log("bytecode:     " + bytes.length + " bytes");
    log("───────────────────────────────────────");

    const decoded = decodeProgram(bytes);
    const gen     = interpretGen(decoded, ctx, log);
    startRunner(gen);
}


// ─────────────────────────────────────────
//  IF/ENDIF block line computation
// ─────────────────────────────────────────
function computeIfBlockLines(source) {
    const lines  = source.split("\n");
    const marked = new Set();
    const stack  = [];

    for (let i = 0; i < lines.length; i++) {
        const tokens = [];
        const re = /(["']).*?\1|\S+/g;
        let m;
        while ((m = re.exec(lines[i])) !== null) tokens.push(m[0]);
        if (tokens.length === 0) continue;

        const method = tokens[0];
        if (["IFMORE","IFLESS","IFEQUAL","IF"].includes(method)) {
            stack.push(i);
        } else if (method === "ENDIF") {
            const start = stack.pop();
            if (start !== undefined)
                for (let j = start; j <= i; j++) marked.add(j);
        }
    }
    return marked;
}


// ─────────────────────────────────────────
//  Syntax Highlighter
// ─────────────────────────────────────────
function highlight(source) {
    const ifLines = computeIfBlockLines(source);
    return source
        .split("\n")
        .map((line, idx) => highlightLine(line, ifLines.has(idx)))
        .join("\n");
}

function highlightLine(line, inIfBlock = false) {
    const TOKEN_RE = /(["']).*?\1|\s+|\S+/g;
    let result = "";
    let m;

    while ((m = TOKEN_RE.exec(line)) !== null) {
        const part = m[0];
        if (/^\s+$/.test(part)) { result += part; continue; }

        const hasSemi = part.endsWith(";");
        const token   = hasSemi ? part.slice(0, -1) : part;
        const semi    = hasSemi ? '<span class="hl-semi">;</span>' : "";

        if (token.length === 0) { result += semi; continue; }

        if (/^(["']).*\1$/.test(token)) {
            result += '<span class="hl-string">'  + escapeHtml(token) + "</span>" + semi;
        } else if (/^-?\d+(\.\d+)?$/.test(token)) {
            result += '<span class="hl-number">'  + escapeHtml(token) + "</span>" + semi;
        } else if (METHODS.has(token)) {
            result += '<span class="hl-method">'  + escapeHtml(token) + "</span>" + semi;
        } else if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(token)) {
            result += '<span class="hl-var">'     + escapeHtml(token) + "</span>" + semi;
        } else {
            result += escapeHtml(token) + semi;
        }
    }

    return inIfBlock ? '<span class="hl-if-block">' + result + "</span>" : result;
}

function escapeHtml(str) {
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}


// ─────────────────────────────────────────
//  Init
// ─────────────────────────────────────────
(function init() {
    const textarea =
        document.getElementById("lowEditor");
    const canvasEl  = document.querySelector(".canvas");
    const consoleEl = document.querySelector(".console");
    const runBtn    = document.getElementById("runBtn");
    const stopBtn   = document.getElementById("stopBtn"); // optional stop button

    if (!textarea || !canvasEl || !consoleEl) return;

    function resizeCanvas() {
        const rect = canvasEl.parentElement.getBoundingClientRect();
        canvasEl.width  = rect.width  || 600;
        canvasEl.height = rect.height || 300;
    }
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);

    const ctx = canvasEl.getContext("2d");

    function log(msg) {
        consoleEl.value += (consoleEl.value ? "\n" : "") + msg;
        consoleEl.scrollTop = consoleEl.scrollHeight;
    }

    // ── Syntax highlight backdrop ─────────
    const wrapper     = document.createElement("div");
    wrapper.className = "editor-wrapper";
    const backdrop    = document.createElement("div");
    backdrop.className = "editor-backdrop";
    const highlighted  = document.createElement("div");
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
        backdrop.scrollTop  = textarea.scrollTop;
        backdrop.scrollLeft = textarea.scrollLeft;
    });

    // ── Buttons ───────────────────────────
    function doRun() {
        consoleEl.value = "";
        try { runCode(textarea.value, ctx, log); }
        catch (err) { log("[error] " + err.message); console.error(err); }
    }

    if (runBtn)  runBtn.addEventListener("click", doRun);
    if (stopBtn) stopBtn.addEventListener("click", stopRunner);

    textarea.addEventListener("keydown", (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); doRun(); }
    });

    // ── Seed example — bouncing ball game loop ──
    textarea.value = [
        "DECLARE x 300;",
        "DECLARE y 150;",
        "DECLARE dx 3;",
        "DECLARE dy 2;",
        "DECLARE r 12;",
        "",
        "P 0;",
        "  CLEAR;",
        "  DRAW_CIRCLE x y r;",
        "  INCREMENT x dx;",
        "  INCREMENT y dy;",
        "",
        "  IFMORE x 580;",
        "    SET dx -3;",
        "  ENDIF;",
        "  IFLESS x 20;",
        "    SET dx 3;",
        "  ENDIF;",
        "  IFMORE y 280;",
        "    SET dy -2;",
        "  ENDIF;",
        "  IFLESS y 20;",
        "    SET dy 2;",
        "  ENDIF;",
        "",
        "  WAIT 1;",
        "  JUMP 0;",
    ].join("\n");

    syncHighlight();
})();
