import wasmUrl from '@/assets/wasm/ingest.wasm?url';

// vite does weird things to urls, and it does weird things to
const workerScript = `
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
let wasm;
let script;
let input;
let waiter;
onmessage = function(ev) {
  [wasm, script, input] = ev.data;
  if (waiter) {
    waiter();
  }
};
console.log("worker sending message");
postMessage("worker started");

(async () => {
  let retval = null;
  try {
    // obtain script and input from main thread
    if (!script) {
      console.log("no script yet");
      await new Promise((result) => {
        waiter = result;
      });
    }
    console.log("wasm:", wasm.length, "script:", script);

    // TODO: figure out the right caching options
    const env = {
      webc_print: webc_print,
      webc_setjmp: webc_setjmp,
      webc_longjmp: webc_longjmp,
      webc_getrandom: webc_getrandom,
      webc_sbrk: webc_sbrk,
      js_export: js_export,
    };
    postMessage('running');
    const x = await WebAssembly.instantiate(wasm, {env: env});
    // const x = await WebAssembly.instantiateStreaming(fetch(url), {env: env});
    // const x = await WebAssembly.instantiateStreaming(fetch(wasmUrl), {env: env});
    instance = x.instance;
    // instance = await init(env);


    // actually run the user's code
    const [ scriptPtr ] = js2c(script);
    const [ inputPtr] = js2c(input);

    retval = instance.exports.run(scriptPtr, inputPtr);

  } catch(e) {
    postMessage({ error: e });

  } finally {
    postMessage({ retval: retval });
  }
})();
`;

export async function newIngestWorker(
  script: string, input: string, onmessage: (event: MessageEvent) => void
): Promise<Worker> {
  // do the fetch of the static asset in the main thread because vite is weird
  const response = await fetch(wasmUrl);
  const bytes = await response.arrayBuffer();

  const blob = new Blob([workerScript], { type: "application/javascript" });
  const url = URL.createObjectURL(blob);
  const worker = new Worker(url);

  worker.onmessage = onmessage;

  // send initialization message
  worker.postMessage([bytes, script, input]);

  return worker;
}
//
// export function noop(){
//   console.log("noop");
// }
//
// // newIngestWorker();
//
// const script = "print('input was ' .. input)";
// const input = "hello world";
//
// await new Promise(async (result) => {
//   const onmessage = (event) => {
//     console.log("onmessage", event.data);
//     result();
//   };
//   const worker = newIngestWorker(script, input, onmessage);
// });

//////////////////////////////////////

// class LongjmpError extends Error {
//   constructor(jmpId, jmpVal) {
//     super("longjmp");
//     this.jmpId = jmpId;
//     this.jmpVal = jmpVal;
//   }
// };
//
// let nextJmpId = 1;
//
// let instance;
//
// // returns a javascript string copied from C memory
// const c2js = (ptr, len) => {
//   const arr = new Uint8Array(instance.exports.memory.buffer, ptr, len);
//   return new TextDecoder().decode(arr);
// };
//
// // copies a javascript string into newly-allocated C memory
// const js2c = (str) => {
//   const cap = str.length * 3 + 1;
//   const ptr = instance.exports.malloc(cap);
//   if (ptr === 0) throw new Error("out of memory");
//   const arr = new Uint8Array(instance.exports.memory.buffer, ptr, cap);
//   const { len } = new TextEncoder().encodeInto(str, arr);
//   return [ ptr, len ];
// };
//
// const webc_print = (ptr, len) => {
//   // forward logs to the main thread
//   console.log({ log: c2js(ptr, len) });
// };
//
// const js_export = (json) => {
//   // forward exports to the main thread
//   // postMessage({ export: json });
// };
//
// const webc_setjmp = (jmpBuf, fn, arg) => {
//   // pick a unique jmpId here in javascript
//   const jmpId = nextJmpId++;
//   try {
//     instance.exports._setjmp_inner(jmpBuf, fn, arg, jmpId);
//   } catch(e) {
//     if (e.jmpId === jmpId) {
//       return e.jmpVal;
//     }
//     // not our error; ignore it.
//     throw e;
//   }
//   return 0;
// };
//
// const webc_longjmp = (jmpId, jmpVal) => {
//   throw new LongjmpError(jmpId, jmpVal);
// };
//
// const webc_getrandom = (ptr, len) => {
//   const arr = new Int8Array(instance.exports.memory.buffer, ptr, len);
//   crypto.getRandomValues(arr);
// };
//
// const webc_sbrk = (incr) => {
//   const mem = instance.exports.memory;
//   const oldbrk = mem.buffer.byteLength;
//   if(incr > 0){
//     const pages = Math.ceil(incr / (64*1024));
//     mem.grow(pages);
//   }
//   return oldbrk;
// };
//
// const env = {
//   webc_print: webc_print,
//   webc_setjmp: webc_setjmp,
//   webc_longjmp: webc_longjmp,
//   webc_getrandom: webc_getrandom,
//   webc_sbrk: webc_sbrk,
//   js_export: js_export,
// };
//
// instance = await init({env: env});
//
// const [ scriptPtr ] = js2c(script);
// const [ inputPtr] = js2c(input);
//
// const retval = instance.exports.run(scriptPtr, inputPtr);
// console.log('retval', retval);
