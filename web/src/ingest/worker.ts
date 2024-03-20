// import wasmUrl from './ingest.wasm?url';
// import init from './ingest.wasm?init';

class LongjmpError extends Error {
  constructor(jmpId, jmpVal) {
    super("longjmp");
    this.jmpId = jmpId;
    this.jmpVal = jmpVal;
  }
};

let nextJmpId = 1;

let instance;

// returns a javascript string copied from C memory
const c2js = (ptr, len) => {
  const arr = new Uint8Array(instance.exports.memory.buffer, ptr, len);
  return new TextDecoder().decode(arr);
};

// copies a javascript string into newly-allocated C memory
const js2c = (str) => {
  const cap = str.length * 3 + 1;
  const ptr = instance.exports.malloc(cap);
  if (ptr === 0) throw new Error("out of memory");
  const arr = new Uint8Array(instance.exports.memory.buffer, ptr, cap);
  const { len } = new TextEncoder().encodeInto(str, arr);
  return [ ptr, len ];
};

const webc_print = (ptr, len) => {
  // forward logs to the main thread
  postMessage({ log: c2js(ptr, len) });
};

const js_export = (json) => {
  // forward exports to the main thread
  postMessage({ export: json });
};

const webc_setjmp = (jmpBuf, fn, arg) => {
  // pick a unique jmpId here in javascript
  const jmpId = nextJmpId++;
  try {
    instance.exports._setjmp_inner(jmpBuf, fn, arg, jmpId);
  } catch(e) {
    if (e.jmpId === jmpId) {
      return e.jmpVal;
    }
    // not our error; ignore it.
    throw e;
  }
  return 0;
};

const webc_longjmp = (jmpId, jmpVal) => {
  throw new LongjmpError(jmpId, jmpVal);
};

const webc_getrandom = (ptr, len) => {
  const arr = new Int8Array(instance.exports.memory.buffer, ptr, len);
  crypto.getRandomValues(arr);
};

const webc_sbrk = (incr) => {
  const mem = instance.exports.memory;
  const oldbrk = mem.buffer.byteLength;
  if(incr > 0){
    const pages = Math.ceil(incr / (64*1024));
    mem.grow(pages);
  }
  return oldbrk;
};

// handle incoming data
let script;
let input;
let waiter;
onmessage = function(ev) {
  console.log("onmessage", ev);
  [script, input] = ev.data;
  if (waiter) {
    waiter();
  }
};
console.log("worker sending message");
postMessage("worker started");

(async () => {
  let retval = null;
  try {
    // TODO: figure out the right caching options
    const response = await fetch("./ingest.wasm");
    const bytes = await response.arrayBuffer();
    const env = {
      webc_print: webc_print,
      webc_setjmp: webc_setjmp,
      webc_longjmp: webc_longjmp,
      webc_getrandom: webc_getrandom,
      webc_sbrk: webc_sbrk,
      js_export: js_export,
    };
    const x = await WebAssembly.instantiate(bytes, {env: env});
    // const x = await WebAssembly.instantiateStreaming(fetch(url), {env: env});
    // const x = await WebAssembly.instantiateStreaming(fetch(wasmUrl), {env: env});
    instance = x.instance;
    // instance = await init(env);

    // obtain script and input from main thread
    if (!script) {
      console.log("no script yet");
      await new Promise((result) => {
        waiter = result;
      });
    } else {
      console.log("script:", script);
    }

    // actually run the user's code
    const [ scriptPtr ] = js2c(script);
    const [ inputPtr] = js2c(input);

    retval = instance.exports.run(scriptPtr, inputPtr);

  } finally {
    postMessage({ retval: retval });
  }
})();
