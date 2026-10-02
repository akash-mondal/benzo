import { createRequire } from "node:module"; const require = createRequire(import.meta.url);
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});
var __commonJS = (cb, mod2) => function __require2() {
  try {
    return mod2 || (0, cb[__getOwnPropNames(cb)[0]])((mod2 = { exports: {} }).exports, mod2), mod2.exports;
  } catch (e) {
    throw mod2 = 0, e;
  }
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod2, isNodeMode, target) => (target = mod2 != null ? __create(__getProtoOf(mod2)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod2 || !mod2.__esModule ? __defProp(target, "default", { value: mod2, enumerable: true }) : target,
  mod2
));

// node_modules/@noble/hashes/cryptoNode.js
var require_cryptoNode = __commonJS({
  "node_modules/@noble/hashes/cryptoNode.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.crypto = void 0;
    var nc2 = __require("node:crypto");
    exports.crypto = nc2 && typeof nc2 === "object" && "webcrypto" in nc2 ? nc2.webcrypto : nc2 && typeof nc2 === "object" && "randomBytes" in nc2 ? nc2 : void 0;
  }
});

// node_modules/@noble/hashes/utils.js
var require_utils = __commonJS({
  "node_modules/@noble/hashes/utils.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.wrapXOFConstructorWithOpts = exports.wrapConstructorWithOpts = exports.wrapConstructor = exports.Hash = exports.nextTick = exports.swap32IfBE = exports.byteSwapIfBE = exports.swap8IfBE = exports.isLE = void 0;
    exports.isBytes = isBytes2;
    exports.anumber = anumber2;
    exports.abytes = abytes2;
    exports.ahash = ahash;
    exports.aexists = aexists2;
    exports.aoutput = aoutput2;
    exports.u8 = u8;
    exports.u32 = u32;
    exports.clean = clean2;
    exports.createView = createView2;
    exports.rotr = rotr2;
    exports.rotl = rotl;
    exports.byteSwap = byteSwap;
    exports.byteSwap32 = byteSwap32;
    exports.bytesToHex = bytesToHex2;
    exports.hexToBytes = hexToBytes2;
    exports.asyncLoop = asyncLoop;
    exports.utf8ToBytes = utf8ToBytes2;
    exports.bytesToUtf8 = bytesToUtf82;
    exports.toBytes = toBytes2;
    exports.kdfInputToBytes = kdfInputToBytes;
    exports.concatBytes = concatBytes2;
    exports.checkOpts = checkOpts;
    exports.createHasher = createHasher3;
    exports.createOptHasher = createOptHasher;
    exports.createXOFer = createXOFer;
    exports.randomBytes = randomBytes2;
    var crypto_1 = require_cryptoNode();
    function isBytes2(a) {
      return a instanceof Uint8Array || ArrayBuffer.isView(a) && a.constructor.name === "Uint8Array";
    }
    function anumber2(n) {
      if (!Number.isSafeInteger(n) || n < 0)
        throw new Error("positive integer expected, got " + n);
    }
    function abytes2(b, ...lengths) {
      if (!isBytes2(b))
        throw new Error("Uint8Array expected");
      if (lengths.length > 0 && !lengths.includes(b.length))
        throw new Error("Uint8Array expected of length " + lengths + ", got length=" + b.length);
    }
    function ahash(h) {
      if (typeof h !== "function" || typeof h.create !== "function")
        throw new Error("Hash should be wrapped by utils.createHasher");
      anumber2(h.outputLen);
      anumber2(h.blockLen);
    }
    function aexists2(instance, checkFinished = true) {
      if (instance.destroyed)
        throw new Error("Hash instance has been destroyed");
      if (checkFinished && instance.finished)
        throw new Error("Hash#digest() has already been called");
    }
    function aoutput2(out, instance) {
      abytes2(out);
      const min = instance.outputLen;
      if (out.length < min) {
        throw new Error("digestInto() expects output buffer of length at least " + min);
      }
    }
    function u8(arr) {
      return new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
    }
    function u32(arr) {
      return new Uint32Array(arr.buffer, arr.byteOffset, Math.floor(arr.byteLength / 4));
    }
    function clean2(...arrays) {
      for (let i = 0; i < arrays.length; i++) {
        arrays[i].fill(0);
      }
    }
    function createView2(arr) {
      return new DataView(arr.buffer, arr.byteOffset, arr.byteLength);
    }
    function rotr2(word, shift) {
      return word << 32 - shift | word >>> shift;
    }
    function rotl(word, shift) {
      return word << shift | word >>> 32 - shift >>> 0;
    }
    exports.isLE = (() => new Uint8Array(new Uint32Array([287454020]).buffer)[0] === 68)();
    function byteSwap(word) {
      return word << 24 & 4278190080 | word << 8 & 16711680 | word >>> 8 & 65280 | word >>> 24 & 255;
    }
    exports.swap8IfBE = exports.isLE ? (n) => n : (n) => byteSwap(n);
    exports.byteSwapIfBE = exports.swap8IfBE;
    function byteSwap32(arr) {
      for (let i = 0; i < arr.length; i++) {
        arr[i] = byteSwap(arr[i]);
      }
      return arr;
    }
    exports.swap32IfBE = exports.isLE ? (u) => u : byteSwap32;
    var hasHexBuiltin2 = /* @__PURE__ */ (() => (
      // @ts-ignore
      typeof Uint8Array.from([]).toHex === "function" && typeof Uint8Array.fromHex === "function"
    ))();
    var hexes2 = /* @__PURE__ */ Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));
    function bytesToHex2(bytes) {
      abytes2(bytes);
      if (hasHexBuiltin2)
        return bytes.toHex();
      let hex = "";
      for (let i = 0; i < bytes.length; i++) {
        hex += hexes2[bytes[i]];
      }
      return hex;
    }
    var asciis2 = { _0: 48, _9: 57, A: 65, F: 70, a: 97, f: 102 };
    function asciiToBase162(ch) {
      if (ch >= asciis2._0 && ch <= asciis2._9)
        return ch - asciis2._0;
      if (ch >= asciis2.A && ch <= asciis2.F)
        return ch - (asciis2.A - 10);
      if (ch >= asciis2.a && ch <= asciis2.f)
        return ch - (asciis2.a - 10);
      return;
    }
    function hexToBytes2(hex) {
      if (typeof hex !== "string")
        throw new Error("hex string expected, got " + typeof hex);
      if (hasHexBuiltin2)
        return Uint8Array.fromHex(hex);
      const hl = hex.length;
      const al = hl / 2;
      if (hl % 2)
        throw new Error("hex string expected, got unpadded hex of length " + hl);
      const array = new Uint8Array(al);
      for (let ai = 0, hi = 0; ai < al; ai++, hi += 2) {
        const n1 = asciiToBase162(hex.charCodeAt(hi));
        const n2 = asciiToBase162(hex.charCodeAt(hi + 1));
        if (n1 === void 0 || n2 === void 0) {
          const char = hex[hi] + hex[hi + 1];
          throw new Error('hex string expected, got non-hex character "' + char + '" at index ' + hi);
        }
        array[ai] = n1 * 16 + n2;
      }
      return array;
    }
    var nextTick = async () => {
    };
    exports.nextTick = nextTick;
    async function asyncLoop(iters, tick, cb) {
      let ts = Date.now();
      for (let i = 0; i < iters; i++) {
        cb(i);
        const diff = Date.now() - ts;
        if (diff >= 0 && diff < tick)
          continue;
        await (0, exports.nextTick)();
        ts += diff;
      }
    }
    function utf8ToBytes2(str) {
      if (typeof str !== "string")
        throw new Error("string expected");
      return new Uint8Array(new TextEncoder().encode(str));
    }
    function bytesToUtf82(bytes) {
      return new TextDecoder().decode(bytes);
    }
    function toBytes2(data) {
      if (typeof data === "string")
        data = utf8ToBytes2(data);
      abytes2(data);
      return data;
    }
    function kdfInputToBytes(data) {
      if (typeof data === "string")
        data = utf8ToBytes2(data);
      abytes2(data);
      return data;
    }
    function concatBytes2(...arrays) {
      let sum = 0;
      for (let i = 0; i < arrays.length; i++) {
        const a = arrays[i];
        abytes2(a);
        sum += a.length;
      }
      const res = new Uint8Array(sum);
      for (let i = 0, pad = 0; i < arrays.length; i++) {
        const a = arrays[i];
        res.set(a, pad);
        pad += a.length;
      }
      return res;
    }
    function checkOpts(defaults, opts) {
      if (opts !== void 0 && {}.toString.call(opts) !== "[object Object]")
        throw new Error("options should be object or undefined");
      const merged = Object.assign(defaults, opts);
      return merged;
    }
    var Hash2 = class {
    };
    exports.Hash = Hash2;
    function createHasher3(hashCons) {
      const hashC = (msg) => hashCons().update(toBytes2(msg)).digest();
      const tmp = hashCons();
      hashC.outputLen = tmp.outputLen;
      hashC.blockLen = tmp.blockLen;
      hashC.create = () => hashCons();
      return hashC;
    }
    function createOptHasher(hashCons) {
      const hashC = (msg, opts) => hashCons(opts).update(toBytes2(msg)).digest();
      const tmp = hashCons({});
      hashC.outputLen = tmp.outputLen;
      hashC.blockLen = tmp.blockLen;
      hashC.create = (opts) => hashCons(opts);
      return hashC;
    }
    function createXOFer(hashCons) {
      const hashC = (msg, opts) => hashCons(opts).update(toBytes2(msg)).digest();
      const tmp = hashCons({});
      hashC.outputLen = tmp.outputLen;
      hashC.blockLen = tmp.blockLen;
      hashC.create = (opts) => hashCons(opts);
      return hashC;
    }
    exports.wrapConstructor = createHasher3;
    exports.wrapConstructorWithOpts = createOptHasher;
    exports.wrapXOFConstructorWithOpts = createXOFer;
    function randomBytes2(bytesLength = 32) {
      if (crypto_1.crypto && typeof crypto_1.crypto.getRandomValues === "function") {
        return crypto_1.crypto.getRandomValues(new Uint8Array(bytesLength));
      }
      if (crypto_1.crypto && typeof crypto_1.crypto.randomBytes === "function") {
        return Uint8Array.from(crypto_1.crypto.randomBytes(bytesLength));
      }
      throw new Error("crypto.getRandomValues must be defined");
    }
  }
});

// node_modules/@noble/hashes/_md.js
var require_md = __commonJS({
  "node_modules/@noble/hashes/_md.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.SHA512_IV = exports.SHA384_IV = exports.SHA224_IV = exports.SHA256_IV = exports.HashMD = void 0;
    exports.setBigUint64 = setBigUint642;
    exports.Chi = Chi2;
    exports.Maj = Maj2;
    var utils_ts_1 = require_utils();
    function setBigUint642(view, byteOffset, value, isLE) {
      if (typeof view.setBigUint64 === "function")
        return view.setBigUint64(byteOffset, value, isLE);
      const _32n = BigInt(32);
      const _u32_max = BigInt(4294967295);
      const wh = Number(value >> _32n & _u32_max);
      const wl = Number(value & _u32_max);
      const h = isLE ? 4 : 0;
      const l = isLE ? 0 : 4;
      view.setUint32(byteOffset + h, wh, isLE);
      view.setUint32(byteOffset + l, wl, isLE);
    }
    function Chi2(a, b, c) {
      return a & b ^ ~a & c;
    }
    function Maj2(a, b, c) {
      return a & b ^ a & c ^ b & c;
    }
    var HashMD2 = class extends utils_ts_1.Hash {
      constructor(blockLen, outputLen, padOffset, isLE) {
        super();
        this.finished = false;
        this.length = 0;
        this.pos = 0;
        this.destroyed = false;
        this.blockLen = blockLen;
        this.outputLen = outputLen;
        this.padOffset = padOffset;
        this.isLE = isLE;
        this.buffer = new Uint8Array(blockLen);
        this.view = (0, utils_ts_1.createView)(this.buffer);
      }
      update(data) {
        (0, utils_ts_1.aexists)(this);
        data = (0, utils_ts_1.toBytes)(data);
        (0, utils_ts_1.abytes)(data);
        const { view, buffer, blockLen } = this;
        const len = data.length;
        for (let pos = 0; pos < len; ) {
          const take = Math.min(blockLen - this.pos, len - pos);
          if (take === blockLen) {
            const dataView = (0, utils_ts_1.createView)(data);
            for (; blockLen <= len - pos; pos += blockLen)
              this.process(dataView, pos);
            continue;
          }
          buffer.set(data.subarray(pos, pos + take), this.pos);
          this.pos += take;
          pos += take;
          if (this.pos === blockLen) {
            this.process(view, 0);
            this.pos = 0;
          }
        }
        this.length += data.length;
        this.roundClean();
        return this;
      }
      digestInto(out) {
        (0, utils_ts_1.aexists)(this);
        (0, utils_ts_1.aoutput)(out, this);
        this.finished = true;
        const { buffer, view, blockLen, isLE } = this;
        let { pos } = this;
        buffer[pos++] = 128;
        (0, utils_ts_1.clean)(this.buffer.subarray(pos));
        if (this.padOffset > blockLen - pos) {
          this.process(view, 0);
          pos = 0;
        }
        for (let i = pos; i < blockLen; i++)
          buffer[i] = 0;
        setBigUint642(view, blockLen - 8, BigInt(this.length * 8), isLE);
        this.process(view, 0);
        const oview = (0, utils_ts_1.createView)(out);
        const len = this.outputLen;
        if (len % 4)
          throw new Error("_sha2: outputLen should be aligned to 32bit");
        const outLen = len / 4;
        const state = this.get();
        if (outLen > state.length)
          throw new Error("_sha2: outputLen bigger than state");
        for (let i = 0; i < outLen; i++)
          oview.setUint32(4 * i, state[i], isLE);
      }
      digest() {
        const { buffer, outputLen } = this;
        this.digestInto(buffer);
        const res = buffer.slice(0, outputLen);
        this.destroy();
        return res;
      }
      _cloneInto(to) {
        to || (to = new this.constructor());
        to.set(...this.get());
        const { blockLen, buffer, length, finished, destroyed, pos } = this;
        to.destroyed = destroyed;
        to.finished = finished;
        to.length = length;
        to.pos = pos;
        if (length % blockLen)
          to.buffer.set(buffer);
        return to;
      }
      clone() {
        return this._cloneInto();
      }
    };
    exports.HashMD = HashMD2;
    exports.SHA256_IV = Uint32Array.from([
      1779033703,
      3144134277,
      1013904242,
      2773480762,
      1359893119,
      2600822924,
      528734635,
      1541459225
    ]);
    exports.SHA224_IV = Uint32Array.from([
      3238371032,
      914150663,
      812702999,
      4144912697,
      4290775857,
      1750603025,
      1694076839,
      3204075428
    ]);
    exports.SHA384_IV = Uint32Array.from([
      3418070365,
      3238371032,
      1654270250,
      914150663,
      2438529370,
      812702999,
      355462360,
      4144912697,
      1731405415,
      4290775857,
      2394180231,
      1750603025,
      3675008525,
      1694076839,
      1203062813,
      3204075428
    ]);
    exports.SHA512_IV = Uint32Array.from([
      1779033703,
      4089235720,
      3144134277,
      2227873595,
      1013904242,
      4271175723,
      2773480762,
      1595750129,
      1359893119,
      2917565137,
      2600822924,
      725511199,
      528734635,
      4215389547,
      1541459225,
      327033209
    ]);
  }
});

// node_modules/@noble/hashes/_u64.js
var require_u64 = __commonJS({
  "node_modules/@noble/hashes/_u64.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.toBig = exports.shrSL = exports.shrSH = exports.rotrSL = exports.rotrSH = exports.rotrBL = exports.rotrBH = exports.rotr32L = exports.rotr32H = exports.rotlSL = exports.rotlSH = exports.rotlBL = exports.rotlBH = exports.add5L = exports.add5H = exports.add4L = exports.add4H = exports.add3L = exports.add3H = void 0;
    exports.add = add;
    exports.fromBig = fromBig;
    exports.split = split;
    var U32_MASK64 = /* @__PURE__ */ BigInt(2 ** 32 - 1);
    var _32n = /* @__PURE__ */ BigInt(32);
    function fromBig(n, le = false) {
      if (le)
        return { h: Number(n & U32_MASK64), l: Number(n >> _32n & U32_MASK64) };
      return { h: Number(n >> _32n & U32_MASK64) | 0, l: Number(n & U32_MASK64) | 0 };
    }
    function split(lst, le = false) {
      const len = lst.length;
      let Ah = new Uint32Array(len);
      let Al = new Uint32Array(len);
      for (let i = 0; i < len; i++) {
        const { h, l } = fromBig(lst[i], le);
        [Ah[i], Al[i]] = [h, l];
      }
      return [Ah, Al];
    }
    var toBig = (h, l) => BigInt(h >>> 0) << _32n | BigInt(l >>> 0);
    exports.toBig = toBig;
    var shrSH = (h, _l, s) => h >>> s;
    exports.shrSH = shrSH;
    var shrSL = (h, l, s) => h << 32 - s | l >>> s;
    exports.shrSL = shrSL;
    var rotrSH = (h, l, s) => h >>> s | l << 32 - s;
    exports.rotrSH = rotrSH;
    var rotrSL = (h, l, s) => h << 32 - s | l >>> s;
    exports.rotrSL = rotrSL;
    var rotrBH = (h, l, s) => h << 64 - s | l >>> s - 32;
    exports.rotrBH = rotrBH;
    var rotrBL = (h, l, s) => h >>> s - 32 | l << 64 - s;
    exports.rotrBL = rotrBL;
    var rotr32H = (_h, l) => l;
    exports.rotr32H = rotr32H;
    var rotr32L = (h, _l) => h;
    exports.rotr32L = rotr32L;
    var rotlSH = (h, l, s) => h << s | l >>> 32 - s;
    exports.rotlSH = rotlSH;
    var rotlSL = (h, l, s) => l << s | h >>> 32 - s;
    exports.rotlSL = rotlSL;
    var rotlBH = (h, l, s) => l << s - 32 | h >>> 64 - s;
    exports.rotlBH = rotlBH;
    var rotlBL = (h, l, s) => h << s - 32 | l >>> 64 - s;
    exports.rotlBL = rotlBL;
    function add(Ah, Al, Bh, Bl) {
      const l = (Al >>> 0) + (Bl >>> 0);
      return { h: Ah + Bh + (l / 2 ** 32 | 0) | 0, l: l | 0 };
    }
    var add3L = (Al, Bl, Cl) => (Al >>> 0) + (Bl >>> 0) + (Cl >>> 0);
    exports.add3L = add3L;
    var add3H = (low, Ah, Bh, Ch) => Ah + Bh + Ch + (low / 2 ** 32 | 0) | 0;
    exports.add3H = add3H;
    var add4L = (Al, Bl, Cl, Dl) => (Al >>> 0) + (Bl >>> 0) + (Cl >>> 0) + (Dl >>> 0);
    exports.add4L = add4L;
    var add4H = (low, Ah, Bh, Ch, Dh) => Ah + Bh + Ch + Dh + (low / 2 ** 32 | 0) | 0;
    exports.add4H = add4H;
    var add5L = (Al, Bl, Cl, Dl, El) => (Al >>> 0) + (Bl >>> 0) + (Cl >>> 0) + (Dl >>> 0) + (El >>> 0);
    exports.add5L = add5L;
    var add5H = (low, Ah, Bh, Ch, Dh, Eh) => Ah + Bh + Ch + Dh + Eh + (low / 2 ** 32 | 0) | 0;
    exports.add5H = add5H;
    var u64 = {
      fromBig,
      split,
      toBig,
      shrSH,
      shrSL,
      rotrSH,
      rotrSL,
      rotrBH,
      rotrBL,
      rotr32H,
      rotr32L,
      rotlSH,
      rotlSL,
      rotlBH,
      rotlBL,
      add,
      add3L,
      add3H,
      add4L,
      add4H,
      add5H,
      add5L
    };
    exports.default = u64;
  }
});

// node_modules/@noble/hashes/sha2.js
var require_sha2 = __commonJS({
  "node_modules/@noble/hashes/sha2.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.sha512_224 = exports.sha512_256 = exports.sha384 = exports.sha512 = exports.sha224 = exports.sha256 = exports.SHA512_256 = exports.SHA512_224 = exports.SHA384 = exports.SHA512 = exports.SHA224 = exports.SHA256 = void 0;
    var _md_ts_1 = require_md();
    var u64 = require_u64();
    var utils_ts_1 = require_utils();
    var SHA256_K2 = /* @__PURE__ */ Uint32Array.from([
      1116352408,
      1899447441,
      3049323471,
      3921009573,
      961987163,
      1508970993,
      2453635748,
      2870763221,
      3624381080,
      310598401,
      607225278,
      1426881987,
      1925078388,
      2162078206,
      2614888103,
      3248222580,
      3835390401,
      4022224774,
      264347078,
      604807628,
      770255983,
      1249150122,
      1555081692,
      1996064986,
      2554220882,
      2821834349,
      2952996808,
      3210313671,
      3336571891,
      3584528711,
      113926993,
      338241895,
      666307205,
      773529912,
      1294757372,
      1396182291,
      1695183700,
      1986661051,
      2177026350,
      2456956037,
      2730485921,
      2820302411,
      3259730800,
      3345764771,
      3516065817,
      3600352804,
      4094571909,
      275423344,
      430227734,
      506948616,
      659060556,
      883997877,
      958139571,
      1322822218,
      1537002063,
      1747873779,
      1955562222,
      2024104815,
      2227730452,
      2361852424,
      2428436474,
      2756734187,
      3204031479,
      3329325298
    ]);
    var SHA256_W2 = /* @__PURE__ */ new Uint32Array(64);
    var SHA2562 = class extends _md_ts_1.HashMD {
      constructor(outputLen = 32) {
        super(64, outputLen, 8, false);
        this.A = _md_ts_1.SHA256_IV[0] | 0;
        this.B = _md_ts_1.SHA256_IV[1] | 0;
        this.C = _md_ts_1.SHA256_IV[2] | 0;
        this.D = _md_ts_1.SHA256_IV[3] | 0;
        this.E = _md_ts_1.SHA256_IV[4] | 0;
        this.F = _md_ts_1.SHA256_IV[5] | 0;
        this.G = _md_ts_1.SHA256_IV[6] | 0;
        this.H = _md_ts_1.SHA256_IV[7] | 0;
      }
      get() {
        const { A, B, C, D, E, F, G, H } = this;
        return [A, B, C, D, E, F, G, H];
      }
      // prettier-ignore
      set(A, B, C, D, E, F, G, H) {
        this.A = A | 0;
        this.B = B | 0;
        this.C = C | 0;
        this.D = D | 0;
        this.E = E | 0;
        this.F = F | 0;
        this.G = G | 0;
        this.H = H | 0;
      }
      process(view, offset) {
        for (let i = 0; i < 16; i++, offset += 4)
          SHA256_W2[i] = view.getUint32(offset, false);
        for (let i = 16; i < 64; i++) {
          const W15 = SHA256_W2[i - 15];
          const W2 = SHA256_W2[i - 2];
          const s0 = (0, utils_ts_1.rotr)(W15, 7) ^ (0, utils_ts_1.rotr)(W15, 18) ^ W15 >>> 3;
          const s1 = (0, utils_ts_1.rotr)(W2, 17) ^ (0, utils_ts_1.rotr)(W2, 19) ^ W2 >>> 10;
          SHA256_W2[i] = s1 + SHA256_W2[i - 7] + s0 + SHA256_W2[i - 16] | 0;
        }
        let { A, B, C, D, E, F, G, H } = this;
        for (let i = 0; i < 64; i++) {
          const sigma1 = (0, utils_ts_1.rotr)(E, 6) ^ (0, utils_ts_1.rotr)(E, 11) ^ (0, utils_ts_1.rotr)(E, 25);
          const T1 = H + sigma1 + (0, _md_ts_1.Chi)(E, F, G) + SHA256_K2[i] + SHA256_W2[i] | 0;
          const sigma0 = (0, utils_ts_1.rotr)(A, 2) ^ (0, utils_ts_1.rotr)(A, 13) ^ (0, utils_ts_1.rotr)(A, 22);
          const T2 = sigma0 + (0, _md_ts_1.Maj)(A, B, C) | 0;
          H = G;
          G = F;
          F = E;
          E = D + T1 | 0;
          D = C;
          C = B;
          B = A;
          A = T1 + T2 | 0;
        }
        A = A + this.A | 0;
        B = B + this.B | 0;
        C = C + this.C | 0;
        D = D + this.D | 0;
        E = E + this.E | 0;
        F = F + this.F | 0;
        G = G + this.G | 0;
        H = H + this.H | 0;
        this.set(A, B, C, D, E, F, G, H);
      }
      roundClean() {
        (0, utils_ts_1.clean)(SHA256_W2);
      }
      destroy() {
        this.set(0, 0, 0, 0, 0, 0, 0, 0);
        (0, utils_ts_1.clean)(this.buffer);
      }
    };
    exports.SHA256 = SHA2562;
    var SHA224 = class extends SHA2562 {
      constructor() {
        super(28);
        this.A = _md_ts_1.SHA224_IV[0] | 0;
        this.B = _md_ts_1.SHA224_IV[1] | 0;
        this.C = _md_ts_1.SHA224_IV[2] | 0;
        this.D = _md_ts_1.SHA224_IV[3] | 0;
        this.E = _md_ts_1.SHA224_IV[4] | 0;
        this.F = _md_ts_1.SHA224_IV[5] | 0;
        this.G = _md_ts_1.SHA224_IV[6] | 0;
        this.H = _md_ts_1.SHA224_IV[7] | 0;
      }
    };
    exports.SHA224 = SHA224;
    var K512 = /* @__PURE__ */ (() => u64.split([
      "0x428a2f98d728ae22",
      "0x7137449123ef65cd",
      "0xb5c0fbcfec4d3b2f",
      "0xe9b5dba58189dbbc",
      "0x3956c25bf348b538",
      "0x59f111f1b605d019",
      "0x923f82a4af194f9b",
      "0xab1c5ed5da6d8118",
      "0xd807aa98a3030242",
      "0x12835b0145706fbe",
      "0x243185be4ee4b28c",
      "0x550c7dc3d5ffb4e2",
      "0x72be5d74f27b896f",
      "0x80deb1fe3b1696b1",
      "0x9bdc06a725c71235",
      "0xc19bf174cf692694",
      "0xe49b69c19ef14ad2",
      "0xefbe4786384f25e3",
      "0x0fc19dc68b8cd5b5",
      "0x240ca1cc77ac9c65",
      "0x2de92c6f592b0275",
      "0x4a7484aa6ea6e483",
      "0x5cb0a9dcbd41fbd4",
      "0x76f988da831153b5",
      "0x983e5152ee66dfab",
      "0xa831c66d2db43210",
      "0xb00327c898fb213f",
      "0xbf597fc7beef0ee4",
      "0xc6e00bf33da88fc2",
      "0xd5a79147930aa725",
      "0x06ca6351e003826f",
      "0x142929670a0e6e70",
      "0x27b70a8546d22ffc",
      "0x2e1b21385c26c926",
      "0x4d2c6dfc5ac42aed",
      "0x53380d139d95b3df",
      "0x650a73548baf63de",
      "0x766a0abb3c77b2a8",
      "0x81c2c92e47edaee6",
      "0x92722c851482353b",
      "0xa2bfe8a14cf10364",
      "0xa81a664bbc423001",
      "0xc24b8b70d0f89791",
      "0xc76c51a30654be30",
      "0xd192e819d6ef5218",
      "0xd69906245565a910",
      "0xf40e35855771202a",
      "0x106aa07032bbd1b8",
      "0x19a4c116b8d2d0c8",
      "0x1e376c085141ab53",
      "0x2748774cdf8eeb99",
      "0x34b0bcb5e19b48a8",
      "0x391c0cb3c5c95a63",
      "0x4ed8aa4ae3418acb",
      "0x5b9cca4f7763e373",
      "0x682e6ff3d6b2b8a3",
      "0x748f82ee5defb2fc",
      "0x78a5636f43172f60",
      "0x84c87814a1f0ab72",
      "0x8cc702081a6439ec",
      "0x90befffa23631e28",
      "0xa4506cebde82bde9",
      "0xbef9a3f7b2c67915",
      "0xc67178f2e372532b",
      "0xca273eceea26619c",
      "0xd186b8c721c0c207",
      "0xeada7dd6cde0eb1e",
      "0xf57d4f7fee6ed178",
      "0x06f067aa72176fba",
      "0x0a637dc5a2c898a6",
      "0x113f9804bef90dae",
      "0x1b710b35131c471b",
      "0x28db77f523047d84",
      "0x32caab7b40c72493",
      "0x3c9ebe0a15c9bebc",
      "0x431d67c49c100d4c",
      "0x4cc5d4becb3e42b6",
      "0x597f299cfc657e2a",
      "0x5fcb6fab3ad6faec",
      "0x6c44198c4a475817"
    ].map((n) => BigInt(n))))();
    var SHA512_Kh = /* @__PURE__ */ (() => K512[0])();
    var SHA512_Kl = /* @__PURE__ */ (() => K512[1])();
    var SHA512_W_H = /* @__PURE__ */ new Uint32Array(80);
    var SHA512_W_L = /* @__PURE__ */ new Uint32Array(80);
    var SHA512 = class extends _md_ts_1.HashMD {
      constructor(outputLen = 64) {
        super(128, outputLen, 16, false);
        this.Ah = _md_ts_1.SHA512_IV[0] | 0;
        this.Al = _md_ts_1.SHA512_IV[1] | 0;
        this.Bh = _md_ts_1.SHA512_IV[2] | 0;
        this.Bl = _md_ts_1.SHA512_IV[3] | 0;
        this.Ch = _md_ts_1.SHA512_IV[4] | 0;
        this.Cl = _md_ts_1.SHA512_IV[5] | 0;
        this.Dh = _md_ts_1.SHA512_IV[6] | 0;
        this.Dl = _md_ts_1.SHA512_IV[7] | 0;
        this.Eh = _md_ts_1.SHA512_IV[8] | 0;
        this.El = _md_ts_1.SHA512_IV[9] | 0;
        this.Fh = _md_ts_1.SHA512_IV[10] | 0;
        this.Fl = _md_ts_1.SHA512_IV[11] | 0;
        this.Gh = _md_ts_1.SHA512_IV[12] | 0;
        this.Gl = _md_ts_1.SHA512_IV[13] | 0;
        this.Hh = _md_ts_1.SHA512_IV[14] | 0;
        this.Hl = _md_ts_1.SHA512_IV[15] | 0;
      }
      // prettier-ignore
      get() {
        const { Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl } = this;
        return [Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl];
      }
      // prettier-ignore
      set(Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl) {
        this.Ah = Ah | 0;
        this.Al = Al | 0;
        this.Bh = Bh | 0;
        this.Bl = Bl | 0;
        this.Ch = Ch | 0;
        this.Cl = Cl | 0;
        this.Dh = Dh | 0;
        this.Dl = Dl | 0;
        this.Eh = Eh | 0;
        this.El = El | 0;
        this.Fh = Fh | 0;
        this.Fl = Fl | 0;
        this.Gh = Gh | 0;
        this.Gl = Gl | 0;
        this.Hh = Hh | 0;
        this.Hl = Hl | 0;
      }
      process(view, offset) {
        for (let i = 0; i < 16; i++, offset += 4) {
          SHA512_W_H[i] = view.getUint32(offset);
          SHA512_W_L[i] = view.getUint32(offset += 4);
        }
        for (let i = 16; i < 80; i++) {
          const W15h = SHA512_W_H[i - 15] | 0;
          const W15l = SHA512_W_L[i - 15] | 0;
          const s0h = u64.rotrSH(W15h, W15l, 1) ^ u64.rotrSH(W15h, W15l, 8) ^ u64.shrSH(W15h, W15l, 7);
          const s0l = u64.rotrSL(W15h, W15l, 1) ^ u64.rotrSL(W15h, W15l, 8) ^ u64.shrSL(W15h, W15l, 7);
          const W2h = SHA512_W_H[i - 2] | 0;
          const W2l = SHA512_W_L[i - 2] | 0;
          const s1h = u64.rotrSH(W2h, W2l, 19) ^ u64.rotrBH(W2h, W2l, 61) ^ u64.shrSH(W2h, W2l, 6);
          const s1l = u64.rotrSL(W2h, W2l, 19) ^ u64.rotrBL(W2h, W2l, 61) ^ u64.shrSL(W2h, W2l, 6);
          const SUMl = u64.add4L(s0l, s1l, SHA512_W_L[i - 7], SHA512_W_L[i - 16]);
          const SUMh = u64.add4H(SUMl, s0h, s1h, SHA512_W_H[i - 7], SHA512_W_H[i - 16]);
          SHA512_W_H[i] = SUMh | 0;
          SHA512_W_L[i] = SUMl | 0;
        }
        let { Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl } = this;
        for (let i = 0; i < 80; i++) {
          const sigma1h = u64.rotrSH(Eh, El, 14) ^ u64.rotrSH(Eh, El, 18) ^ u64.rotrBH(Eh, El, 41);
          const sigma1l = u64.rotrSL(Eh, El, 14) ^ u64.rotrSL(Eh, El, 18) ^ u64.rotrBL(Eh, El, 41);
          const CHIh = Eh & Fh ^ ~Eh & Gh;
          const CHIl = El & Fl ^ ~El & Gl;
          const T1ll = u64.add5L(Hl, sigma1l, CHIl, SHA512_Kl[i], SHA512_W_L[i]);
          const T1h = u64.add5H(T1ll, Hh, sigma1h, CHIh, SHA512_Kh[i], SHA512_W_H[i]);
          const T1l = T1ll | 0;
          const sigma0h = u64.rotrSH(Ah, Al, 28) ^ u64.rotrBH(Ah, Al, 34) ^ u64.rotrBH(Ah, Al, 39);
          const sigma0l = u64.rotrSL(Ah, Al, 28) ^ u64.rotrBL(Ah, Al, 34) ^ u64.rotrBL(Ah, Al, 39);
          const MAJh = Ah & Bh ^ Ah & Ch ^ Bh & Ch;
          const MAJl = Al & Bl ^ Al & Cl ^ Bl & Cl;
          Hh = Gh | 0;
          Hl = Gl | 0;
          Gh = Fh | 0;
          Gl = Fl | 0;
          Fh = Eh | 0;
          Fl = El | 0;
          ({ h: Eh, l: El } = u64.add(Dh | 0, Dl | 0, T1h | 0, T1l | 0));
          Dh = Ch | 0;
          Dl = Cl | 0;
          Ch = Bh | 0;
          Cl = Bl | 0;
          Bh = Ah | 0;
          Bl = Al | 0;
          const All = u64.add3L(T1l, sigma0l, MAJl);
          Ah = u64.add3H(All, T1h, sigma0h, MAJh);
          Al = All | 0;
        }
        ({ h: Ah, l: Al } = u64.add(this.Ah | 0, this.Al | 0, Ah | 0, Al | 0));
        ({ h: Bh, l: Bl } = u64.add(this.Bh | 0, this.Bl | 0, Bh | 0, Bl | 0));
        ({ h: Ch, l: Cl } = u64.add(this.Ch | 0, this.Cl | 0, Ch | 0, Cl | 0));
        ({ h: Dh, l: Dl } = u64.add(this.Dh | 0, this.Dl | 0, Dh | 0, Dl | 0));
        ({ h: Eh, l: El } = u64.add(this.Eh | 0, this.El | 0, Eh | 0, El | 0));
        ({ h: Fh, l: Fl } = u64.add(this.Fh | 0, this.Fl | 0, Fh | 0, Fl | 0));
        ({ h: Gh, l: Gl } = u64.add(this.Gh | 0, this.Gl | 0, Gh | 0, Gl | 0));
        ({ h: Hh, l: Hl } = u64.add(this.Hh | 0, this.Hl | 0, Hh | 0, Hl | 0));
        this.set(Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl);
      }
      roundClean() {
        (0, utils_ts_1.clean)(SHA512_W_H, SHA512_W_L);
      }
      destroy() {
        (0, utils_ts_1.clean)(this.buffer);
        this.set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
      }
    };
    exports.SHA512 = SHA512;
    var SHA384 = class extends SHA512 {
      constructor() {
        super(48);
        this.Ah = _md_ts_1.SHA384_IV[0] | 0;
        this.Al = _md_ts_1.SHA384_IV[1] | 0;
        this.Bh = _md_ts_1.SHA384_IV[2] | 0;
        this.Bl = _md_ts_1.SHA384_IV[3] | 0;
        this.Ch = _md_ts_1.SHA384_IV[4] | 0;
        this.Cl = _md_ts_1.SHA384_IV[5] | 0;
        this.Dh = _md_ts_1.SHA384_IV[6] | 0;
        this.Dl = _md_ts_1.SHA384_IV[7] | 0;
        this.Eh = _md_ts_1.SHA384_IV[8] | 0;
        this.El = _md_ts_1.SHA384_IV[9] | 0;
        this.Fh = _md_ts_1.SHA384_IV[10] | 0;
        this.Fl = _md_ts_1.SHA384_IV[11] | 0;
        this.Gh = _md_ts_1.SHA384_IV[12] | 0;
        this.Gl = _md_ts_1.SHA384_IV[13] | 0;
        this.Hh = _md_ts_1.SHA384_IV[14] | 0;
        this.Hl = _md_ts_1.SHA384_IV[15] | 0;
      }
    };
    exports.SHA384 = SHA384;
    var T224_IV = /* @__PURE__ */ Uint32Array.from([
      2352822216,
      424955298,
      1944164710,
      2312950998,
      502970286,
      855612546,
      1738396948,
      1479516111,
      258812777,
      2077511080,
      2011393907,
      79989058,
      1067287976,
      1780299464,
      286451373,
      2446758561
    ]);
    var T256_IV = /* @__PURE__ */ Uint32Array.from([
      573645204,
      4230739756,
      2673172387,
      3360449730,
      596883563,
      1867755857,
      2520282905,
      1497426621,
      2519219938,
      2827943907,
      3193839141,
      1401305490,
      721525244,
      746961066,
      246885852,
      2177182882
    ]);
    var SHA512_224 = class extends SHA512 {
      constructor() {
        super(28);
        this.Ah = T224_IV[0] | 0;
        this.Al = T224_IV[1] | 0;
        this.Bh = T224_IV[2] | 0;
        this.Bl = T224_IV[3] | 0;
        this.Ch = T224_IV[4] | 0;
        this.Cl = T224_IV[5] | 0;
        this.Dh = T224_IV[6] | 0;
        this.Dl = T224_IV[7] | 0;
        this.Eh = T224_IV[8] | 0;
        this.El = T224_IV[9] | 0;
        this.Fh = T224_IV[10] | 0;
        this.Fl = T224_IV[11] | 0;
        this.Gh = T224_IV[12] | 0;
        this.Gl = T224_IV[13] | 0;
        this.Hh = T224_IV[14] | 0;
        this.Hl = T224_IV[15] | 0;
      }
    };
    exports.SHA512_224 = SHA512_224;
    var SHA512_256 = class extends SHA512 {
      constructor() {
        super(32);
        this.Ah = T256_IV[0] | 0;
        this.Al = T256_IV[1] | 0;
        this.Bh = T256_IV[2] | 0;
        this.Bl = T256_IV[3] | 0;
        this.Ch = T256_IV[4] | 0;
        this.Cl = T256_IV[5] | 0;
        this.Dh = T256_IV[6] | 0;
        this.Dl = T256_IV[7] | 0;
        this.Eh = T256_IV[8] | 0;
        this.El = T256_IV[9] | 0;
        this.Fh = T256_IV[10] | 0;
        this.Fl = T256_IV[11] | 0;
        this.Gh = T256_IV[12] | 0;
        this.Gl = T256_IV[13] | 0;
        this.Hh = T256_IV[14] | 0;
        this.Hl = T256_IV[15] | 0;
      }
    };
    exports.SHA512_256 = SHA512_256;
    exports.sha256 = (0, utils_ts_1.createHasher)(() => new SHA2562());
    exports.sha224 = (0, utils_ts_1.createHasher)(() => new SHA224());
    exports.sha512 = (0, utils_ts_1.createHasher)(() => new SHA512());
    exports.sha384 = (0, utils_ts_1.createHasher)(() => new SHA384());
    exports.sha512_256 = (0, utils_ts_1.createHasher)(() => new SHA512_256());
    exports.sha512_224 = (0, utils_ts_1.createHasher)(() => new SHA512_224());
  }
});

// node_modules/@noble/curves/utils.js
var require_utils2 = __commonJS({
  "node_modules/@noble/curves/utils.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.notImplemented = exports.bitMask = exports.utf8ToBytes = exports.randomBytes = exports.isBytes = exports.hexToBytes = exports.concatBytes = exports.bytesToUtf8 = exports.bytesToHex = exports.anumber = exports.abytes = void 0;
    exports.abool = abool;
    exports._abool2 = _abool22;
    exports._abytes2 = _abytes22;
    exports.numberToHexUnpadded = numberToHexUnpadded2;
    exports.hexToNumber = hexToNumber2;
    exports.bytesToNumberBE = bytesToNumberBE2;
    exports.bytesToNumberLE = bytesToNumberLE2;
    exports.numberToBytesBE = numberToBytesBE2;
    exports.numberToBytesLE = numberToBytesLE2;
    exports.numberToVarBytesBE = numberToVarBytesBE;
    exports.ensureBytes = ensureBytes2;
    exports.equalBytes = equalBytes;
    exports.copyBytes = copyBytes;
    exports.asciiToBytes = asciiToBytes;
    exports.inRange = inRange2;
    exports.aInRange = aInRange2;
    exports.bitLen = bitLen2;
    exports.bitGet = bitGet2;
    exports.bitSet = bitSet;
    exports.createHmacDrbg = createHmacDrbg2;
    exports.validateObject = validateObject2;
    exports.isHash = isHash2;
    exports._validateObject = _validateObject2;
    exports.memoized = memoized2;
    var utils_js_1 = require_utils();
    var utils_js_2 = require_utils();
    Object.defineProperty(exports, "abytes", { enumerable: true, get: function() {
      return utils_js_2.abytes;
    } });
    Object.defineProperty(exports, "anumber", { enumerable: true, get: function() {
      return utils_js_2.anumber;
    } });
    Object.defineProperty(exports, "bytesToHex", { enumerable: true, get: function() {
      return utils_js_2.bytesToHex;
    } });
    Object.defineProperty(exports, "bytesToUtf8", { enumerable: true, get: function() {
      return utils_js_2.bytesToUtf8;
    } });
    Object.defineProperty(exports, "concatBytes", { enumerable: true, get: function() {
      return utils_js_2.concatBytes;
    } });
    Object.defineProperty(exports, "hexToBytes", { enumerable: true, get: function() {
      return utils_js_2.hexToBytes;
    } });
    Object.defineProperty(exports, "isBytes", { enumerable: true, get: function() {
      return utils_js_2.isBytes;
    } });
    Object.defineProperty(exports, "randomBytes", { enumerable: true, get: function() {
      return utils_js_2.randomBytes;
    } });
    Object.defineProperty(exports, "utf8ToBytes", { enumerable: true, get: function() {
      return utils_js_2.utf8ToBytes;
    } });
    var _0n8 = /* @__PURE__ */ BigInt(0);
    var _1n8 = /* @__PURE__ */ BigInt(1);
    function abool(title, value) {
      if (typeof value !== "boolean")
        throw new Error(title + " boolean expected, got " + value);
    }
    function _abool22(value, title = "") {
      if (typeof value !== "boolean") {
        const prefix = title && `"${title}"`;
        throw new Error(prefix + "expected boolean, got type=" + typeof value);
      }
      return value;
    }
    function _abytes22(value, length, title = "") {
      const bytes = (0, utils_js_1.isBytes)(value);
      const len = value?.length;
      const needsLen = length !== void 0;
      if (!bytes || needsLen && len !== length) {
        const prefix = title && `"${title}" `;
        const ofLen = needsLen ? ` of length ${length}` : "";
        const got = bytes ? `length=${len}` : `type=${typeof value}`;
        throw new Error(prefix + "expected Uint8Array" + ofLen + ", got " + got);
      }
      return value;
    }
    function numberToHexUnpadded2(num) {
      const hex = num.toString(16);
      return hex.length & 1 ? "0" + hex : hex;
    }
    function hexToNumber2(hex) {
      if (typeof hex !== "string")
        throw new Error("hex string expected, got " + typeof hex);
      return hex === "" ? _0n8 : BigInt("0x" + hex);
    }
    function bytesToNumberBE2(bytes) {
      return hexToNumber2((0, utils_js_1.bytesToHex)(bytes));
    }
    function bytesToNumberLE2(bytes) {
      (0, utils_js_1.abytes)(bytes);
      return hexToNumber2((0, utils_js_1.bytesToHex)(Uint8Array.from(bytes).reverse()));
    }
    function numberToBytesBE2(n, len) {
      return (0, utils_js_1.hexToBytes)(n.toString(16).padStart(len * 2, "0"));
    }
    function numberToBytesLE2(n, len) {
      return numberToBytesBE2(n, len).reverse();
    }
    function numberToVarBytesBE(n) {
      return (0, utils_js_1.hexToBytes)(numberToHexUnpadded2(n));
    }
    function ensureBytes2(title, hex, expectedLength) {
      let res;
      if (typeof hex === "string") {
        try {
          res = (0, utils_js_1.hexToBytes)(hex);
        } catch (e) {
          throw new Error(title + " must be hex string or Uint8Array, cause: " + e);
        }
      } else if ((0, utils_js_1.isBytes)(hex)) {
        res = Uint8Array.from(hex);
      } else {
        throw new Error(title + " must be hex string or Uint8Array");
      }
      const len = res.length;
      if (typeof expectedLength === "number" && len !== expectedLength)
        throw new Error(title + " of length " + expectedLength + " expected, got " + len);
      return res;
    }
    function equalBytes(a, b) {
      if (a.length !== b.length)
        return false;
      let diff = 0;
      for (let i = 0; i < a.length; i++)
        diff |= a[i] ^ b[i];
      return diff === 0;
    }
    function copyBytes(bytes) {
      return Uint8Array.from(bytes);
    }
    function asciiToBytes(ascii) {
      return Uint8Array.from(ascii, (c, i) => {
        const charCode = c.charCodeAt(0);
        if (c.length !== 1 || charCode > 127) {
          throw new Error(`string contains non-ASCII character "${ascii[i]}" with code ${charCode} at position ${i}`);
        }
        return charCode;
      });
    }
    var isPosBig2 = (n) => typeof n === "bigint" && _0n8 <= n;
    function inRange2(n, min, max) {
      return isPosBig2(n) && isPosBig2(min) && isPosBig2(max) && min <= n && n < max;
    }
    function aInRange2(title, n, min, max) {
      if (!inRange2(n, min, max))
        throw new Error("expected valid " + title + ": " + min + " <= n < " + max + ", got " + n);
    }
    function bitLen2(n) {
      let len;
      for (len = 0; n > _0n8; n >>= _1n8, len += 1)
        ;
      return len;
    }
    function bitGet2(n, pos) {
      return n >> BigInt(pos) & _1n8;
    }
    function bitSet(n, pos, value) {
      return n | (value ? _1n8 : _0n8) << BigInt(pos);
    }
    var bitMask2 = (n) => (_1n8 << BigInt(n)) - _1n8;
    exports.bitMask = bitMask2;
    function createHmacDrbg2(hashLen, qByteLen, hmacFn) {
      if (typeof hashLen !== "number" || hashLen < 2)
        throw new Error("hashLen must be a number");
      if (typeof qByteLen !== "number" || qByteLen < 2)
        throw new Error("qByteLen must be a number");
      if (typeof hmacFn !== "function")
        throw new Error("hmacFn must be a function");
      const u8n = (len) => new Uint8Array(len);
      const u8of = (byte) => Uint8Array.of(byte);
      let v = u8n(hashLen);
      let k = u8n(hashLen);
      let i = 0;
      const reset = () => {
        v.fill(1);
        k.fill(0);
        i = 0;
      };
      const h = (...b) => hmacFn(k, v, ...b);
      const reseed = (seed = u8n(0)) => {
        k = h(u8of(0), seed);
        v = h();
        if (seed.length === 0)
          return;
        k = h(u8of(1), seed);
        v = h();
      };
      const gen = () => {
        if (i++ >= 1e3)
          throw new Error("drbg: tried 1000 values");
        let len = 0;
        const out = [];
        while (len < qByteLen) {
          v = h();
          const sl = v.slice();
          out.push(sl);
          len += v.length;
        }
        return (0, utils_js_1.concatBytes)(...out);
      };
      const genUntil = (seed, pred) => {
        reset();
        reseed(seed);
        let res = void 0;
        while (!(res = pred(gen())))
          reseed();
        reset();
        return res;
      };
      return genUntil;
    }
    var validatorFns = {
      bigint: (val) => typeof val === "bigint",
      function: (val) => typeof val === "function",
      boolean: (val) => typeof val === "boolean",
      string: (val) => typeof val === "string",
      stringOrUint8Array: (val) => typeof val === "string" || (0, utils_js_1.isBytes)(val),
      isSafeInteger: (val) => Number.isSafeInteger(val),
      array: (val) => Array.isArray(val),
      field: (val, object) => object.Fp.isValid(val),
      hash: (val) => typeof val === "function" && Number.isSafeInteger(val.outputLen)
    };
    function validateObject2(object, validators, optValidators = {}) {
      const checkField = (fieldName, type, isOptional) => {
        const checkVal = validatorFns[type];
        if (typeof checkVal !== "function")
          throw new Error("invalid validator function");
        const val = object[fieldName];
        if (isOptional && val === void 0)
          return;
        if (!checkVal(val, object)) {
          throw new Error("param " + String(fieldName) + " is invalid. Expected " + type + ", got " + val);
        }
      };
      for (const [fieldName, type] of Object.entries(validators))
        checkField(fieldName, type, false);
      for (const [fieldName, type] of Object.entries(optValidators))
        checkField(fieldName, type, true);
      return object;
    }
    function isHash2(val) {
      return typeof val === "function" && Number.isSafeInteger(val.outputLen);
    }
    function _validateObject2(object, fields, optFields = {}) {
      if (!object || typeof object !== "object")
        throw new Error("expected valid options object");
      function checkField(fieldName, expectedType, isOpt) {
        const val = object[fieldName];
        if (isOpt && val === void 0)
          return;
        const current = typeof val;
        if (current !== expectedType || val === null)
          throw new Error(`param "${fieldName}" is invalid: expected ${expectedType}, got ${current}`);
      }
      Object.entries(fields).forEach(([k, v]) => checkField(k, v, false));
      Object.entries(optFields).forEach(([k, v]) => checkField(k, v, true));
    }
    var notImplemented2 = () => {
      throw new Error("not implemented");
    };
    exports.notImplemented = notImplemented2;
    function memoized2(fn) {
      const map = /* @__PURE__ */ new WeakMap();
      return (arg, ...args) => {
        const val = map.get(arg);
        if (val !== void 0)
          return val;
        const computed = fn(arg, ...args);
        map.set(arg, computed);
        return computed;
      };
    }
  }
});

// node_modules/@noble/curves/abstract/modular.js
var require_modular = __commonJS({
  "node_modules/@noble/curves/abstract/modular.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.isNegativeLE = void 0;
    exports.mod = mod2;
    exports.pow = pow;
    exports.pow2 = pow2;
    exports.invert = invert2;
    exports.tonelliShanks = tonelliShanks2;
    exports.FpSqrt = FpSqrt2;
    exports.validateField = validateField2;
    exports.FpPow = FpPow2;
    exports.FpInvertBatch = FpInvertBatch2;
    exports.FpDiv = FpDiv;
    exports.FpLegendre = FpLegendre2;
    exports.FpIsSquare = FpIsSquare;
    exports.nLength = nLength2;
    exports.Field = Field2;
    exports.FpSqrtOdd = FpSqrtOdd;
    exports.FpSqrtEven = FpSqrtEven;
    exports.hashToPrivateScalar = hashToPrivateScalar;
    exports.getFieldBytesLength = getFieldBytesLength2;
    exports.getMinHashLength = getMinHashLength2;
    exports.mapHashToField = mapHashToField2;
    var utils_ts_1 = require_utils2();
    var _0n8 = BigInt(0);
    var _1n8 = BigInt(1);
    var _2n6 = /* @__PURE__ */ BigInt(2);
    var _3n6 = /* @__PURE__ */ BigInt(3);
    var _4n4 = /* @__PURE__ */ BigInt(4);
    var _5n2 = /* @__PURE__ */ BigInt(5);
    var _7n2 = /* @__PURE__ */ BigInt(7);
    var _8n2 = /* @__PURE__ */ BigInt(8);
    var _9n2 = /* @__PURE__ */ BigInt(9);
    var _16n2 = /* @__PURE__ */ BigInt(16);
    function mod2(a, b) {
      const result = a % b;
      return result >= _0n8 ? result : b + result;
    }
    function pow(num, power, modulo) {
      return FpPow2(Field2(modulo), num, power);
    }
    function pow2(x, power, modulo) {
      let res = x;
      while (power-- > _0n8) {
        res *= res;
        res %= modulo;
      }
      return res;
    }
    function invert2(number, modulo) {
      if (number === _0n8)
        throw new Error("invert: expected non-zero number");
      if (modulo <= _0n8)
        throw new Error("invert: expected positive modulus, got " + modulo);
      let a = mod2(number, modulo);
      let b = modulo;
      let x = _0n8, y = _1n8, u = _1n8, v = _0n8;
      while (a !== _0n8) {
        const q = b / a;
        const r = b % a;
        const m = x - u * q;
        const n = y - v * q;
        b = a, a = r, x = u, y = v, u = m, v = n;
      }
      const gcd = b;
      if (gcd !== _1n8)
        throw new Error("invert: does not exist");
      return mod2(x, modulo);
    }
    function assertIsSquare2(Fp3, root, n) {
      if (!Fp3.eql(Fp3.sqr(root), n))
        throw new Error("Cannot find square root");
    }
    function sqrt3mod42(Fp3, n) {
      const p1div4 = (Fp3.ORDER + _1n8) / _4n4;
      const root = Fp3.pow(n, p1div4);
      assertIsSquare2(Fp3, root, n);
      return root;
    }
    function sqrt5mod82(Fp3, n) {
      const p5div8 = (Fp3.ORDER - _5n2) / _8n2;
      const n2 = Fp3.mul(n, _2n6);
      const v = Fp3.pow(n2, p5div8);
      const nv = Fp3.mul(n, v);
      const i = Fp3.mul(Fp3.mul(nv, _2n6), v);
      const root = Fp3.mul(nv, Fp3.sub(i, Fp3.ONE));
      assertIsSquare2(Fp3, root, n);
      return root;
    }
    function sqrt9mod162(P) {
      const Fp_ = Field2(P);
      const tn = tonelliShanks2(P);
      const c1 = tn(Fp_, Fp_.neg(Fp_.ONE));
      const c2 = tn(Fp_, c1);
      const c3 = tn(Fp_, Fp_.neg(c1));
      const c4 = (P + _7n2) / _16n2;
      return (Fp3, n) => {
        let tv1 = Fp3.pow(n, c4);
        let tv2 = Fp3.mul(tv1, c1);
        const tv3 = Fp3.mul(tv1, c2);
        const tv4 = Fp3.mul(tv1, c3);
        const e1 = Fp3.eql(Fp3.sqr(tv2), n);
        const e2 = Fp3.eql(Fp3.sqr(tv3), n);
        tv1 = Fp3.cmov(tv1, tv2, e1);
        tv2 = Fp3.cmov(tv4, tv3, e2);
        const e3 = Fp3.eql(Fp3.sqr(tv2), n);
        const root = Fp3.cmov(tv1, tv2, e3);
        assertIsSquare2(Fp3, root, n);
        return root;
      };
    }
    function tonelliShanks2(P) {
      if (P < _3n6)
        throw new Error("sqrt is not defined for small field");
      let Q = P - _1n8;
      let S = 0;
      while (Q % _2n6 === _0n8) {
        Q /= _2n6;
        S++;
      }
      let Z = _2n6;
      const _Fp = Field2(P);
      while (FpLegendre2(_Fp, Z) === 1) {
        if (Z++ > 1e3)
          throw new Error("Cannot find square root: probably non-prime P");
      }
      if (S === 1)
        return sqrt3mod42;
      let cc = _Fp.pow(Z, Q);
      const Q1div2 = (Q + _1n8) / _2n6;
      return function tonelliSlow(Fp3, n) {
        if (Fp3.is0(n))
          return n;
        if (FpLegendre2(Fp3, n) !== 1)
          throw new Error("Cannot find square root");
        let M = S;
        let c = Fp3.mul(Fp3.ONE, cc);
        let t = Fp3.pow(n, Q);
        let R = Fp3.pow(n, Q1div2);
        while (!Fp3.eql(t, Fp3.ONE)) {
          if (Fp3.is0(t))
            return Fp3.ZERO;
          let i = 1;
          let t_tmp = Fp3.sqr(t);
          while (!Fp3.eql(t_tmp, Fp3.ONE)) {
            i++;
            t_tmp = Fp3.sqr(t_tmp);
            if (i === M)
              throw new Error("Cannot find square root");
          }
          const exponent = _1n8 << BigInt(M - i - 1);
          const b = Fp3.pow(c, exponent);
          M = i;
          c = Fp3.sqr(b);
          t = Fp3.mul(t, c);
          R = Fp3.mul(R, b);
        }
        return R;
      };
    }
    function FpSqrt2(P) {
      if (P % _4n4 === _3n6)
        return sqrt3mod42;
      if (P % _8n2 === _5n2)
        return sqrt5mod82;
      if (P % _16n2 === _9n2)
        return sqrt9mod162(P);
      return tonelliShanks2(P);
    }
    var isNegativeLE = (num, modulo) => (mod2(num, modulo) & _1n8) === _1n8;
    exports.isNegativeLE = isNegativeLE;
    var FIELD_FIELDS2 = [
      "create",
      "isValid",
      "is0",
      "neg",
      "inv",
      "sqrt",
      "sqr",
      "eql",
      "add",
      "sub",
      "mul",
      "pow",
      "div",
      "addN",
      "subN",
      "mulN",
      "sqrN"
    ];
    function validateField2(field) {
      const initial = {
        ORDER: "bigint",
        MASK: "bigint",
        BYTES: "number",
        BITS: "number"
      };
      const opts = FIELD_FIELDS2.reduce((map, val) => {
        map[val] = "function";
        return map;
      }, initial);
      (0, utils_ts_1._validateObject)(field, opts);
      return field;
    }
    function FpPow2(Fp3, num, power) {
      if (power < _0n8)
        throw new Error("invalid exponent, negatives unsupported");
      if (power === _0n8)
        return Fp3.ONE;
      if (power === _1n8)
        return num;
      let p = Fp3.ONE;
      let d = num;
      while (power > _0n8) {
        if (power & _1n8)
          p = Fp3.mul(p, d);
        d = Fp3.sqr(d);
        power >>= _1n8;
      }
      return p;
    }
    function FpInvertBatch2(Fp3, nums, passZero = false) {
      const inverted = new Array(nums.length).fill(passZero ? Fp3.ZERO : void 0);
      const multipliedAcc = nums.reduce((acc, num, i) => {
        if (Fp3.is0(num))
          return acc;
        inverted[i] = acc;
        return Fp3.mul(acc, num);
      }, Fp3.ONE);
      const invertedAcc = Fp3.inv(multipliedAcc);
      nums.reduceRight((acc, num, i) => {
        if (Fp3.is0(num))
          return acc;
        inverted[i] = Fp3.mul(acc, inverted[i]);
        return Fp3.mul(acc, num);
      }, invertedAcc);
      return inverted;
    }
    function FpDiv(Fp3, lhs, rhs) {
      return Fp3.mul(lhs, typeof rhs === "bigint" ? invert2(rhs, Fp3.ORDER) : Fp3.inv(rhs));
    }
    function FpLegendre2(Fp3, n) {
      const p1mod2 = (Fp3.ORDER - _1n8) / _2n6;
      const powered = Fp3.pow(n, p1mod2);
      const yes = Fp3.eql(powered, Fp3.ONE);
      const zero = Fp3.eql(powered, Fp3.ZERO);
      const no = Fp3.eql(powered, Fp3.neg(Fp3.ONE));
      if (!yes && !zero && !no)
        throw new Error("invalid Legendre symbol result");
      return yes ? 1 : zero ? 0 : -1;
    }
    function FpIsSquare(Fp3, n) {
      const l = FpLegendre2(Fp3, n);
      return l === 1;
    }
    function nLength2(n, nBitLength) {
      if (nBitLength !== void 0)
        (0, utils_ts_1.anumber)(nBitLength);
      const _nBitLength = nBitLength !== void 0 ? nBitLength : n.toString(2).length;
      const nByteLength = Math.ceil(_nBitLength / 8);
      return { nBitLength: _nBitLength, nByteLength };
    }
    function Field2(ORDER, bitLenOrOpts, isLE = false, opts = {}) {
      if (ORDER <= _0n8)
        throw new Error("invalid field: expected ORDER > 0, got " + ORDER);
      let _nbitLength = void 0;
      let _sqrt = void 0;
      let modFromBytes = false;
      let allowedLengths = void 0;
      if (typeof bitLenOrOpts === "object" && bitLenOrOpts != null) {
        if (opts.sqrt || isLE)
          throw new Error("cannot specify opts in two arguments");
        const _opts = bitLenOrOpts;
        if (_opts.BITS)
          _nbitLength = _opts.BITS;
        if (_opts.sqrt)
          _sqrt = _opts.sqrt;
        if (typeof _opts.isLE === "boolean")
          isLE = _opts.isLE;
        if (typeof _opts.modFromBytes === "boolean")
          modFromBytes = _opts.modFromBytes;
        allowedLengths = _opts.allowedLengths;
      } else {
        if (typeof bitLenOrOpts === "number")
          _nbitLength = bitLenOrOpts;
        if (opts.sqrt)
          _sqrt = opts.sqrt;
      }
      const { nBitLength: BITS, nByteLength: BYTES } = nLength2(ORDER, _nbitLength);
      if (BYTES > 2048)
        throw new Error("invalid field: expected ORDER of <= 2048 bytes");
      let sqrtP;
      const f = Object.freeze({
        ORDER,
        isLE,
        BITS,
        BYTES,
        MASK: (0, utils_ts_1.bitMask)(BITS),
        ZERO: _0n8,
        ONE: _1n8,
        allowedLengths,
        create: (num) => mod2(num, ORDER),
        isValid: (num) => {
          if (typeof num !== "bigint")
            throw new Error("invalid field element: expected bigint, got " + typeof num);
          return _0n8 <= num && num < ORDER;
        },
        is0: (num) => num === _0n8,
        // is valid and invertible
        isValidNot0: (num) => !f.is0(num) && f.isValid(num),
        isOdd: (num) => (num & _1n8) === _1n8,
        neg: (num) => mod2(-num, ORDER),
        eql: (lhs, rhs) => lhs === rhs,
        sqr: (num) => mod2(num * num, ORDER),
        add: (lhs, rhs) => mod2(lhs + rhs, ORDER),
        sub: (lhs, rhs) => mod2(lhs - rhs, ORDER),
        mul: (lhs, rhs) => mod2(lhs * rhs, ORDER),
        pow: (num, power) => FpPow2(f, num, power),
        div: (lhs, rhs) => mod2(lhs * invert2(rhs, ORDER), ORDER),
        // Same as above, but doesn't normalize
        sqrN: (num) => num * num,
        addN: (lhs, rhs) => lhs + rhs,
        subN: (lhs, rhs) => lhs - rhs,
        mulN: (lhs, rhs) => lhs * rhs,
        inv: (num) => invert2(num, ORDER),
        sqrt: _sqrt || ((n) => {
          if (!sqrtP)
            sqrtP = FpSqrt2(ORDER);
          return sqrtP(f, n);
        }),
        toBytes: (num) => isLE ? (0, utils_ts_1.numberToBytesLE)(num, BYTES) : (0, utils_ts_1.numberToBytesBE)(num, BYTES),
        fromBytes: (bytes, skipValidation = true) => {
          if (allowedLengths) {
            if (!allowedLengths.includes(bytes.length) || bytes.length > BYTES) {
              throw new Error("Field.fromBytes: expected " + allowedLengths + " bytes, got " + bytes.length);
            }
            const padded = new Uint8Array(BYTES);
            padded.set(bytes, isLE ? 0 : padded.length - bytes.length);
            bytes = padded;
          }
          if (bytes.length !== BYTES)
            throw new Error("Field.fromBytes: expected " + BYTES + " bytes, got " + bytes.length);
          let scalar = isLE ? (0, utils_ts_1.bytesToNumberLE)(bytes) : (0, utils_ts_1.bytesToNumberBE)(bytes);
          if (modFromBytes)
            scalar = mod2(scalar, ORDER);
          if (!skipValidation) {
            if (!f.isValid(scalar))
              throw new Error("invalid field element: outside of range 0..ORDER");
          }
          return scalar;
        },
        // TODO: we don't need it here, move out to separate fn
        invertBatch: (lst) => FpInvertBatch2(f, lst),
        // We can't move this out because Fp6, Fp12 implement it
        // and it's unclear what to return in there.
        cmov: (a, b, c) => c ? b : a
      });
      return Object.freeze(f);
    }
    function FpSqrtOdd(Fp3, elm) {
      if (!Fp3.isOdd)
        throw new Error("Field doesn't have isOdd");
      const root = Fp3.sqrt(elm);
      return Fp3.isOdd(root) ? root : Fp3.neg(root);
    }
    function FpSqrtEven(Fp3, elm) {
      if (!Fp3.isOdd)
        throw new Error("Field doesn't have isOdd");
      const root = Fp3.sqrt(elm);
      return Fp3.isOdd(root) ? Fp3.neg(root) : root;
    }
    function hashToPrivateScalar(hash2, groupOrder, isLE = false) {
      hash2 = (0, utils_ts_1.ensureBytes)("privateHash", hash2);
      const hashLen = hash2.length;
      const minLen = nLength2(groupOrder).nByteLength + 8;
      if (minLen < 24 || hashLen < minLen || hashLen > 1024)
        throw new Error("hashToPrivateScalar: expected " + minLen + "-1024 bytes of input, got " + hashLen);
      const num = isLE ? (0, utils_ts_1.bytesToNumberLE)(hash2) : (0, utils_ts_1.bytesToNumberBE)(hash2);
      return mod2(num, groupOrder - _1n8) + _1n8;
    }
    function getFieldBytesLength2(fieldOrder) {
      if (typeof fieldOrder !== "bigint")
        throw new Error("field order must be bigint");
      const bitLength = fieldOrder.toString(2).length;
      return Math.ceil(bitLength / 8);
    }
    function getMinHashLength2(fieldOrder) {
      const length = getFieldBytesLength2(fieldOrder);
      return length + Math.ceil(length / 2);
    }
    function mapHashToField2(key, fieldOrder, isLE = false) {
      const len = key.length;
      const fieldLen = getFieldBytesLength2(fieldOrder);
      const minLen = getMinHashLength2(fieldOrder);
      if (len < 16 || len < minLen || len > 1024)
        throw new Error("expected " + minLen + "-1024 bytes of input, got " + len);
      const num = isLE ? (0, utils_ts_1.bytesToNumberLE)(key) : (0, utils_ts_1.bytesToNumberBE)(key);
      const reduced = mod2(num, fieldOrder - _1n8) + _1n8;
      return isLE ? (0, utils_ts_1.numberToBytesLE)(reduced, fieldLen) : (0, utils_ts_1.numberToBytesBE)(reduced, fieldLen);
    }
  }
});

// node_modules/@noble/curves/abstract/curve.js
var require_curve = __commonJS({
  "node_modules/@noble/curves/abstract/curve.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.wNAF = void 0;
    exports.negateCt = negateCt2;
    exports.normalizeZ = normalizeZ2;
    exports.mulEndoUnsafe = mulEndoUnsafe2;
    exports.pippenger = pippenger2;
    exports.precomputeMSMUnsafe = precomputeMSMUnsafe;
    exports.validateBasic = validateBasic;
    exports._createCurveFields = _createCurveFields2;
    var utils_ts_1 = require_utils2();
    var modular_ts_1 = require_modular();
    var _0n8 = BigInt(0);
    var _1n8 = BigInt(1);
    function negateCt2(condition, item) {
      const neg = item.negate();
      return condition ? neg : item;
    }
    function normalizeZ2(c, points) {
      const invertedZs = (0, modular_ts_1.FpInvertBatch)(c.Fp, points.map((p) => p.Z));
      return points.map((p, i) => c.fromAffine(p.toAffine(invertedZs[i])));
    }
    function validateW2(W, bits) {
      if (!Number.isSafeInteger(W) || W <= 0 || W > bits)
        throw new Error("invalid window size, expected [1.." + bits + "], got W=" + W);
    }
    function calcWOpts2(W, scalarBits) {
      validateW2(W, scalarBits);
      const windows = Math.ceil(scalarBits / W) + 1;
      const windowSize = 2 ** (W - 1);
      const maxNumber = 2 ** W;
      const mask = (0, utils_ts_1.bitMask)(W);
      const shiftBy = BigInt(W);
      return { windows, windowSize, mask, maxNumber, shiftBy };
    }
    function calcOffsets2(n, window2, wOpts) {
      const { windowSize, mask, maxNumber, shiftBy } = wOpts;
      let wbits = Number(n & mask);
      let nextN = n >> shiftBy;
      if (wbits > windowSize) {
        wbits -= maxNumber;
        nextN += _1n8;
      }
      const offsetStart = window2 * windowSize;
      const offset = offsetStart + Math.abs(wbits) - 1;
      const isZero = wbits === 0;
      const isNeg = wbits < 0;
      const isNegF = window2 % 2 !== 0;
      const offsetF = offsetStart;
      return { nextN, offset, isZero, isNeg, isNegF, offsetF };
    }
    function validateMSMPoints2(points, c) {
      if (!Array.isArray(points))
        throw new Error("array expected");
      points.forEach((p, i) => {
        if (!(p instanceof c))
          throw new Error("invalid point at index " + i);
      });
    }
    function validateMSMScalars2(scalars, field) {
      if (!Array.isArray(scalars))
        throw new Error("array of scalars expected");
      scalars.forEach((s, i) => {
        if (!field.isValid(s))
          throw new Error("invalid scalar at index " + i);
      });
    }
    var pointPrecomputes2 = /* @__PURE__ */ new WeakMap();
    var pointWindowSizes2 = /* @__PURE__ */ new WeakMap();
    function getW2(P) {
      return pointWindowSizes2.get(P) || 1;
    }
    function assert02(n) {
      if (n !== _0n8)
        throw new Error("invalid wNAF");
    }
    var wNAF2 = class {
      // Parametrized with a given Point class (not individual point)
      constructor(Point, bits) {
        this.BASE = Point.BASE;
        this.ZERO = Point.ZERO;
        this.Fn = Point.Fn;
        this.bits = bits;
      }
      // non-const time multiplication ladder
      _unsafeLadder(elm, n, p = this.ZERO) {
        let d = elm;
        while (n > _0n8) {
          if (n & _1n8)
            p = p.add(d);
          d = d.double();
          n >>= _1n8;
        }
        return p;
      }
      /**
       * Creates a wNAF precomputation window. Used for caching.
       * Default window size is set by `utils.precompute()` and is equal to 8.
       * Number of precomputed points depends on the curve size:
       * 2^(𝑊−1) * (Math.ceil(𝑛 / 𝑊) + 1), where:
       * - 𝑊 is the window size
       * - 𝑛 is the bitlength of the curve order.
       * For a 256-bit curve and window size 8, the number of precomputed points is 128 * 33 = 4224.
       * @param point Point instance
       * @param W window size
       * @returns precomputed point tables flattened to a single array
       */
      precomputeWindow(point, W) {
        const { windows, windowSize } = calcWOpts2(W, this.bits);
        const points = [];
        let p = point;
        let base = p;
        for (let window2 = 0; window2 < windows; window2++) {
          base = p;
          points.push(base);
          for (let i = 1; i < windowSize; i++) {
            base = base.add(p);
            points.push(base);
          }
          p = base.double();
        }
        return points;
      }
      /**
       * Implements ec multiplication using precomputed tables and w-ary non-adjacent form.
       * More compact implementation:
       * https://github.com/paulmillr/noble-secp256k1/blob/47cb1669b6e506ad66b35fe7d76132ae97465da2/index.ts#L502-L541
       * @returns real and fake (for const-time) points
       */
      wNAF(W, precomputes, n) {
        if (!this.Fn.isValid(n))
          throw new Error("invalid scalar");
        let p = this.ZERO;
        let f = this.BASE;
        const wo = calcWOpts2(W, this.bits);
        for (let window2 = 0; window2 < wo.windows; window2++) {
          const { nextN, offset, isZero, isNeg, isNegF, offsetF } = calcOffsets2(n, window2, wo);
          n = nextN;
          if (isZero) {
            f = f.add(negateCt2(isNegF, precomputes[offsetF]));
          } else {
            p = p.add(negateCt2(isNeg, precomputes[offset]));
          }
        }
        assert02(n);
        return { p, f };
      }
      /**
       * Implements ec unsafe (non const-time) multiplication using precomputed tables and w-ary non-adjacent form.
       * @param acc accumulator point to add result of multiplication
       * @returns point
       */
      wNAFUnsafe(W, precomputes, n, acc = this.ZERO) {
        const wo = calcWOpts2(W, this.bits);
        for (let window2 = 0; window2 < wo.windows; window2++) {
          if (n === _0n8)
            break;
          const { nextN, offset, isZero, isNeg } = calcOffsets2(n, window2, wo);
          n = nextN;
          if (isZero) {
            continue;
          } else {
            const item = precomputes[offset];
            acc = acc.add(isNeg ? item.negate() : item);
          }
        }
        assert02(n);
        return acc;
      }
      getPrecomputes(W, point, transform) {
        let comp = pointPrecomputes2.get(point);
        if (!comp) {
          comp = this.precomputeWindow(point, W);
          if (W !== 1) {
            if (typeof transform === "function")
              comp = transform(comp);
            pointPrecomputes2.set(point, comp);
          }
        }
        return comp;
      }
      cached(point, scalar, transform) {
        const W = getW2(point);
        return this.wNAF(W, this.getPrecomputes(W, point, transform), scalar);
      }
      unsafe(point, scalar, transform, prev) {
        const W = getW2(point);
        if (W === 1)
          return this._unsafeLadder(point, scalar, prev);
        return this.wNAFUnsafe(W, this.getPrecomputes(W, point, transform), scalar, prev);
      }
      // We calculate precomputes for elliptic curve point multiplication
      // using windowed method. This specifies window size and
      // stores precomputed values. Usually only base point would be precomputed.
      createCache(P, W) {
        validateW2(W, this.bits);
        pointWindowSizes2.set(P, W);
        pointPrecomputes2.delete(P);
      }
      hasCache(elm) {
        return getW2(elm) !== 1;
      }
    };
    exports.wNAF = wNAF2;
    function mulEndoUnsafe2(Point, point, k1, k2) {
      let acc = point;
      let p1 = Point.ZERO;
      let p2 = Point.ZERO;
      while (k1 > _0n8 || k2 > _0n8) {
        if (k1 & _1n8)
          p1 = p1.add(acc);
        if (k2 & _1n8)
          p2 = p2.add(acc);
        acc = acc.double();
        k1 >>= _1n8;
        k2 >>= _1n8;
      }
      return { p1, p2 };
    }
    function pippenger2(c, fieldN, points, scalars) {
      validateMSMPoints2(points, c);
      validateMSMScalars2(scalars, fieldN);
      const plength = points.length;
      const slength = scalars.length;
      if (plength !== slength)
        throw new Error("arrays of points and scalars must have equal length");
      const zero = c.ZERO;
      const wbits = (0, utils_ts_1.bitLen)(BigInt(plength));
      let windowSize = 1;
      if (wbits > 12)
        windowSize = wbits - 3;
      else if (wbits > 4)
        windowSize = wbits - 2;
      else if (wbits > 0)
        windowSize = 2;
      const MASK = (0, utils_ts_1.bitMask)(windowSize);
      const buckets = new Array(Number(MASK) + 1).fill(zero);
      const lastBits = Math.floor((fieldN.BITS - 1) / windowSize) * windowSize;
      let sum = zero;
      for (let i = lastBits; i >= 0; i -= windowSize) {
        buckets.fill(zero);
        for (let j = 0; j < slength; j++) {
          const scalar = scalars[j];
          const wbits2 = Number(scalar >> BigInt(i) & MASK);
          buckets[wbits2] = buckets[wbits2].add(points[j]);
        }
        let resI = zero;
        for (let j = buckets.length - 1, sumI = zero; j > 0; j--) {
          sumI = sumI.add(buckets[j]);
          resI = resI.add(sumI);
        }
        sum = sum.add(resI);
        if (i !== 0)
          for (let j = 0; j < windowSize; j++)
            sum = sum.double();
      }
      return sum;
    }
    function precomputeMSMUnsafe(c, fieldN, points, windowSize) {
      validateW2(windowSize, fieldN.BITS);
      validateMSMPoints2(points, c);
      const zero = c.ZERO;
      const tableSize = 2 ** windowSize - 1;
      const chunks = Math.ceil(fieldN.BITS / windowSize);
      const MASK = (0, utils_ts_1.bitMask)(windowSize);
      const tables = points.map((p) => {
        const res = [];
        for (let i = 0, acc = p; i < tableSize; i++) {
          res.push(acc);
          acc = acc.add(p);
        }
        return res;
      });
      return (scalars) => {
        validateMSMScalars2(scalars, fieldN);
        if (scalars.length > points.length)
          throw new Error("array of scalars must be smaller than array of points");
        let res = zero;
        for (let i = 0; i < chunks; i++) {
          if (res !== zero)
            for (let j = 0; j < windowSize; j++)
              res = res.double();
          const shiftBy = BigInt(chunks * windowSize - (i + 1) * windowSize);
          for (let j = 0; j < scalars.length; j++) {
            const n = scalars[j];
            const curr = Number(n >> shiftBy & MASK);
            if (!curr)
              continue;
            res = res.add(tables[j][curr - 1]);
          }
        }
        return res;
      };
    }
    function validateBasic(curve) {
      (0, modular_ts_1.validateField)(curve.Fp);
      (0, utils_ts_1.validateObject)(curve, {
        n: "bigint",
        h: "bigint",
        Gx: "field",
        Gy: "field"
      }, {
        nBitLength: "isSafeInteger",
        nByteLength: "isSafeInteger"
      });
      return Object.freeze({
        ...(0, modular_ts_1.nLength)(curve.n, curve.nBitLength),
        ...curve,
        ...{ p: curve.Fp.ORDER }
      });
    }
    function createField2(order, field, isLE) {
      if (field) {
        if (field.ORDER !== order)
          throw new Error("Field.ORDER must match order: Fp == p, Fn == n");
        (0, modular_ts_1.validateField)(field);
        return field;
      } else {
        return (0, modular_ts_1.Field)(order, { isLE });
      }
    }
    function _createCurveFields2(type, CURVE, curveOpts = {}, FpFnLE) {
      if (FpFnLE === void 0)
        FpFnLE = type === "edwards";
      if (!CURVE || typeof CURVE !== "object")
        throw new Error(`expected valid ${type} CURVE object`);
      for (const p of ["p", "n", "h"]) {
        const val = CURVE[p];
        if (!(typeof val === "bigint" && val > _0n8))
          throw new Error(`CURVE.${p} must be positive bigint`);
      }
      const Fp3 = createField2(CURVE.p, curveOpts.Fp, FpFnLE);
      const Fn = createField2(CURVE.n, curveOpts.Fn, FpFnLE);
      const _b = type === "weierstrass" ? "b" : "d";
      const params = ["Gx", "Gy", "a", _b];
      for (const p of params) {
        if (!Fp3.isValid(CURVE[p]))
          throw new Error(`CURVE.${p} must be valid field element of CURVE.Fp`);
      }
      CURVE = Object.freeze(Object.assign({}, CURVE));
      return { CURVE, Fp: Fp3, Fn };
    }
  }
});

// node_modules/@noble/curves/abstract/hash-to-curve.js
var require_hash_to_curve = __commonJS({
  "node_modules/@noble/curves/abstract/hash-to-curve.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports._DST_scalar = void 0;
    exports.expand_message_xmd = expand_message_xmd2;
    exports.expand_message_xof = expand_message_xof2;
    exports.hash_to_field = hash_to_field2;
    exports.isogenyMap = isogenyMap2;
    exports.createHasher = createHasher3;
    var utils_ts_1 = require_utils2();
    var modular_ts_1 = require_modular();
    var os2ip2 = utils_ts_1.bytesToNumberBE;
    function i2osp2(value, length) {
      anum2(value);
      anum2(length);
      if (value < 0 || value >= 1 << 8 * length)
        throw new Error("invalid I2OSP input: " + value);
      const res = Array.from({ length }).fill(0);
      for (let i = length - 1; i >= 0; i--) {
        res[i] = value & 255;
        value >>>= 8;
      }
      return new Uint8Array(res);
    }
    function strxor2(a, b) {
      const arr = new Uint8Array(a.length);
      for (let i = 0; i < a.length; i++) {
        arr[i] = a[i] ^ b[i];
      }
      return arr;
    }
    function anum2(item) {
      if (!Number.isSafeInteger(item))
        throw new Error("number expected");
    }
    function normDST2(DST) {
      if (!(0, utils_ts_1.isBytes)(DST) && typeof DST !== "string")
        throw new Error("DST must be Uint8Array or string");
      return typeof DST === "string" ? (0, utils_ts_1.utf8ToBytes)(DST) : DST;
    }
    function expand_message_xmd2(msg, DST, lenInBytes, H) {
      (0, utils_ts_1.abytes)(msg);
      anum2(lenInBytes);
      DST = normDST2(DST);
      if (DST.length > 255)
        DST = H((0, utils_ts_1.concatBytes)((0, utils_ts_1.utf8ToBytes)("H2C-OVERSIZE-DST-"), DST));
      const { outputLen: b_in_bytes, blockLen: r_in_bytes } = H;
      const ell = Math.ceil(lenInBytes / b_in_bytes);
      if (lenInBytes > 65535 || ell > 255)
        throw new Error("expand_message_xmd: invalid lenInBytes");
      const DST_prime = (0, utils_ts_1.concatBytes)(DST, i2osp2(DST.length, 1));
      const Z_pad = i2osp2(0, r_in_bytes);
      const l_i_b_str = i2osp2(lenInBytes, 2);
      const b = new Array(ell);
      const b_0 = H((0, utils_ts_1.concatBytes)(Z_pad, msg, l_i_b_str, i2osp2(0, 1), DST_prime));
      b[0] = H((0, utils_ts_1.concatBytes)(b_0, i2osp2(1, 1), DST_prime));
      for (let i = 1; i <= ell; i++) {
        const args = [strxor2(b_0, b[i - 1]), i2osp2(i + 1, 1), DST_prime];
        b[i] = H((0, utils_ts_1.concatBytes)(...args));
      }
      const pseudo_random_bytes = (0, utils_ts_1.concatBytes)(...b);
      return pseudo_random_bytes.slice(0, lenInBytes);
    }
    function expand_message_xof2(msg, DST, lenInBytes, k, H) {
      (0, utils_ts_1.abytes)(msg);
      anum2(lenInBytes);
      DST = normDST2(DST);
      if (DST.length > 255) {
        const dkLen = Math.ceil(2 * k / 8);
        DST = H.create({ dkLen }).update((0, utils_ts_1.utf8ToBytes)("H2C-OVERSIZE-DST-")).update(DST).digest();
      }
      if (lenInBytes > 65535 || DST.length > 255)
        throw new Error("expand_message_xof: invalid lenInBytes");
      return H.create({ dkLen: lenInBytes }).update(msg).update(i2osp2(lenInBytes, 2)).update(DST).update(i2osp2(DST.length, 1)).digest();
    }
    function hash_to_field2(msg, count, options) {
      (0, utils_ts_1._validateObject)(options, {
        p: "bigint",
        m: "number",
        k: "number",
        hash: "function"
      });
      const { p, k, m, hash: hash2, expand, DST } = options;
      if (!(0, utils_ts_1.isHash)(options.hash))
        throw new Error("expected valid hash");
      (0, utils_ts_1.abytes)(msg);
      anum2(count);
      const log2p = p.toString(2).length;
      const L = Math.ceil((log2p + k) / 8);
      const len_in_bytes = count * m * L;
      let prb;
      if (expand === "xmd") {
        prb = expand_message_xmd2(msg, DST, len_in_bytes, hash2);
      } else if (expand === "xof") {
        prb = expand_message_xof2(msg, DST, len_in_bytes, k, hash2);
      } else if (expand === "_internal_pass") {
        prb = msg;
      } else {
        throw new Error('expand must be "xmd" or "xof"');
      }
      const u = new Array(count);
      for (let i = 0; i < count; i++) {
        const e = new Array(m);
        for (let j = 0; j < m; j++) {
          const elm_offset = L * (j + i * m);
          const tv = prb.subarray(elm_offset, elm_offset + L);
          e[j] = (0, modular_ts_1.mod)(os2ip2(tv), p);
        }
        u[i] = e;
      }
      return u;
    }
    function isogenyMap2(field, map) {
      const coeff = map.map((i) => Array.from(i).reverse());
      return (x, y) => {
        const [xn, xd, yn, yd] = coeff.map((val) => val.reduce((acc, i) => field.add(field.mul(acc, x), i)));
        const [xd_inv, yd_inv] = (0, modular_ts_1.FpInvertBatch)(field, [xd, yd], true);
        x = field.mul(xn, xd_inv);
        y = field.mul(y, field.mul(yn, yd_inv));
        return { x, y };
      };
    }
    exports._DST_scalar = (0, utils_ts_1.utf8ToBytes)("HashToScalar-");
    function createHasher3(Point, mapToCurve, defaults) {
      if (typeof mapToCurve !== "function")
        throw new Error("mapToCurve() must be defined");
      function map(num) {
        return Point.fromAffine(mapToCurve(num));
      }
      function clear2(initial) {
        const P = initial.clearCofactor();
        if (P.equals(Point.ZERO))
          return Point.ZERO;
        P.assertValidity();
        return P;
      }
      return {
        defaults,
        hashToCurve(msg, options) {
          const opts = Object.assign({}, defaults, options);
          const u = hash_to_field2(msg, 2, opts);
          const u0 = map(u[0]);
          const u1 = map(u[1]);
          return clear2(u0.add(u1));
        },
        encodeToCurve(msg, options) {
          const optsDst = defaults.encodeDST ? { DST: defaults.encodeDST } : {};
          const opts = Object.assign({}, defaults, optsDst, options);
          const u = hash_to_field2(msg, 1, opts);
          const u0 = map(u[0]);
          return clear2(u0);
        },
        /** See {@link H2CHasher} */
        mapToCurve(scalars) {
          if (!Array.isArray(scalars))
            throw new Error("expected array of bigints");
          for (const i of scalars)
            if (typeof i !== "bigint")
              throw new Error("expected array of bigints");
          return clear2(map(scalars));
        },
        // hash_to_scalar can produce 0: https://www.rfc-editor.org/errata/eid8393
        // RFC 9380, draft-irtf-cfrg-bbs-signatures-08
        hashToScalar(msg, options) {
          const N = Point.Fn.ORDER;
          const opts = Object.assign({}, defaults, { p: N, m: 1, DST: exports._DST_scalar }, options);
          return hash_to_field2(msg, 1, opts)[0][0];
        }
      };
    }
  }
});

// node_modules/@noble/hashes/hmac.js
var require_hmac = __commonJS({
  "node_modules/@noble/hashes/hmac.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.hmac = exports.HMAC = void 0;
    var utils_ts_1 = require_utils();
    var HMAC = class extends utils_ts_1.Hash {
      constructor(hash2, _key) {
        super();
        this.finished = false;
        this.destroyed = false;
        (0, utils_ts_1.ahash)(hash2);
        const key = (0, utils_ts_1.toBytes)(_key);
        this.iHash = hash2.create();
        if (typeof this.iHash.update !== "function")
          throw new Error("Expected instance of class which extends utils.Hash");
        this.blockLen = this.iHash.blockLen;
        this.outputLen = this.iHash.outputLen;
        const blockLen = this.blockLen;
        const pad = new Uint8Array(blockLen);
        pad.set(key.length > blockLen ? hash2.create().update(key).digest() : key);
        for (let i = 0; i < pad.length; i++)
          pad[i] ^= 54;
        this.iHash.update(pad);
        this.oHash = hash2.create();
        for (let i = 0; i < pad.length; i++)
          pad[i] ^= 54 ^ 92;
        this.oHash.update(pad);
        (0, utils_ts_1.clean)(pad);
      }
      update(buf) {
        (0, utils_ts_1.aexists)(this);
        this.iHash.update(buf);
        return this;
      }
      digestInto(out) {
        (0, utils_ts_1.aexists)(this);
        (0, utils_ts_1.abytes)(out, this.outputLen);
        this.finished = true;
        this.iHash.digestInto(out);
        this.oHash.update(out);
        this.oHash.digestInto(out);
        this.destroy();
      }
      digest() {
        const out = new Uint8Array(this.oHash.outputLen);
        this.digestInto(out);
        return out;
      }
      _cloneInto(to) {
        to || (to = Object.create(Object.getPrototypeOf(this), {}));
        const { oHash, iHash, finished, destroyed, blockLen, outputLen } = this;
        to = to;
        to.finished = finished;
        to.destroyed = destroyed;
        to.blockLen = blockLen;
        to.outputLen = outputLen;
        to.oHash = oHash._cloneInto(to.oHash);
        to.iHash = iHash._cloneInto(to.iHash);
        return to;
      }
      clone() {
        return this._cloneInto();
      }
      destroy() {
        this.destroyed = true;
        this.oHash.destroy();
        this.iHash.destroy();
      }
    };
    exports.HMAC = HMAC;
    var hmac = (hash2, key, message) => new HMAC(hash2, key).update(message).digest();
    exports.hmac = hmac;
    exports.hmac.create = (hash2, key) => new HMAC(hash2, key);
  }
});

// node_modules/@noble/curves/abstract/weierstrass.js
var require_weierstrass = __commonJS({
  "node_modules/@noble/curves/abstract/weierstrass.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.DER = exports.DERErr = void 0;
    exports._splitEndoScalar = _splitEndoScalar2;
    exports._normFnElement = _normFnElement2;
    exports.weierstrassN = weierstrassN2;
    exports.SWUFpSqrtRatio = SWUFpSqrtRatio2;
    exports.mapToCurveSimpleSWU = mapToCurveSimpleSWU2;
    exports.ecdh = ecdh;
    exports.ecdsa = ecdsa;
    exports.weierstrassPoints = weierstrassPoints2;
    exports._legacyHelperEquat = _legacyHelperEquat2;
    exports.weierstrass = weierstrass;
    var hmac_js_1 = require_hmac();
    var utils_1 = require_utils();
    var utils_ts_1 = require_utils2();
    var curve_ts_1 = require_curve();
    var modular_ts_1 = require_modular();
    var divNearest2 = (num, den) => (num + (num >= 0 ? den : -den) / _2n6) / den;
    function _splitEndoScalar2(k, basis, n) {
      const [[a1, b1], [a2, b2]] = basis;
      const c1 = divNearest2(b2 * k, n);
      const c2 = divNearest2(-b1 * k, n);
      let k1 = k - c1 * a1 - c2 * a2;
      let k2 = -c1 * b1 - c2 * b2;
      const k1neg = k1 < _0n8;
      const k2neg = k2 < _0n8;
      if (k1neg)
        k1 = -k1;
      if (k2neg)
        k2 = -k2;
      const MAX_NUM = (0, utils_ts_1.bitMask)(Math.ceil((0, utils_ts_1.bitLen)(n) / 2)) + _1n8;
      if (k1 < _0n8 || k1 >= MAX_NUM || k2 < _0n8 || k2 >= MAX_NUM) {
        throw new Error("splitScalar (endomorphism): failed, k=" + k);
      }
      return { k1neg, k1, k2neg, k2 };
    }
    function validateSigFormat(format) {
      if (!["compact", "recovered", "der"].includes(format))
        throw new Error('Signature format must be "compact", "recovered", or "der"');
      return format;
    }
    function validateSigOpts(opts, def) {
      const optsn = {};
      for (let optName of Object.keys(def)) {
        optsn[optName] = opts[optName] === void 0 ? def[optName] : opts[optName];
      }
      (0, utils_ts_1._abool2)(optsn.lowS, "lowS");
      (0, utils_ts_1._abool2)(optsn.prehash, "prehash");
      if (optsn.format !== void 0)
        validateSigFormat(optsn.format);
      return optsn;
    }
    var DERErr = class extends Error {
      constructor(m = "") {
        super(m);
      }
    };
    exports.DERErr = DERErr;
    exports.DER = {
      // asn.1 DER encoding utils
      Err: DERErr,
      // Basic building block is TLV (Tag-Length-Value)
      _tlv: {
        encode: (tag, data) => {
          const { Err: E } = exports.DER;
          if (tag < 0 || tag > 256)
            throw new E("tlv.encode: wrong tag");
          if (data.length & 1)
            throw new E("tlv.encode: unpadded data");
          const dataLen = data.length / 2;
          const len = (0, utils_ts_1.numberToHexUnpadded)(dataLen);
          if (len.length / 2 & 128)
            throw new E("tlv.encode: long form length too big");
          const lenLen = dataLen > 127 ? (0, utils_ts_1.numberToHexUnpadded)(len.length / 2 | 128) : "";
          const t = (0, utils_ts_1.numberToHexUnpadded)(tag);
          return t + lenLen + len + data;
        },
        // v - value, l - left bytes (unparsed)
        decode(tag, data) {
          const { Err: E } = exports.DER;
          let pos = 0;
          if (tag < 0 || tag > 256)
            throw new E("tlv.encode: wrong tag");
          if (data.length < 2 || data[pos++] !== tag)
            throw new E("tlv.decode: wrong tlv");
          const first = data[pos++];
          const isLong = !!(first & 128);
          let length = 0;
          if (!isLong)
            length = first;
          else {
            const lenLen = first & 127;
            if (!lenLen)
              throw new E("tlv.decode(long): indefinite length not supported");
            if (lenLen > 4)
              throw new E("tlv.decode(long): byte length is too big");
            const lengthBytes = data.subarray(pos, pos + lenLen);
            if (lengthBytes.length !== lenLen)
              throw new E("tlv.decode: length bytes not complete");
            if (lengthBytes[0] === 0)
              throw new E("tlv.decode(long): zero leftmost byte");
            for (const b of lengthBytes)
              length = length << 8 | b;
            pos += lenLen;
            if (length < 128)
              throw new E("tlv.decode(long): not minimal encoding");
          }
          const v = data.subarray(pos, pos + length);
          if (v.length !== length)
            throw new E("tlv.decode: wrong value length");
          return { v, l: data.subarray(pos + length) };
        }
      },
      // https://crypto.stackexchange.com/a/57734 Leftmost bit of first byte is 'negative' flag,
      // since we always use positive integers here. It must always be empty:
      // - add zero byte if exists
      // - if next byte doesn't have a flag, leading zero is not allowed (minimal encoding)
      _int: {
        encode(num) {
          const { Err: E } = exports.DER;
          if (num < _0n8)
            throw new E("integer: negative integers are not allowed");
          let hex = (0, utils_ts_1.numberToHexUnpadded)(num);
          if (Number.parseInt(hex[0], 16) & 8)
            hex = "00" + hex;
          if (hex.length & 1)
            throw new E("unexpected DER parsing assertion: unpadded hex");
          return hex;
        },
        decode(data) {
          const { Err: E } = exports.DER;
          if (data[0] & 128)
            throw new E("invalid signature integer: negative");
          if (data[0] === 0 && !(data[1] & 128))
            throw new E("invalid signature integer: unnecessary leading zero");
          return (0, utils_ts_1.bytesToNumberBE)(data);
        }
      },
      toSig(hex) {
        const { Err: E, _int: int, _tlv: tlv } = exports.DER;
        const data = (0, utils_ts_1.ensureBytes)("signature", hex);
        const { v: seqBytes, l: seqLeftBytes } = tlv.decode(48, data);
        if (seqLeftBytes.length)
          throw new E("invalid signature: left bytes after parsing");
        const { v: rBytes, l: rLeftBytes } = tlv.decode(2, seqBytes);
        const { v: sBytes, l: sLeftBytes } = tlv.decode(2, rLeftBytes);
        if (sLeftBytes.length)
          throw new E("invalid signature: left bytes after parsing");
        return { r: int.decode(rBytes), s: int.decode(sBytes) };
      },
      hexFromSig(sig) {
        const { _tlv: tlv, _int: int } = exports.DER;
        const rs = tlv.encode(2, int.encode(sig.r));
        const ss = tlv.encode(2, int.encode(sig.s));
        const seq = rs + ss;
        return tlv.encode(48, seq);
      }
    };
    var _0n8 = BigInt(0);
    var _1n8 = BigInt(1);
    var _2n6 = BigInt(2);
    var _3n6 = BigInt(3);
    var _4n4 = BigInt(4);
    function _normFnElement2(Fn, key) {
      const { BYTES: expected } = Fn;
      let num;
      if (typeof key === "bigint") {
        num = key;
      } else {
        let bytes = (0, utils_ts_1.ensureBytes)("private key", key);
        try {
          num = Fn.fromBytes(bytes);
        } catch (error) {
          throw new Error(`invalid private key: expected ui8a of size ${expected}, got ${typeof key}`);
        }
      }
      if (!Fn.isValidNot0(num))
        throw new Error("invalid private key: out of range [1..N-1]");
      return num;
    }
    function weierstrassN2(params, extraOpts = {}) {
      const validated = (0, curve_ts_1._createCurveFields)("weierstrass", params, extraOpts);
      const { Fp: Fp3, Fn } = validated;
      let CURVE = validated.CURVE;
      const { h: cofactor, n: CURVE_ORDER } = CURVE;
      (0, utils_ts_1._validateObject)(extraOpts, {}, {
        allowInfinityPoint: "boolean",
        clearCofactor: "function",
        isTorsionFree: "function",
        fromBytes: "function",
        toBytes: "function",
        endo: "object",
        wrapPrivateKey: "boolean"
      });
      const { endo } = extraOpts;
      if (endo) {
        if (!Fp3.is0(CURVE.a) || typeof endo.beta !== "bigint" || !Array.isArray(endo.basises)) {
          throw new Error('invalid endo: expected "beta": bigint and "basises": array');
        }
      }
      const lengths = getWLengths2(Fp3, Fn);
      function assertCompressionIsSupported() {
        if (!Fp3.isOdd)
          throw new Error("compression is not supported: Field does not have .isOdd()");
      }
      function pointToBytes(_c, point, isCompressed) {
        const { x, y } = point.toAffine();
        const bx = Fp3.toBytes(x);
        (0, utils_ts_1._abool2)(isCompressed, "isCompressed");
        if (isCompressed) {
          assertCompressionIsSupported();
          const hasEvenY = !Fp3.isOdd(y);
          return (0, utils_ts_1.concatBytes)(pprefix2(hasEvenY), bx);
        } else {
          return (0, utils_ts_1.concatBytes)(Uint8Array.of(4), bx, Fp3.toBytes(y));
        }
      }
      function pointFromBytes(bytes) {
        (0, utils_ts_1._abytes2)(bytes, void 0, "Point");
        const { publicKey: comp, publicKeyUncompressed: uncomp } = lengths;
        const length = bytes.length;
        const head = bytes[0];
        const tail = bytes.subarray(1);
        if (length === comp && (head === 2 || head === 3)) {
          const x = Fp3.fromBytes(tail);
          if (!Fp3.isValid(x))
            throw new Error("bad point: is not on curve, wrong x");
          const y2 = weierstrassEquation(x);
          let y;
          try {
            y = Fp3.sqrt(y2);
          } catch (sqrtError) {
            const err = sqrtError instanceof Error ? ": " + sqrtError.message : "";
            throw new Error("bad point: is not on curve, sqrt error" + err);
          }
          assertCompressionIsSupported();
          const isYOdd = Fp3.isOdd(y);
          const isHeadOdd = (head & 1) === 1;
          if (isHeadOdd !== isYOdd)
            y = Fp3.neg(y);
          return { x, y };
        } else if (length === uncomp && head === 4) {
          const L = Fp3.BYTES;
          const x = Fp3.fromBytes(tail.subarray(0, L));
          const y = Fp3.fromBytes(tail.subarray(L, L * 2));
          if (!isValidXY(x, y))
            throw new Error("bad point: is not on curve");
          return { x, y };
        } else {
          throw new Error(`bad point: got length ${length}, expected compressed=${comp} or uncompressed=${uncomp}`);
        }
      }
      const encodePoint = extraOpts.toBytes || pointToBytes;
      const decodePoint = extraOpts.fromBytes || pointFromBytes;
      function weierstrassEquation(x) {
        const x2 = Fp3.sqr(x);
        const x3 = Fp3.mul(x2, x);
        return Fp3.add(Fp3.add(x3, Fp3.mul(x, CURVE.a)), CURVE.b);
      }
      function isValidXY(x, y) {
        const left = Fp3.sqr(y);
        const right = weierstrassEquation(x);
        return Fp3.eql(left, right);
      }
      if (!isValidXY(CURVE.Gx, CURVE.Gy))
        throw new Error("bad curve params: generator point");
      const _4a3 = Fp3.mul(Fp3.pow(CURVE.a, _3n6), _4n4);
      const _27b2 = Fp3.mul(Fp3.sqr(CURVE.b), BigInt(27));
      if (Fp3.is0(Fp3.add(_4a3, _27b2)))
        throw new Error("bad curve params: a or b");
      function acoord(title, n, banZero = false) {
        if (!Fp3.isValid(n) || banZero && Fp3.is0(n))
          throw new Error(`bad point coordinate ${title}`);
        return n;
      }
      function aprjpoint(other) {
        if (!(other instanceof Point))
          throw new Error("ProjectivePoint expected");
      }
      function splitEndoScalarN(k) {
        if (!endo || !endo.basises)
          throw new Error("no endo");
        return _splitEndoScalar2(k, endo.basises, Fn.ORDER);
      }
      const toAffineMemo = (0, utils_ts_1.memoized)((p, iz) => {
        const { X, Y, Z } = p;
        if (Fp3.eql(Z, Fp3.ONE))
          return { x: X, y: Y };
        const is0 = p.is0();
        if (iz == null)
          iz = is0 ? Fp3.ONE : Fp3.inv(Z);
        const x = Fp3.mul(X, iz);
        const y = Fp3.mul(Y, iz);
        const zz = Fp3.mul(Z, iz);
        if (is0)
          return { x: Fp3.ZERO, y: Fp3.ZERO };
        if (!Fp3.eql(zz, Fp3.ONE))
          throw new Error("invZ was invalid");
        return { x, y };
      });
      const assertValidMemo = (0, utils_ts_1.memoized)((p) => {
        if (p.is0()) {
          if (extraOpts.allowInfinityPoint && !Fp3.is0(p.Y))
            return;
          throw new Error("bad point: ZERO");
        }
        const { x, y } = p.toAffine();
        if (!Fp3.isValid(x) || !Fp3.isValid(y))
          throw new Error("bad point: x or y not field elements");
        if (!isValidXY(x, y))
          throw new Error("bad point: equation left != right");
        if (!p.isTorsionFree())
          throw new Error("bad point: not in prime-order subgroup");
        return true;
      });
      function finishEndo(endoBeta, k1p, k2p, k1neg, k2neg) {
        k2p = new Point(Fp3.mul(k2p.X, endoBeta), k2p.Y, k2p.Z);
        k1p = (0, curve_ts_1.negateCt)(k1neg, k1p);
        k2p = (0, curve_ts_1.negateCt)(k2neg, k2p);
        return k1p.add(k2p);
      }
      class Point {
        /** Does NOT validate if the point is valid. Use `.assertValidity()`. */
        constructor(X, Y, Z) {
          this.X = acoord("x", X);
          this.Y = acoord("y", Y, true);
          this.Z = acoord("z", Z);
          Object.freeze(this);
        }
        static CURVE() {
          return CURVE;
        }
        /** Does NOT validate if the point is valid. Use `.assertValidity()`. */
        static fromAffine(p) {
          const { x, y } = p || {};
          if (!p || !Fp3.isValid(x) || !Fp3.isValid(y))
            throw new Error("invalid affine point");
          if (p instanceof Point)
            throw new Error("projective point not allowed");
          if (Fp3.is0(x) && Fp3.is0(y))
            return Point.ZERO;
          return new Point(x, y, Fp3.ONE);
        }
        static fromBytes(bytes) {
          const P = Point.fromAffine(decodePoint((0, utils_ts_1._abytes2)(bytes, void 0, "point")));
          P.assertValidity();
          return P;
        }
        static fromHex(hex) {
          return Point.fromBytes((0, utils_ts_1.ensureBytes)("pointHex", hex));
        }
        get x() {
          return this.toAffine().x;
        }
        get y() {
          return this.toAffine().y;
        }
        /**
         *
         * @param windowSize
         * @param isLazy true will defer table computation until the first multiplication
         * @returns
         */
        precompute(windowSize = 8, isLazy = true) {
          wnaf.createCache(this, windowSize);
          if (!isLazy)
            this.multiply(_3n6);
          return this;
        }
        // TODO: return `this`
        /** A point on curve is valid if it conforms to equation. */
        assertValidity() {
          assertValidMemo(this);
        }
        hasEvenY() {
          const { y } = this.toAffine();
          if (!Fp3.isOdd)
            throw new Error("Field doesn't support isOdd");
          return !Fp3.isOdd(y);
        }
        /** Compare one point to another. */
        equals(other) {
          aprjpoint(other);
          const { X: X1, Y: Y1, Z: Z1 } = this;
          const { X: X2, Y: Y2, Z: Z2 } = other;
          const U1 = Fp3.eql(Fp3.mul(X1, Z2), Fp3.mul(X2, Z1));
          const U2 = Fp3.eql(Fp3.mul(Y1, Z2), Fp3.mul(Y2, Z1));
          return U1 && U2;
        }
        /** Flips point to one corresponding to (x, -y) in Affine coordinates. */
        negate() {
          return new Point(this.X, Fp3.neg(this.Y), this.Z);
        }
        // Renes-Costello-Batina exception-free doubling formula.
        // There is 30% faster Jacobian formula, but it is not complete.
        // https://eprint.iacr.org/2015/1060, algorithm 3
        // Cost: 8M + 3S + 3*a + 2*b3 + 15add.
        double() {
          const { a, b } = CURVE;
          const b3 = Fp3.mul(b, _3n6);
          const { X: X1, Y: Y1, Z: Z1 } = this;
          let X3 = Fp3.ZERO, Y3 = Fp3.ZERO, Z3 = Fp3.ZERO;
          let t0 = Fp3.mul(X1, X1);
          let t1 = Fp3.mul(Y1, Y1);
          let t2 = Fp3.mul(Z1, Z1);
          let t3 = Fp3.mul(X1, Y1);
          t3 = Fp3.add(t3, t3);
          Z3 = Fp3.mul(X1, Z1);
          Z3 = Fp3.add(Z3, Z3);
          X3 = Fp3.mul(a, Z3);
          Y3 = Fp3.mul(b3, t2);
          Y3 = Fp3.add(X3, Y3);
          X3 = Fp3.sub(t1, Y3);
          Y3 = Fp3.add(t1, Y3);
          Y3 = Fp3.mul(X3, Y3);
          X3 = Fp3.mul(t3, X3);
          Z3 = Fp3.mul(b3, Z3);
          t2 = Fp3.mul(a, t2);
          t3 = Fp3.sub(t0, t2);
          t3 = Fp3.mul(a, t3);
          t3 = Fp3.add(t3, Z3);
          Z3 = Fp3.add(t0, t0);
          t0 = Fp3.add(Z3, t0);
          t0 = Fp3.add(t0, t2);
          t0 = Fp3.mul(t0, t3);
          Y3 = Fp3.add(Y3, t0);
          t2 = Fp3.mul(Y1, Z1);
          t2 = Fp3.add(t2, t2);
          t0 = Fp3.mul(t2, t3);
          X3 = Fp3.sub(X3, t0);
          Z3 = Fp3.mul(t2, t1);
          Z3 = Fp3.add(Z3, Z3);
          Z3 = Fp3.add(Z3, Z3);
          return new Point(X3, Y3, Z3);
        }
        // Renes-Costello-Batina exception-free addition formula.
        // There is 30% faster Jacobian formula, but it is not complete.
        // https://eprint.iacr.org/2015/1060, algorithm 1
        // Cost: 12M + 0S + 3*a + 3*b3 + 23add.
        add(other) {
          aprjpoint(other);
          const { X: X1, Y: Y1, Z: Z1 } = this;
          const { X: X2, Y: Y2, Z: Z2 } = other;
          let X3 = Fp3.ZERO, Y3 = Fp3.ZERO, Z3 = Fp3.ZERO;
          const a = CURVE.a;
          const b3 = Fp3.mul(CURVE.b, _3n6);
          let t0 = Fp3.mul(X1, X2);
          let t1 = Fp3.mul(Y1, Y2);
          let t2 = Fp3.mul(Z1, Z2);
          let t3 = Fp3.add(X1, Y1);
          let t4 = Fp3.add(X2, Y2);
          t3 = Fp3.mul(t3, t4);
          t4 = Fp3.add(t0, t1);
          t3 = Fp3.sub(t3, t4);
          t4 = Fp3.add(X1, Z1);
          let t5 = Fp3.add(X2, Z2);
          t4 = Fp3.mul(t4, t5);
          t5 = Fp3.add(t0, t2);
          t4 = Fp3.sub(t4, t5);
          t5 = Fp3.add(Y1, Z1);
          X3 = Fp3.add(Y2, Z2);
          t5 = Fp3.mul(t5, X3);
          X3 = Fp3.add(t1, t2);
          t5 = Fp3.sub(t5, X3);
          Z3 = Fp3.mul(a, t4);
          X3 = Fp3.mul(b3, t2);
          Z3 = Fp3.add(X3, Z3);
          X3 = Fp3.sub(t1, Z3);
          Z3 = Fp3.add(t1, Z3);
          Y3 = Fp3.mul(X3, Z3);
          t1 = Fp3.add(t0, t0);
          t1 = Fp3.add(t1, t0);
          t2 = Fp3.mul(a, t2);
          t4 = Fp3.mul(b3, t4);
          t1 = Fp3.add(t1, t2);
          t2 = Fp3.sub(t0, t2);
          t2 = Fp3.mul(a, t2);
          t4 = Fp3.add(t4, t2);
          t0 = Fp3.mul(t1, t4);
          Y3 = Fp3.add(Y3, t0);
          t0 = Fp3.mul(t5, t4);
          X3 = Fp3.mul(t3, X3);
          X3 = Fp3.sub(X3, t0);
          t0 = Fp3.mul(t3, t1);
          Z3 = Fp3.mul(t5, Z3);
          Z3 = Fp3.add(Z3, t0);
          return new Point(X3, Y3, Z3);
        }
        subtract(other) {
          return this.add(other.negate());
        }
        is0() {
          return this.equals(Point.ZERO);
        }
        /**
         * Constant time multiplication.
         * Uses wNAF method. Windowed method may be 10% faster,
         * but takes 2x longer to generate and consumes 2x memory.
         * Uses precomputes when available.
         * Uses endomorphism for Koblitz curves.
         * @param scalar by which the point would be multiplied
         * @returns New point
         */
        multiply(scalar) {
          const { endo: endo2 } = extraOpts;
          if (!Fn.isValidNot0(scalar))
            throw new Error("invalid scalar: out of range");
          let point, fake;
          const mul = (n) => wnaf.cached(this, n, (p) => (0, curve_ts_1.normalizeZ)(Point, p));
          if (endo2) {
            const { k1neg, k1, k2neg, k2 } = splitEndoScalarN(scalar);
            const { p: k1p, f: k1f } = mul(k1);
            const { p: k2p, f: k2f } = mul(k2);
            fake = k1f.add(k2f);
            point = finishEndo(endo2.beta, k1p, k2p, k1neg, k2neg);
          } else {
            const { p, f } = mul(scalar);
            point = p;
            fake = f;
          }
          return (0, curve_ts_1.normalizeZ)(Point, [point, fake])[0];
        }
        /**
         * Non-constant-time multiplication. Uses double-and-add algorithm.
         * It's faster, but should only be used when you don't care about
         * an exposed secret key e.g. sig verification, which works over *public* keys.
         */
        multiplyUnsafe(sc) {
          const { endo: endo2 } = extraOpts;
          const p = this;
          if (!Fn.isValid(sc))
            throw new Error("invalid scalar: out of range");
          if (sc === _0n8 || p.is0())
            return Point.ZERO;
          if (sc === _1n8)
            return p;
          if (wnaf.hasCache(this))
            return this.multiply(sc);
          if (endo2) {
            const { k1neg, k1, k2neg, k2 } = splitEndoScalarN(sc);
            const { p1, p2 } = (0, curve_ts_1.mulEndoUnsafe)(Point, p, k1, k2);
            return finishEndo(endo2.beta, p1, p2, k1neg, k2neg);
          } else {
            return wnaf.unsafe(p, sc);
          }
        }
        multiplyAndAddUnsafe(Q, a, b) {
          const sum = this.multiplyUnsafe(a).add(Q.multiplyUnsafe(b));
          return sum.is0() ? void 0 : sum;
        }
        /**
         * Converts Projective point to affine (x, y) coordinates.
         * @param invertedZ Z^-1 (inverted zero) - optional, precomputation is useful for invertBatch
         */
        toAffine(invertedZ) {
          return toAffineMemo(this, invertedZ);
        }
        /**
         * Checks whether Point is free of torsion elements (is in prime subgroup).
         * Always torsion-free for cofactor=1 curves.
         */
        isTorsionFree() {
          const { isTorsionFree } = extraOpts;
          if (cofactor === _1n8)
            return true;
          if (isTorsionFree)
            return isTorsionFree(Point, this);
          return wnaf.unsafe(this, CURVE_ORDER).is0();
        }
        clearCofactor() {
          const { clearCofactor } = extraOpts;
          if (cofactor === _1n8)
            return this;
          if (clearCofactor)
            return clearCofactor(Point, this);
          return this.multiplyUnsafe(cofactor);
        }
        isSmallOrder() {
          return this.multiplyUnsafe(cofactor).is0();
        }
        toBytes(isCompressed = true) {
          (0, utils_ts_1._abool2)(isCompressed, "isCompressed");
          this.assertValidity();
          return encodePoint(Point, this, isCompressed);
        }
        toHex(isCompressed = true) {
          return (0, utils_ts_1.bytesToHex)(this.toBytes(isCompressed));
        }
        toString() {
          return `<Point ${this.is0() ? "ZERO" : this.toHex()}>`;
        }
        // TODO: remove
        get px() {
          return this.X;
        }
        get py() {
          return this.X;
        }
        get pz() {
          return this.Z;
        }
        toRawBytes(isCompressed = true) {
          return this.toBytes(isCompressed);
        }
        _setWindowSize(windowSize) {
          this.precompute(windowSize);
        }
        static normalizeZ(points) {
          return (0, curve_ts_1.normalizeZ)(Point, points);
        }
        static msm(points, scalars) {
          return (0, curve_ts_1.pippenger)(Point, Fn, points, scalars);
        }
        static fromPrivateKey(privateKey) {
          return Point.BASE.multiply(_normFnElement2(Fn, privateKey));
        }
      }
      Point.BASE = new Point(CURVE.Gx, CURVE.Gy, Fp3.ONE);
      Point.ZERO = new Point(Fp3.ZERO, Fp3.ONE, Fp3.ZERO);
      Point.Fp = Fp3;
      Point.Fn = Fn;
      const bits = Fn.BITS;
      const wnaf = new curve_ts_1.wNAF(Point, extraOpts.endo ? Math.ceil(bits / 2) : bits);
      Point.BASE.precompute(8);
      return Point;
    }
    function pprefix2(hasEvenY) {
      return Uint8Array.of(hasEvenY ? 2 : 3);
    }
    function SWUFpSqrtRatio2(Fp3, Z) {
      const q = Fp3.ORDER;
      let l = _0n8;
      for (let o = q - _1n8; o % _2n6 === _0n8; o /= _2n6)
        l += _1n8;
      const c1 = l;
      const _2n_pow_c1_1 = _2n6 << c1 - _1n8 - _1n8;
      const _2n_pow_c1 = _2n_pow_c1_1 * _2n6;
      const c2 = (q - _1n8) / _2n_pow_c1;
      const c3 = (c2 - _1n8) / _2n6;
      const c4 = _2n_pow_c1 - _1n8;
      const c5 = _2n_pow_c1_1;
      const c6 = Fp3.pow(Z, c2);
      const c7 = Fp3.pow(Z, (c2 + _1n8) / _2n6);
      let sqrtRatio = (u, v) => {
        let tv1 = c6;
        let tv2 = Fp3.pow(v, c4);
        let tv3 = Fp3.sqr(tv2);
        tv3 = Fp3.mul(tv3, v);
        let tv5 = Fp3.mul(u, tv3);
        tv5 = Fp3.pow(tv5, c3);
        tv5 = Fp3.mul(tv5, tv2);
        tv2 = Fp3.mul(tv5, v);
        tv3 = Fp3.mul(tv5, u);
        let tv4 = Fp3.mul(tv3, tv2);
        tv5 = Fp3.pow(tv4, c5);
        let isQR = Fp3.eql(tv5, Fp3.ONE);
        tv2 = Fp3.mul(tv3, c7);
        tv5 = Fp3.mul(tv4, tv1);
        tv3 = Fp3.cmov(tv2, tv3, isQR);
        tv4 = Fp3.cmov(tv5, tv4, isQR);
        for (let i = c1; i > _1n8; i--) {
          let tv52 = i - _2n6;
          tv52 = _2n6 << tv52 - _1n8;
          let tvv5 = Fp3.pow(tv4, tv52);
          const e1 = Fp3.eql(tvv5, Fp3.ONE);
          tv2 = Fp3.mul(tv3, tv1);
          tv1 = Fp3.mul(tv1, tv1);
          tvv5 = Fp3.mul(tv4, tv1);
          tv3 = Fp3.cmov(tv2, tv3, e1);
          tv4 = Fp3.cmov(tvv5, tv4, e1);
        }
        return { isValid: isQR, value: tv3 };
      };
      if (Fp3.ORDER % _4n4 === _3n6) {
        const c12 = (Fp3.ORDER - _3n6) / _4n4;
        const c22 = Fp3.sqrt(Fp3.neg(Z));
        sqrtRatio = (u, v) => {
          let tv1 = Fp3.sqr(v);
          const tv2 = Fp3.mul(u, v);
          tv1 = Fp3.mul(tv1, tv2);
          let y1 = Fp3.pow(tv1, c12);
          y1 = Fp3.mul(y1, tv2);
          const y2 = Fp3.mul(y1, c22);
          const tv3 = Fp3.mul(Fp3.sqr(y1), v);
          const isQR = Fp3.eql(tv3, u);
          let y = Fp3.cmov(y2, y1, isQR);
          return { isValid: isQR, value: y };
        };
      }
      return sqrtRatio;
    }
    function mapToCurveSimpleSWU2(Fp3, opts) {
      (0, modular_ts_1.validateField)(Fp3);
      const { A, B, Z } = opts;
      if (!Fp3.isValid(A) || !Fp3.isValid(B) || !Fp3.isValid(Z))
        throw new Error("mapToCurveSimpleSWU: invalid opts");
      const sqrtRatio = SWUFpSqrtRatio2(Fp3, Z);
      if (!Fp3.isOdd)
        throw new Error("Field does not have .isOdd()");
      return (u) => {
        let tv1, tv2, tv3, tv4, tv5, tv6, x, y;
        tv1 = Fp3.sqr(u);
        tv1 = Fp3.mul(tv1, Z);
        tv2 = Fp3.sqr(tv1);
        tv2 = Fp3.add(tv2, tv1);
        tv3 = Fp3.add(tv2, Fp3.ONE);
        tv3 = Fp3.mul(tv3, B);
        tv4 = Fp3.cmov(Z, Fp3.neg(tv2), !Fp3.eql(tv2, Fp3.ZERO));
        tv4 = Fp3.mul(tv4, A);
        tv2 = Fp3.sqr(tv3);
        tv6 = Fp3.sqr(tv4);
        tv5 = Fp3.mul(tv6, A);
        tv2 = Fp3.add(tv2, tv5);
        tv2 = Fp3.mul(tv2, tv3);
        tv6 = Fp3.mul(tv6, tv4);
        tv5 = Fp3.mul(tv6, B);
        tv2 = Fp3.add(tv2, tv5);
        x = Fp3.mul(tv1, tv3);
        const { isValid, value } = sqrtRatio(tv2, tv6);
        y = Fp3.mul(tv1, u);
        y = Fp3.mul(y, value);
        x = Fp3.cmov(x, tv3, isValid);
        y = Fp3.cmov(y, value, isValid);
        const e1 = Fp3.isOdd(u) === Fp3.isOdd(y);
        y = Fp3.cmov(Fp3.neg(y), y, e1);
        const tv4_inv = (0, modular_ts_1.FpInvertBatch)(Fp3, [tv4], true)[0];
        x = Fp3.mul(x, tv4_inv);
        return { x, y };
      };
    }
    function getWLengths2(Fp3, Fn) {
      return {
        secretKey: Fn.BYTES,
        publicKey: 1 + Fp3.BYTES,
        publicKeyUncompressed: 1 + 2 * Fp3.BYTES,
        publicKeyHasPrefix: true,
        signature: 2 * Fn.BYTES
      };
    }
    function ecdh(Point, ecdhOpts = {}) {
      const { Fn } = Point;
      const randomBytes_ = ecdhOpts.randomBytes || utils_ts_1.randomBytes;
      const lengths = Object.assign(getWLengths2(Point.Fp, Fn), { seed: (0, modular_ts_1.getMinHashLength)(Fn.ORDER) });
      function isValidSecretKey(secretKey) {
        try {
          return !!_normFnElement2(Fn, secretKey);
        } catch (error) {
          return false;
        }
      }
      function isValidPublicKey(publicKey, isCompressed) {
        const { publicKey: comp, publicKeyUncompressed } = lengths;
        try {
          const l = publicKey.length;
          if (isCompressed === true && l !== comp)
            return false;
          if (isCompressed === false && l !== publicKeyUncompressed)
            return false;
          return !!Point.fromBytes(publicKey);
        } catch (error) {
          return false;
        }
      }
      function randomSecretKey(seed = randomBytes_(lengths.seed)) {
        return (0, modular_ts_1.mapHashToField)((0, utils_ts_1._abytes2)(seed, lengths.seed, "seed"), Fn.ORDER);
      }
      function getPublicKey(secretKey, isCompressed = true) {
        return Point.BASE.multiply(_normFnElement2(Fn, secretKey)).toBytes(isCompressed);
      }
      function keygen(seed) {
        const secretKey = randomSecretKey(seed);
        return { secretKey, publicKey: getPublicKey(secretKey) };
      }
      function isProbPub(item) {
        if (typeof item === "bigint")
          return false;
        if (item instanceof Point)
          return true;
        const { secretKey, publicKey, publicKeyUncompressed } = lengths;
        if (Fn.allowedLengths || secretKey === publicKey)
          return void 0;
        const l = (0, utils_ts_1.ensureBytes)("key", item).length;
        return l === publicKey || l === publicKeyUncompressed;
      }
      function getSharedSecret(secretKeyA, publicKeyB, isCompressed = true) {
        if (isProbPub(secretKeyA) === true)
          throw new Error("first arg must be private key");
        if (isProbPub(publicKeyB) === false)
          throw new Error("second arg must be public key");
        const s = _normFnElement2(Fn, secretKeyA);
        const b = Point.fromHex(publicKeyB);
        return b.multiply(s).toBytes(isCompressed);
      }
      const utils = {
        isValidSecretKey,
        isValidPublicKey,
        randomSecretKey,
        // TODO: remove
        isValidPrivateKey: isValidSecretKey,
        randomPrivateKey: randomSecretKey,
        normPrivateKeyToScalar: (key) => _normFnElement2(Fn, key),
        precompute(windowSize = 8, point = Point.BASE) {
          return point.precompute(windowSize, false);
        }
      };
      return Object.freeze({ getPublicKey, getSharedSecret, keygen, Point, utils, lengths });
    }
    function ecdsa(Point, hash2, ecdsaOpts = {}) {
      (0, utils_1.ahash)(hash2);
      (0, utils_ts_1._validateObject)(ecdsaOpts, {}, {
        hmac: "function",
        lowS: "boolean",
        randomBytes: "function",
        bits2int: "function",
        bits2int_modN: "function"
      });
      const randomBytes2 = ecdsaOpts.randomBytes || utils_ts_1.randomBytes;
      const hmac = ecdsaOpts.hmac || ((key, ...msgs) => (0, hmac_js_1.hmac)(hash2, key, (0, utils_ts_1.concatBytes)(...msgs)));
      const { Fp: Fp3, Fn } = Point;
      const { ORDER: CURVE_ORDER, BITS: fnBits } = Fn;
      const { keygen, getPublicKey, getSharedSecret, utils, lengths } = ecdh(Point, ecdsaOpts);
      const defaultSigOpts = {
        prehash: false,
        lowS: typeof ecdsaOpts.lowS === "boolean" ? ecdsaOpts.lowS : false,
        format: void 0,
        //'compact' as ECDSASigFormat,
        extraEntropy: false
      };
      const defaultSigOpts_format = "compact";
      function isBiggerThanHalfOrder(number) {
        const HALF = CURVE_ORDER >> _1n8;
        return number > HALF;
      }
      function validateRS(title, num) {
        if (!Fn.isValidNot0(num))
          throw new Error(`invalid signature ${title}: out of range 1..Point.Fn.ORDER`);
        return num;
      }
      function validateSigLength(bytes, format) {
        validateSigFormat(format);
        const size = lengths.signature;
        const sizer = format === "compact" ? size : format === "recovered" ? size + 1 : void 0;
        return (0, utils_ts_1._abytes2)(bytes, sizer, `${format} signature`);
      }
      class Signature {
        constructor(r, s, recovery) {
          this.r = validateRS("r", r);
          this.s = validateRS("s", s);
          if (recovery != null)
            this.recovery = recovery;
          Object.freeze(this);
        }
        static fromBytes(bytes, format = defaultSigOpts_format) {
          validateSigLength(bytes, format);
          let recid;
          if (format === "der") {
            const { r: r2, s: s2 } = exports.DER.toSig((0, utils_ts_1._abytes2)(bytes));
            return new Signature(r2, s2);
          }
          if (format === "recovered") {
            recid = bytes[0];
            format = "compact";
            bytes = bytes.subarray(1);
          }
          const L = Fn.BYTES;
          const r = bytes.subarray(0, L);
          const s = bytes.subarray(L, L * 2);
          return new Signature(Fn.fromBytes(r), Fn.fromBytes(s), recid);
        }
        static fromHex(hex, format) {
          return this.fromBytes((0, utils_ts_1.hexToBytes)(hex), format);
        }
        addRecoveryBit(recovery) {
          return new Signature(this.r, this.s, recovery);
        }
        recoverPublicKey(messageHash) {
          const FIELD_ORDER = Fp3.ORDER;
          const { r, s, recovery: rec } = this;
          if (rec == null || ![0, 1, 2, 3].includes(rec))
            throw new Error("recovery id invalid");
          const hasCofactor = CURVE_ORDER * _2n6 < FIELD_ORDER;
          if (hasCofactor && rec > 1)
            throw new Error("recovery id is ambiguous for h>1 curve");
          const radj = rec === 2 || rec === 3 ? r + CURVE_ORDER : r;
          if (!Fp3.isValid(radj))
            throw new Error("recovery id 2 or 3 invalid");
          const x = Fp3.toBytes(radj);
          const R = Point.fromBytes((0, utils_ts_1.concatBytes)(pprefix2((rec & 1) === 0), x));
          const ir = Fn.inv(radj);
          const h = bits2int_modN((0, utils_ts_1.ensureBytes)("msgHash", messageHash));
          const u1 = Fn.create(-h * ir);
          const u2 = Fn.create(s * ir);
          const Q = Point.BASE.multiplyUnsafe(u1).add(R.multiplyUnsafe(u2));
          if (Q.is0())
            throw new Error("point at infinify");
          Q.assertValidity();
          return Q;
        }
        // Signatures should be low-s, to prevent malleability.
        hasHighS() {
          return isBiggerThanHalfOrder(this.s);
        }
        toBytes(format = defaultSigOpts_format) {
          validateSigFormat(format);
          if (format === "der")
            return (0, utils_ts_1.hexToBytes)(exports.DER.hexFromSig(this));
          const r = Fn.toBytes(this.r);
          const s = Fn.toBytes(this.s);
          if (format === "recovered") {
            if (this.recovery == null)
              throw new Error("recovery bit must be present");
            return (0, utils_ts_1.concatBytes)(Uint8Array.of(this.recovery), r, s);
          }
          return (0, utils_ts_1.concatBytes)(r, s);
        }
        toHex(format) {
          return (0, utils_ts_1.bytesToHex)(this.toBytes(format));
        }
        // TODO: remove
        assertValidity() {
        }
        static fromCompact(hex) {
          return Signature.fromBytes((0, utils_ts_1.ensureBytes)("sig", hex), "compact");
        }
        static fromDER(hex) {
          return Signature.fromBytes((0, utils_ts_1.ensureBytes)("sig", hex), "der");
        }
        normalizeS() {
          return this.hasHighS() ? new Signature(this.r, Fn.neg(this.s), this.recovery) : this;
        }
        toDERRawBytes() {
          return this.toBytes("der");
        }
        toDERHex() {
          return (0, utils_ts_1.bytesToHex)(this.toBytes("der"));
        }
        toCompactRawBytes() {
          return this.toBytes("compact");
        }
        toCompactHex() {
          return (0, utils_ts_1.bytesToHex)(this.toBytes("compact"));
        }
      }
      const bits2int = ecdsaOpts.bits2int || function bits2int_def(bytes) {
        if (bytes.length > 8192)
          throw new Error("input is too large");
        const num = (0, utils_ts_1.bytesToNumberBE)(bytes);
        const delta = bytes.length * 8 - fnBits;
        return delta > 0 ? num >> BigInt(delta) : num;
      };
      const bits2int_modN = ecdsaOpts.bits2int_modN || function bits2int_modN_def(bytes) {
        return Fn.create(bits2int(bytes));
      };
      const ORDER_MASK = (0, utils_ts_1.bitMask)(fnBits);
      function int2octets(num) {
        (0, utils_ts_1.aInRange)("num < 2^" + fnBits, num, _0n8, ORDER_MASK);
        return Fn.toBytes(num);
      }
      function validateMsgAndHash(message, prehash) {
        (0, utils_ts_1._abytes2)(message, void 0, "message");
        return prehash ? (0, utils_ts_1._abytes2)(hash2(message), void 0, "prehashed message") : message;
      }
      function prepSig(message, privateKey, opts) {
        if (["recovered", "canonical"].some((k) => k in opts))
          throw new Error("sign() legacy options not supported");
        const { lowS, prehash, extraEntropy } = validateSigOpts(opts, defaultSigOpts);
        message = validateMsgAndHash(message, prehash);
        const h1int = bits2int_modN(message);
        const d = _normFnElement2(Fn, privateKey);
        const seedArgs = [int2octets(d), int2octets(h1int)];
        if (extraEntropy != null && extraEntropy !== false) {
          const e = extraEntropy === true ? randomBytes2(lengths.secretKey) : extraEntropy;
          seedArgs.push((0, utils_ts_1.ensureBytes)("extraEntropy", e));
        }
        const seed = (0, utils_ts_1.concatBytes)(...seedArgs);
        const m = h1int;
        function k2sig(kBytes) {
          const k = bits2int(kBytes);
          if (!Fn.isValidNot0(k))
            return;
          const ik = Fn.inv(k);
          const q = Point.BASE.multiply(k).toAffine();
          const r = Fn.create(q.x);
          if (r === _0n8)
            return;
          const s = Fn.create(ik * Fn.create(m + r * d));
          if (s === _0n8)
            return;
          let recovery = (q.x === r ? 0 : 2) | Number(q.y & _1n8);
          let normS = s;
          if (lowS && isBiggerThanHalfOrder(s)) {
            normS = Fn.neg(s);
            recovery ^= 1;
          }
          return new Signature(r, normS, recovery);
        }
        return { seed, k2sig };
      }
      function sign4(message, secretKey, opts = {}) {
        message = (0, utils_ts_1.ensureBytes)("message", message);
        const { seed, k2sig } = prepSig(message, secretKey, opts);
        const drbg = (0, utils_ts_1.createHmacDrbg)(hash2.outputLen, Fn.BYTES, hmac);
        const sig = drbg(seed, k2sig);
        return sig;
      }
      function tryParsingSig(sg) {
        let sig = void 0;
        const isHex = typeof sg === "string" || (0, utils_ts_1.isBytes)(sg);
        const isObj = !isHex && sg !== null && typeof sg === "object" && typeof sg.r === "bigint" && typeof sg.s === "bigint";
        if (!isHex && !isObj)
          throw new Error("invalid signature, expected Uint8Array, hex string or Signature instance");
        if (isObj) {
          sig = new Signature(sg.r, sg.s);
        } else if (isHex) {
          try {
            sig = Signature.fromBytes((0, utils_ts_1.ensureBytes)("sig", sg), "der");
          } catch (derError) {
            if (!(derError instanceof exports.DER.Err))
              throw derError;
          }
          if (!sig) {
            try {
              sig = Signature.fromBytes((0, utils_ts_1.ensureBytes)("sig", sg), "compact");
            } catch (error) {
              return false;
            }
          }
        }
        if (!sig)
          return false;
        return sig;
      }
      function verify4(signature, message, publicKey, opts = {}) {
        const { lowS, prehash, format } = validateSigOpts(opts, defaultSigOpts);
        publicKey = (0, utils_ts_1.ensureBytes)("publicKey", publicKey);
        message = validateMsgAndHash((0, utils_ts_1.ensureBytes)("message", message), prehash);
        if ("strict" in opts)
          throw new Error("options.strict was renamed to lowS");
        const sig = format === void 0 ? tryParsingSig(signature) : Signature.fromBytes((0, utils_ts_1.ensureBytes)("sig", signature), format);
        if (sig === false)
          return false;
        try {
          const P = Point.fromBytes(publicKey);
          if (lowS && sig.hasHighS())
            return false;
          const { r, s } = sig;
          const h = bits2int_modN(message);
          const is = Fn.inv(s);
          const u1 = Fn.create(h * is);
          const u2 = Fn.create(r * is);
          const R = Point.BASE.multiplyUnsafe(u1).add(P.multiplyUnsafe(u2));
          if (R.is0())
            return false;
          const v = Fn.create(R.x);
          return v === r;
        } catch (e) {
          return false;
        }
      }
      function recoverPublicKey(signature, message, opts = {}) {
        const { prehash } = validateSigOpts(opts, defaultSigOpts);
        message = validateMsgAndHash(message, prehash);
        return Signature.fromBytes(signature, "recovered").recoverPublicKey(message).toBytes();
      }
      return Object.freeze({
        keygen,
        getPublicKey,
        getSharedSecret,
        utils,
        lengths,
        Point,
        sign: sign4,
        verify: verify4,
        recoverPublicKey,
        Signature,
        hash: hash2
      });
    }
    function weierstrassPoints2(c) {
      const { CURVE, curveOpts } = _weierstrass_legacy_opts_to_new2(c);
      const Point = weierstrassN2(CURVE, curveOpts);
      return _weierstrass_new_output_to_legacy2(c, Point);
    }
    function _weierstrass_legacy_opts_to_new2(c) {
      const CURVE = {
        a: c.a,
        b: c.b,
        p: c.Fp.ORDER,
        n: c.n,
        h: c.h,
        Gx: c.Gx,
        Gy: c.Gy
      };
      const Fp3 = c.Fp;
      let allowedLengths = c.allowedPrivateKeyLengths ? Array.from(new Set(c.allowedPrivateKeyLengths.map((l) => Math.ceil(l / 2)))) : void 0;
      const Fn = (0, modular_ts_1.Field)(CURVE.n, {
        BITS: c.nBitLength,
        allowedLengths,
        modFromBytes: c.wrapPrivateKey
      });
      const curveOpts = {
        Fp: Fp3,
        Fn,
        allowInfinityPoint: c.allowInfinityPoint,
        endo: c.endo,
        isTorsionFree: c.isTorsionFree,
        clearCofactor: c.clearCofactor,
        fromBytes: c.fromBytes,
        toBytes: c.toBytes
      };
      return { CURVE, curveOpts };
    }
    function _ecdsa_legacy_opts_to_new(c) {
      const { CURVE, curveOpts } = _weierstrass_legacy_opts_to_new2(c);
      const ecdsaOpts = {
        hmac: c.hmac,
        randomBytes: c.randomBytes,
        lowS: c.lowS,
        bits2int: c.bits2int,
        bits2int_modN: c.bits2int_modN
      };
      return { CURVE, curveOpts, hash: c.hash, ecdsaOpts };
    }
    function _legacyHelperEquat2(Fp3, a, b) {
      function weierstrassEquation(x) {
        const x2 = Fp3.sqr(x);
        const x3 = Fp3.mul(x2, x);
        return Fp3.add(Fp3.add(x3, Fp3.mul(x, a)), b);
      }
      return weierstrassEquation;
    }
    function _weierstrass_new_output_to_legacy2(c, Point) {
      const { Fp: Fp3, Fn } = Point;
      function isWithinCurveOrder(num) {
        return (0, utils_ts_1.inRange)(num, _1n8, Fn.ORDER);
      }
      const weierstrassEquation = _legacyHelperEquat2(Fp3, c.a, c.b);
      return Object.assign({}, {
        CURVE: c,
        Point,
        ProjectivePoint: Point,
        normPrivateKeyToScalar: (key) => _normFnElement2(Fn, key),
        weierstrassEquation,
        isWithinCurveOrder
      });
    }
    function _ecdsa_new_output_to_legacy(c, _ecdsa) {
      const Point = _ecdsa.Point;
      return Object.assign({}, _ecdsa, {
        ProjectivePoint: Point,
        CURVE: Object.assign({}, c, (0, modular_ts_1.nLength)(Point.Fn.ORDER, Point.Fn.BITS))
      });
    }
    function weierstrass(c) {
      const { CURVE, curveOpts, hash: hash2, ecdsaOpts } = _ecdsa_legacy_opts_to_new(c);
      const Point = weierstrassN2(CURVE, curveOpts);
      const signs = ecdsa(Point, hash2, ecdsaOpts);
      return _ecdsa_new_output_to_legacy(c, signs);
    }
  }
});

// node_modules/@noble/curves/abstract/bls.js
var require_bls = __commonJS({
  "node_modules/@noble/curves/abstract/bls.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.bls = bls2;
    var utils_ts_1 = require_utils2();
    var curve_ts_1 = require_curve();
    var hash_to_curve_ts_1 = require_hash_to_curve();
    var modular_ts_1 = require_modular();
    var weierstrass_ts_1 = require_weierstrass();
    var _0n8 = BigInt(0);
    var _1n8 = BigInt(1);
    var _2n6 = BigInt(2);
    var _3n6 = BigInt(3);
    function NAfDecomposition2(a) {
      const res = [];
      for (; a > _1n8; a >>= _1n8) {
        if ((a & _1n8) === _0n8)
          res.unshift(0);
        else if ((a & _3n6) === _3n6) {
          res.unshift(-1);
          a += _1n8;
        } else
          res.unshift(1);
      }
      return res;
    }
    function aNonEmpty2(arr) {
      if (!Array.isArray(arr) || arr.length === 0)
        throw new Error("expected non-empty array");
    }
    function createBlsPairing2(fields, G1, G2, params) {
      const { Fp2: Fp22, Fp12: Fp122 } = fields;
      const { twistType, ateLoopSize, xNegative, postPrecompute } = params;
      let lineFunction;
      if (twistType === "multiplicative") {
        lineFunction = (c0, c1, c2, f, Px, Py) => Fp122.mul014(f, c0, Fp22.mul(c1, Px), Fp22.mul(c2, Py));
      } else if (twistType === "divisive") {
        lineFunction = (c0, c1, c2, f, Px, Py) => Fp122.mul034(f, Fp22.mul(c2, Py), Fp22.mul(c1, Px), c0);
      } else
        throw new Error("bls: unknown twist type");
      const Fp2div2 = Fp22.div(Fp22.ONE, Fp22.mul(Fp22.ONE, _2n6));
      function pointDouble(ell, Rx, Ry, Rz) {
        const t0 = Fp22.sqr(Ry);
        const t1 = Fp22.sqr(Rz);
        const t2 = Fp22.mulByB(Fp22.mul(t1, _3n6));
        const t3 = Fp22.mul(t2, _3n6);
        const t4 = Fp22.sub(Fp22.sub(Fp22.sqr(Fp22.add(Ry, Rz)), t1), t0);
        const c0 = Fp22.sub(t2, t0);
        const c1 = Fp22.mul(Fp22.sqr(Rx), _3n6);
        const c2 = Fp22.neg(t4);
        ell.push([c0, c1, c2]);
        Rx = Fp22.mul(Fp22.mul(Fp22.mul(Fp22.sub(t0, t3), Rx), Ry), Fp2div2);
        Ry = Fp22.sub(Fp22.sqr(Fp22.mul(Fp22.add(t0, t3), Fp2div2)), Fp22.mul(Fp22.sqr(t2), _3n6));
        Rz = Fp22.mul(t0, t4);
        return { Rx, Ry, Rz };
      }
      function pointAdd(ell, Rx, Ry, Rz, Qx, Qy) {
        const t0 = Fp22.sub(Ry, Fp22.mul(Qy, Rz));
        const t1 = Fp22.sub(Rx, Fp22.mul(Qx, Rz));
        const c0 = Fp22.sub(Fp22.mul(t0, Qx), Fp22.mul(t1, Qy));
        const c1 = Fp22.neg(t0);
        const c2 = t1;
        ell.push([c0, c1, c2]);
        const t2 = Fp22.sqr(t1);
        const t3 = Fp22.mul(t2, t1);
        const t4 = Fp22.mul(t2, Rx);
        const t5 = Fp22.add(Fp22.sub(t3, Fp22.mul(t4, _2n6)), Fp22.mul(Fp22.sqr(t0), Rz));
        Rx = Fp22.mul(t1, t5);
        Ry = Fp22.sub(Fp22.mul(Fp22.sub(t4, t5), t0), Fp22.mul(t3, Ry));
        Rz = Fp22.mul(Rz, t3);
        return { Rx, Ry, Rz };
      }
      const ATE_NAF = NAfDecomposition2(ateLoopSize);
      const calcPairingPrecomputes = (0, utils_ts_1.memoized)((point) => {
        const p = point;
        const { x, y } = p.toAffine();
        const Qx = x, Qy = y, negQy = Fp22.neg(y);
        let Rx = Qx, Ry = Qy, Rz = Fp22.ONE;
        const ell = [];
        for (const bit of ATE_NAF) {
          const cur = [];
          ({ Rx, Ry, Rz } = pointDouble(cur, Rx, Ry, Rz));
          if (bit)
            ({ Rx, Ry, Rz } = pointAdd(cur, Rx, Ry, Rz, Qx, bit === -1 ? negQy : Qy));
          ell.push(cur);
        }
        if (postPrecompute) {
          const last = ell[ell.length - 1];
          postPrecompute(Rx, Ry, Rz, Qx, Qy, pointAdd.bind(null, last));
        }
        return ell;
      });
      function millerLoopBatch(pairs, withFinalExponent = false) {
        let f12 = Fp122.ONE;
        if (pairs.length) {
          const ellLen = pairs[0][0].length;
          for (let i = 0; i < ellLen; i++) {
            f12 = Fp122.sqr(f12);
            for (const [ell, Px, Py] of pairs) {
              for (const [c0, c1, c2] of ell[i])
                f12 = lineFunction(c0, c1, c2, f12, Px, Py);
            }
          }
        }
        if (xNegative)
          f12 = Fp122.conjugate(f12);
        return withFinalExponent ? Fp122.finalExponentiate(f12) : f12;
      }
      function pairingBatch(pairs, withFinalExponent = true) {
        const res = [];
        (0, curve_ts_1.normalizeZ)(G1, pairs.map(({ g1 }) => g1));
        (0, curve_ts_1.normalizeZ)(G2, pairs.map(({ g2 }) => g2));
        for (const { g1, g2 } of pairs) {
          if (g1.is0() || g2.is0())
            throw new Error("pairing is not available for ZERO point");
          g1.assertValidity();
          g2.assertValidity();
          const Qa = g1.toAffine();
          res.push([calcPairingPrecomputes(g2), Qa.x, Qa.y]);
        }
        return millerLoopBatch(res, withFinalExponent);
      }
      function pairing(Q, P, withFinalExponent = true) {
        return pairingBatch([{ g1: Q, g2: P }], withFinalExponent);
      }
      return {
        Fp12: Fp122,
        // NOTE: we re-export Fp12 here because pairing results are Fp12!
        millerLoopBatch,
        pairing,
        pairingBatch,
        calcPairingPrecomputes
      };
    }
    function createBlsSig2(blsPairing, PubCurve, SigCurve, SignatureCoder, isSigG1) {
      const { Fp12: Fp122, pairingBatch } = blsPairing;
      function normPub(point) {
        return point instanceof PubCurve.Point ? point : PubCurve.Point.fromHex(point);
      }
      function normSig(point) {
        return point instanceof SigCurve.Point ? point : SigCurve.Point.fromHex(point);
      }
      function amsg(m) {
        if (!(m instanceof SigCurve.Point))
          throw new Error(`expected valid message hashed to ${!isSigG1 ? "G2" : "G1"} curve`);
        return m;
      }
      const pair = !isSigG1 ? (a, b) => ({ g1: a, g2: b }) : (a, b) => ({ g1: b, g2: a });
      return {
        // P = pk x G
        getPublicKey(secretKey) {
          const sec = (0, weierstrass_ts_1._normFnElement)(PubCurve.Point.Fn, secretKey);
          return PubCurve.Point.BASE.multiply(sec);
        },
        // S = pk x H(m)
        sign(message, secretKey, unusedArg) {
          if (unusedArg != null)
            throw new Error("sign() expects 2 arguments");
          const sec = (0, weierstrass_ts_1._normFnElement)(PubCurve.Point.Fn, secretKey);
          amsg(message).assertValidity();
          return message.multiply(sec);
        },
        // Checks if pairing of public key & hash is equal to pairing of generator & signature.
        // e(P, H(m)) == e(G, S)
        // e(S, G) == e(H(m), P)
        verify(signature, message, publicKey, unusedArg) {
          if (unusedArg != null)
            throw new Error("verify() expects 3 arguments");
          signature = normSig(signature);
          publicKey = normPub(publicKey);
          const P = publicKey.negate();
          const G = PubCurve.Point.BASE;
          const Hm = amsg(message);
          const S = signature;
          const exp = pairingBatch([pair(P, Hm), pair(G, S)]);
          return Fp122.eql(exp, Fp122.ONE);
        },
        // https://ethresear.ch/t/fast-verification-of-multiple-bls-signatures/5407
        // e(G, S) = e(G, SUM(n)(Si)) = MUL(n)(e(G, Si))
        // TODO: maybe `{message: G2Hex, publicKey: G1Hex}[]` instead?
        verifyBatch(signature, messages, publicKeys) {
          aNonEmpty2(messages);
          if (publicKeys.length !== messages.length)
            throw new Error("amount of public keys and messages should be equal");
          const sig = normSig(signature);
          const nMessages = messages;
          const nPublicKeys = publicKeys.map(normPub);
          const messagePubKeyMap = /* @__PURE__ */ new Map();
          for (let i = 0; i < nPublicKeys.length; i++) {
            const pub = nPublicKeys[i];
            const msg = nMessages[i];
            let keys2 = messagePubKeyMap.get(msg);
            if (keys2 === void 0) {
              keys2 = [];
              messagePubKeyMap.set(msg, keys2);
            }
            keys2.push(pub);
          }
          const paired = [];
          const G = PubCurve.Point.BASE;
          try {
            for (const [msg, keys2] of messagePubKeyMap) {
              const groupPublicKey = keys2.reduce((acc, msg2) => acc.add(msg2));
              paired.push(pair(groupPublicKey, msg));
            }
            paired.push(pair(G.negate(), sig));
            return Fp122.eql(pairingBatch(paired), Fp122.ONE);
          } catch {
            return false;
          }
        },
        // Adds a bunch of public key points together.
        // pk1 + pk2 + pk3 = pkA
        aggregatePublicKeys(publicKeys) {
          aNonEmpty2(publicKeys);
          publicKeys = publicKeys.map((pub) => normPub(pub));
          const agg = publicKeys.reduce((sum, p) => sum.add(p), PubCurve.Point.ZERO);
          agg.assertValidity();
          return agg;
        },
        // Adds a bunch of signature points together.
        // pk1 + pk2 + pk3 = pkA
        aggregateSignatures(signatures) {
          aNonEmpty2(signatures);
          signatures = signatures.map((sig) => normSig(sig));
          const agg = signatures.reduce((sum, s) => sum.add(s), SigCurve.Point.ZERO);
          agg.assertValidity();
          return agg;
        },
        hash(messageBytes, DST) {
          (0, utils_ts_1.abytes)(messageBytes);
          const opts = DST ? { DST } : void 0;
          return SigCurve.hashToCurve(messageBytes, opts);
        },
        Signature: SignatureCoder
      };
    }
    function bls2(CURVE) {
      const { Fp: Fp3, Fr, Fp2: Fp22, Fp6: Fp62, Fp12: Fp122 } = CURVE.fields;
      const G1_ = (0, weierstrass_ts_1.weierstrassPoints)(CURVE.G1);
      const G1 = Object.assign(G1_, (0, hash_to_curve_ts_1.createHasher)(G1_.Point, CURVE.G1.mapToCurve, {
        ...CURVE.htfDefaults,
        ...CURVE.G1.htfDefaults
      }));
      const G2_ = (0, weierstrass_ts_1.weierstrassPoints)(CURVE.G2);
      const G2 = Object.assign(G2_, (0, hash_to_curve_ts_1.createHasher)(G2_.Point, CURVE.G2.mapToCurve, {
        ...CURVE.htfDefaults,
        ...CURVE.G2.htfDefaults
      }));
      const pairingRes = createBlsPairing2(CURVE.fields, G1.Point, G2.Point, {
        ...CURVE.params,
        postPrecompute: CURVE.postPrecompute
      });
      const { millerLoopBatch, pairing, pairingBatch, calcPairingPrecomputes } = pairingRes;
      const longSignatures = createBlsSig2(pairingRes, G1, G2, CURVE.G2.Signature, false);
      const shortSignatures = createBlsSig2(pairingRes, G2, G1, CURVE.G1.ShortSignature, true);
      const rand = CURVE.randomBytes || utils_ts_1.randomBytes;
      const randomSecretKey = () => {
        const length = (0, modular_ts_1.getMinHashLength)(Fr.ORDER);
        return (0, modular_ts_1.mapHashToField)(rand(length), Fr.ORDER);
      };
      const utils = {
        randomSecretKey,
        randomPrivateKey: randomSecretKey,
        calcPairingPrecomputes
      };
      const { ShortSignature } = CURVE.G1;
      const { Signature } = CURVE.G2;
      function normP1Hash(point, htfOpts) {
        return point instanceof G1.Point ? point : shortSignatures.hash((0, utils_ts_1.ensureBytes)("point", point), htfOpts?.DST);
      }
      function normP2Hash(point, htfOpts) {
        return point instanceof G2.Point ? point : longSignatures.hash((0, utils_ts_1.ensureBytes)("point", point), htfOpts?.DST);
      }
      function getPublicKey(privateKey) {
        return longSignatures.getPublicKey(privateKey).toBytes(true);
      }
      function getPublicKeyForShortSignatures(privateKey) {
        return shortSignatures.getPublicKey(privateKey).toBytes(true);
      }
      function sign4(message, privateKey, htfOpts) {
        const Hm = normP2Hash(message, htfOpts);
        const S = longSignatures.sign(Hm, privateKey);
        return message instanceof G2.Point ? S : Signature.toBytes(S);
      }
      function signShortSignature(message, privateKey, htfOpts) {
        const Hm = normP1Hash(message, htfOpts);
        const S = shortSignatures.sign(Hm, privateKey);
        return message instanceof G1.Point ? S : ShortSignature.toBytes(S);
      }
      function verify4(signature, message, publicKey, htfOpts) {
        const Hm = normP2Hash(message, htfOpts);
        return longSignatures.verify(signature, Hm, publicKey);
      }
      function verifyShortSignature(signature, message, publicKey, htfOpts) {
        const Hm = normP1Hash(message, htfOpts);
        return shortSignatures.verify(signature, Hm, publicKey);
      }
      function aggregatePublicKeys(publicKeys) {
        const agg = longSignatures.aggregatePublicKeys(publicKeys);
        return publicKeys[0] instanceof G1.Point ? agg : agg.toBytes(true);
      }
      function aggregateSignatures(signatures) {
        const agg = longSignatures.aggregateSignatures(signatures);
        return signatures[0] instanceof G2.Point ? agg : Signature.toBytes(agg);
      }
      function aggregateShortSignatures(signatures) {
        const agg = shortSignatures.aggregateSignatures(signatures);
        return signatures[0] instanceof G1.Point ? agg : ShortSignature.toBytes(agg);
      }
      function verifyBatch(signature, messages, publicKeys, htfOpts) {
        const Hm = messages.map((m) => normP2Hash(m, htfOpts));
        return longSignatures.verifyBatch(signature, Hm, publicKeys);
      }
      G1.Point.BASE.precompute(4);
      return {
        longSignatures,
        shortSignatures,
        millerLoopBatch,
        pairing,
        pairingBatch,
        verifyBatch,
        fields: {
          Fr,
          Fp: Fp3,
          Fp2: Fp22,
          Fp6: Fp62,
          Fp12: Fp122
        },
        params: {
          ateLoopSize: CURVE.params.ateLoopSize,
          twistType: CURVE.params.twistType,
          // deprecated
          r: CURVE.params.r,
          G1b: CURVE.G1.b,
          G2b: CURVE.G2.b
        },
        utils,
        // deprecated
        getPublicKey,
        getPublicKeyForShortSignatures,
        sign: sign4,
        signShortSignature,
        verify: verify4,
        verifyShortSignature,
        aggregatePublicKeys,
        aggregateSignatures,
        aggregateShortSignatures,
        G1,
        G2,
        Signature,
        ShortSignature
      };
    }
  }
});

// node_modules/@noble/curves/abstract/tower.js
var require_tower = __commonJS({
  "node_modules/@noble/curves/abstract/tower.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.psiFrobenius = psiFrobenius2;
    exports.tower12 = tower122;
    var utils_ts_1 = require_utils2();
    var mod2 = require_modular();
    var _0n8 = BigInt(0);
    var _1n8 = BigInt(1);
    var _2n6 = BigInt(2);
    var _3n6 = BigInt(3);
    function calcFrobeniusCoefficients2(Fp3, nonResidue, modulus, degree, num = 1, divisor) {
      const _divisor = BigInt(divisor === void 0 ? degree : divisor);
      const towerModulus = modulus ** BigInt(degree);
      const res = [];
      for (let i = 0; i < num; i++) {
        const a = BigInt(i + 1);
        const powers = [];
        for (let j = 0, qPower = _1n8; j < degree; j++) {
          const power = (a * qPower - a) / _divisor % towerModulus;
          powers.push(Fp3.pow(nonResidue, power));
          qPower *= modulus;
        }
        res.push(powers);
      }
      return res;
    }
    function psiFrobenius2(Fp3, Fp22, base) {
      const PSI_X = Fp22.pow(base, (Fp3.ORDER - _1n8) / _3n6);
      const PSI_Y = Fp22.pow(base, (Fp3.ORDER - _1n8) / _2n6);
      function psi(x, y) {
        const x2 = Fp22.mul(Fp22.frobeniusMap(x, 1), PSI_X);
        const y2 = Fp22.mul(Fp22.frobeniusMap(y, 1), PSI_Y);
        return [x2, y2];
      }
      const PSI2_X = Fp22.pow(base, (Fp3.ORDER ** _2n6 - _1n8) / _3n6);
      const PSI2_Y = Fp22.pow(base, (Fp3.ORDER ** _2n6 - _1n8) / _2n6);
      if (!Fp22.eql(PSI2_Y, Fp22.neg(Fp22.ONE)))
        throw new Error("psiFrobenius: PSI2_Y!==-1");
      function psi2(x, y) {
        return [Fp22.mul(x, PSI2_X), Fp22.neg(y)];
      }
      const mapAffine = (fn) => (c, P) => {
        const affine = P.toAffine();
        const p = fn(affine.x, affine.y);
        return c.fromAffine({ x: p[0], y: p[1] });
      };
      const G2psi3 = mapAffine(psi);
      const G2psi22 = mapAffine(psi2);
      return { psi, psi2, G2psi: G2psi3, G2psi2: G2psi22, PSI_X, PSI_Y, PSI2_X, PSI2_Y };
    }
    var Fp2fromBigTuple2 = (Fp3, tuple) => {
      if (tuple.length !== 2)
        throw new Error("invalid tuple");
      const fps = tuple.map((n) => Fp3.create(n));
      return { c0: fps[0], c1: fps[1] };
    };
    var _Field22 = class {
      constructor(Fp3, opts = {}) {
        this.MASK = _1n8;
        const ORDER = Fp3.ORDER;
        const FP2_ORDER = ORDER * ORDER;
        this.Fp = Fp3;
        this.ORDER = FP2_ORDER;
        this.BITS = (0, utils_ts_1.bitLen)(FP2_ORDER);
        this.BYTES = Math.ceil((0, utils_ts_1.bitLen)(FP2_ORDER) / 8);
        this.isLE = Fp3.isLE;
        this.ZERO = { c0: Fp3.ZERO, c1: Fp3.ZERO };
        this.ONE = { c0: Fp3.ONE, c1: Fp3.ZERO };
        this.Fp_NONRESIDUE = Fp3.create(opts.NONRESIDUE || BigInt(-1));
        this.Fp_div2 = Fp3.div(Fp3.ONE, _2n6);
        this.NONRESIDUE = Fp2fromBigTuple2(Fp3, opts.FP2_NONRESIDUE);
        this.FROBENIUS_COEFFICIENTS = calcFrobeniusCoefficients2(Fp3, this.Fp_NONRESIDUE, Fp3.ORDER, 2)[0];
        this.mulByB = opts.Fp2mulByB;
        Object.seal(this);
      }
      fromBigTuple(tuple) {
        return Fp2fromBigTuple2(this.Fp, tuple);
      }
      create(num) {
        return num;
      }
      isValid({ c0, c1 }) {
        function isValidC(num, ORDER) {
          return typeof num === "bigint" && _0n8 <= num && num < ORDER;
        }
        return isValidC(c0, this.ORDER) && isValidC(c1, this.ORDER);
      }
      is0({ c0, c1 }) {
        return this.Fp.is0(c0) && this.Fp.is0(c1);
      }
      isValidNot0(num) {
        return !this.is0(num) && this.isValid(num);
      }
      eql({ c0, c1 }, { c0: r0, c1: r1 }) {
        return this.Fp.eql(c0, r0) && this.Fp.eql(c1, r1);
      }
      neg({ c0, c1 }) {
        return { c0: this.Fp.neg(c0), c1: this.Fp.neg(c1) };
      }
      pow(num, power) {
        return mod2.FpPow(this, num, power);
      }
      invertBatch(nums) {
        return mod2.FpInvertBatch(this, nums);
      }
      // Normalized
      add(f1, f2) {
        const { c0, c1 } = f1;
        const { c0: r0, c1: r1 } = f2;
        return {
          c0: this.Fp.add(c0, r0),
          c1: this.Fp.add(c1, r1)
        };
      }
      sub({ c0, c1 }, { c0: r0, c1: r1 }) {
        return {
          c0: this.Fp.sub(c0, r0),
          c1: this.Fp.sub(c1, r1)
        };
      }
      mul({ c0, c1 }, rhs) {
        const { Fp: Fp3 } = this;
        if (typeof rhs === "bigint")
          return { c0: Fp3.mul(c0, rhs), c1: Fp3.mul(c1, rhs) };
        const { c0: r0, c1: r1 } = rhs;
        let t1 = Fp3.mul(c0, r0);
        let t2 = Fp3.mul(c1, r1);
        const o0 = Fp3.sub(t1, t2);
        const o1 = Fp3.sub(Fp3.mul(Fp3.add(c0, c1), Fp3.add(r0, r1)), Fp3.add(t1, t2));
        return { c0: o0, c1: o1 };
      }
      sqr({ c0, c1 }) {
        const { Fp: Fp3 } = this;
        const a = Fp3.add(c0, c1);
        const b = Fp3.sub(c0, c1);
        const c = Fp3.add(c0, c0);
        return { c0: Fp3.mul(a, b), c1: Fp3.mul(c, c1) };
      }
      // NonNormalized stuff
      addN(a, b) {
        return this.add(a, b);
      }
      subN(a, b) {
        return this.sub(a, b);
      }
      mulN(a, b) {
        return this.mul(a, b);
      }
      sqrN(a) {
        return this.sqr(a);
      }
      // Why inversion for bigint inside Fp instead of Fp2? it is even used in that context?
      div(lhs, rhs) {
        const { Fp: Fp3 } = this;
        return this.mul(lhs, typeof rhs === "bigint" ? Fp3.inv(Fp3.create(rhs)) : this.inv(rhs));
      }
      inv({ c0: a, c1: b }) {
        const { Fp: Fp3 } = this;
        const factor = Fp3.inv(Fp3.create(a * a + b * b));
        return { c0: Fp3.mul(factor, Fp3.create(a)), c1: Fp3.mul(factor, Fp3.create(-b)) };
      }
      sqrt(num) {
        const { Fp: Fp3 } = this;
        const Fp22 = this;
        const { c0, c1 } = num;
        if (Fp3.is0(c1)) {
          if (mod2.FpLegendre(Fp3, c0) === 1)
            return Fp22.create({ c0: Fp3.sqrt(c0), c1: Fp3.ZERO });
          else
            return Fp22.create({ c0: Fp3.ZERO, c1: Fp3.sqrt(Fp3.div(c0, this.Fp_NONRESIDUE)) });
        }
        const a = Fp3.sqrt(Fp3.sub(Fp3.sqr(c0), Fp3.mul(Fp3.sqr(c1), this.Fp_NONRESIDUE)));
        let d = Fp3.mul(Fp3.add(a, c0), this.Fp_div2);
        const legendre = mod2.FpLegendre(Fp3, d);
        if (legendre === -1)
          d = Fp3.sub(d, a);
        const a0 = Fp3.sqrt(d);
        const candidateSqrt = Fp22.create({ c0: a0, c1: Fp3.div(Fp3.mul(c1, this.Fp_div2), a0) });
        if (!Fp22.eql(Fp22.sqr(candidateSqrt), num))
          throw new Error("Cannot find square root");
        const x1 = candidateSqrt;
        const x2 = Fp22.neg(x1);
        const { re: re1, im: im1 } = Fp22.reim(x1);
        const { re: re2, im: im2 } = Fp22.reim(x2);
        if (im1 > im2 || im1 === im2 && re1 > re2)
          return x1;
        return x2;
      }
      // Same as sgn0_m_eq_2 in RFC 9380
      isOdd(x) {
        const { re: x0, im: x1 } = this.reim(x);
        const sign_0 = x0 % _2n6;
        const zero_0 = x0 === _0n8;
        const sign_1 = x1 % _2n6;
        return BigInt(sign_0 || zero_0 && sign_1) == _1n8;
      }
      // Bytes util
      fromBytes(b) {
        const { Fp: Fp3 } = this;
        if (b.length !== this.BYTES)
          throw new Error("fromBytes invalid length=" + b.length);
        return { c0: Fp3.fromBytes(b.subarray(0, Fp3.BYTES)), c1: Fp3.fromBytes(b.subarray(Fp3.BYTES)) };
      }
      toBytes({ c0, c1 }) {
        return (0, utils_ts_1.concatBytes)(this.Fp.toBytes(c0), this.Fp.toBytes(c1));
      }
      cmov({ c0, c1 }, { c0: r0, c1: r1 }, c) {
        return {
          c0: this.Fp.cmov(c0, r0, c),
          c1: this.Fp.cmov(c1, r1, c)
        };
      }
      reim({ c0, c1 }) {
        return { re: c0, im: c1 };
      }
      Fp4Square(a, b) {
        const Fp22 = this;
        const a2 = Fp22.sqr(a);
        const b2 = Fp22.sqr(b);
        return {
          first: Fp22.add(Fp22.mulByNonresidue(b2), a2),
          // b² * Nonresidue + a²
          second: Fp22.sub(Fp22.sub(Fp22.sqr(Fp22.add(a, b)), a2), b2)
          // (a + b)² - a² - b²
        };
      }
      // multiply by u + 1
      mulByNonresidue({ c0, c1 }) {
        return this.mul({ c0, c1 }, this.NONRESIDUE);
      }
      frobeniusMap({ c0, c1 }, power) {
        return {
          c0,
          c1: this.Fp.mul(c1, this.FROBENIUS_COEFFICIENTS[power % 2])
        };
      }
    };
    var _Field62 = class {
      constructor(Fp22) {
        this.MASK = _1n8;
        this.Fp2 = Fp22;
        this.ORDER = Fp22.ORDER;
        this.BITS = 3 * Fp22.BITS;
        this.BYTES = 3 * Fp22.BYTES;
        this.isLE = Fp22.isLE;
        this.ZERO = { c0: Fp22.ZERO, c1: Fp22.ZERO, c2: Fp22.ZERO };
        this.ONE = { c0: Fp22.ONE, c1: Fp22.ZERO, c2: Fp22.ZERO };
        const { Fp: Fp3 } = Fp22;
        const frob = calcFrobeniusCoefficients2(Fp22, Fp22.NONRESIDUE, Fp3.ORDER, 6, 2, 3);
        this.FROBENIUS_COEFFICIENTS_1 = frob[0];
        this.FROBENIUS_COEFFICIENTS_2 = frob[1];
        Object.seal(this);
      }
      add({ c0, c1, c2 }, { c0: r0, c1: r1, c2: r2 }) {
        const { Fp2: Fp22 } = this;
        return {
          c0: Fp22.add(c0, r0),
          c1: Fp22.add(c1, r1),
          c2: Fp22.add(c2, r2)
        };
      }
      sub({ c0, c1, c2 }, { c0: r0, c1: r1, c2: r2 }) {
        const { Fp2: Fp22 } = this;
        return {
          c0: Fp22.sub(c0, r0),
          c1: Fp22.sub(c1, r1),
          c2: Fp22.sub(c2, r2)
        };
      }
      mul({ c0, c1, c2 }, rhs) {
        const { Fp2: Fp22 } = this;
        if (typeof rhs === "bigint") {
          return {
            c0: Fp22.mul(c0, rhs),
            c1: Fp22.mul(c1, rhs),
            c2: Fp22.mul(c2, rhs)
          };
        }
        const { c0: r0, c1: r1, c2: r2 } = rhs;
        const t0 = Fp22.mul(c0, r0);
        const t1 = Fp22.mul(c1, r1);
        const t2 = Fp22.mul(c2, r2);
        return {
          // t0 + (c1 + c2) * (r1 * r2) - (T1 + T2) * (u + 1)
          c0: Fp22.add(t0, Fp22.mulByNonresidue(Fp22.sub(Fp22.mul(Fp22.add(c1, c2), Fp22.add(r1, r2)), Fp22.add(t1, t2)))),
          // (c0 + c1) * (r0 + r1) - (T0 + T1) + T2 * (u + 1)
          c1: Fp22.add(Fp22.sub(Fp22.mul(Fp22.add(c0, c1), Fp22.add(r0, r1)), Fp22.add(t0, t1)), Fp22.mulByNonresidue(t2)),
          // T1 + (c0 + c2) * (r0 + r2) - T0 + T2
          c2: Fp22.sub(Fp22.add(t1, Fp22.mul(Fp22.add(c0, c2), Fp22.add(r0, r2))), Fp22.add(t0, t2))
        };
      }
      sqr({ c0, c1, c2 }) {
        const { Fp2: Fp22 } = this;
        let t0 = Fp22.sqr(c0);
        let t1 = Fp22.mul(Fp22.mul(c0, c1), _2n6);
        let t3 = Fp22.mul(Fp22.mul(c1, c2), _2n6);
        let t4 = Fp22.sqr(c2);
        return {
          c0: Fp22.add(Fp22.mulByNonresidue(t3), t0),
          // T3 * (u + 1) + T0
          c1: Fp22.add(Fp22.mulByNonresidue(t4), t1),
          // T4 * (u + 1) + T1
          // T1 + (c0 - c1 + c2)² + T3 - T0 - T4
          c2: Fp22.sub(Fp22.sub(Fp22.add(Fp22.add(t1, Fp22.sqr(Fp22.add(Fp22.sub(c0, c1), c2))), t3), t0), t4)
        };
      }
      addN(a, b) {
        return this.add(a, b);
      }
      subN(a, b) {
        return this.sub(a, b);
      }
      mulN(a, b) {
        return this.mul(a, b);
      }
      sqrN(a) {
        return this.sqr(a);
      }
      create(num) {
        return num;
      }
      isValid({ c0, c1, c2 }) {
        const { Fp2: Fp22 } = this;
        return Fp22.isValid(c0) && Fp22.isValid(c1) && Fp22.isValid(c2);
      }
      is0({ c0, c1, c2 }) {
        const { Fp2: Fp22 } = this;
        return Fp22.is0(c0) && Fp22.is0(c1) && Fp22.is0(c2);
      }
      isValidNot0(num) {
        return !this.is0(num) && this.isValid(num);
      }
      neg({ c0, c1, c2 }) {
        const { Fp2: Fp22 } = this;
        return { c0: Fp22.neg(c0), c1: Fp22.neg(c1), c2: Fp22.neg(c2) };
      }
      eql({ c0, c1, c2 }, { c0: r0, c1: r1, c2: r2 }) {
        const { Fp2: Fp22 } = this;
        return Fp22.eql(c0, r0) && Fp22.eql(c1, r1) && Fp22.eql(c2, r2);
      }
      sqrt(_) {
        return (0, utils_ts_1.notImplemented)();
      }
      // Do we need division by bigint at all? Should be done via order:
      div(lhs, rhs) {
        const { Fp2: Fp22 } = this;
        const { Fp: Fp3 } = Fp22;
        return this.mul(lhs, typeof rhs === "bigint" ? Fp3.inv(Fp3.create(rhs)) : this.inv(rhs));
      }
      pow(num, power) {
        return mod2.FpPow(this, num, power);
      }
      invertBatch(nums) {
        return mod2.FpInvertBatch(this, nums);
      }
      inv({ c0, c1, c2 }) {
        const { Fp2: Fp22 } = this;
        let t0 = Fp22.sub(Fp22.sqr(c0), Fp22.mulByNonresidue(Fp22.mul(c2, c1)));
        let t1 = Fp22.sub(Fp22.mulByNonresidue(Fp22.sqr(c2)), Fp22.mul(c0, c1));
        let t2 = Fp22.sub(Fp22.sqr(c1), Fp22.mul(c0, c2));
        let t4 = Fp22.inv(Fp22.add(Fp22.mulByNonresidue(Fp22.add(Fp22.mul(c2, t1), Fp22.mul(c1, t2))), Fp22.mul(c0, t0)));
        return { c0: Fp22.mul(t4, t0), c1: Fp22.mul(t4, t1), c2: Fp22.mul(t4, t2) };
      }
      // Bytes utils
      fromBytes(b) {
        const { Fp2: Fp22 } = this;
        if (b.length !== this.BYTES)
          throw new Error("fromBytes invalid length=" + b.length);
        const B2 = Fp22.BYTES;
        return {
          c0: Fp22.fromBytes(b.subarray(0, B2)),
          c1: Fp22.fromBytes(b.subarray(B2, B2 * 2)),
          c2: Fp22.fromBytes(b.subarray(2 * B2))
        };
      }
      toBytes({ c0, c1, c2 }) {
        const { Fp2: Fp22 } = this;
        return (0, utils_ts_1.concatBytes)(Fp22.toBytes(c0), Fp22.toBytes(c1), Fp22.toBytes(c2));
      }
      cmov({ c0, c1, c2 }, { c0: r0, c1: r1, c2: r2 }, c) {
        const { Fp2: Fp22 } = this;
        return {
          c0: Fp22.cmov(c0, r0, c),
          c1: Fp22.cmov(c1, r1, c),
          c2: Fp22.cmov(c2, r2, c)
        };
      }
      fromBigSix(t) {
        const { Fp2: Fp22 } = this;
        if (!Array.isArray(t) || t.length !== 6)
          throw new Error("invalid Fp6 usage");
        return {
          c0: Fp22.fromBigTuple(t.slice(0, 2)),
          c1: Fp22.fromBigTuple(t.slice(2, 4)),
          c2: Fp22.fromBigTuple(t.slice(4, 6))
        };
      }
      frobeniusMap({ c0, c1, c2 }, power) {
        const { Fp2: Fp22 } = this;
        return {
          c0: Fp22.frobeniusMap(c0, power),
          c1: Fp22.mul(Fp22.frobeniusMap(c1, power), this.FROBENIUS_COEFFICIENTS_1[power % 6]),
          c2: Fp22.mul(Fp22.frobeniusMap(c2, power), this.FROBENIUS_COEFFICIENTS_2[power % 6])
        };
      }
      mulByFp2({ c0, c1, c2 }, rhs) {
        const { Fp2: Fp22 } = this;
        return {
          c0: Fp22.mul(c0, rhs),
          c1: Fp22.mul(c1, rhs),
          c2: Fp22.mul(c2, rhs)
        };
      }
      mulByNonresidue({ c0, c1, c2 }) {
        const { Fp2: Fp22 } = this;
        return { c0: Fp22.mulByNonresidue(c2), c1: c0, c2: c1 };
      }
      // Sparse multiplication
      mul1({ c0, c1, c2 }, b1) {
        const { Fp2: Fp22 } = this;
        return {
          c0: Fp22.mulByNonresidue(Fp22.mul(c2, b1)),
          c1: Fp22.mul(c0, b1),
          c2: Fp22.mul(c1, b1)
        };
      }
      // Sparse multiplication
      mul01({ c0, c1, c2 }, b0, b1) {
        const { Fp2: Fp22 } = this;
        let t0 = Fp22.mul(c0, b0);
        let t1 = Fp22.mul(c1, b1);
        return {
          // ((c1 + c2) * b1 - T1) * (u + 1) + T0
          c0: Fp22.add(Fp22.mulByNonresidue(Fp22.sub(Fp22.mul(Fp22.add(c1, c2), b1), t1)), t0),
          // (b0 + b1) * (c0 + c1) - T0 - T1
          c1: Fp22.sub(Fp22.sub(Fp22.mul(Fp22.add(b0, b1), Fp22.add(c0, c1)), t0), t1),
          // (c0 + c2) * b0 - T0 + T1
          c2: Fp22.add(Fp22.sub(Fp22.mul(Fp22.add(c0, c2), b0), t0), t1)
        };
      }
    };
    var _Field122 = class {
      constructor(Fp62, opts) {
        this.MASK = _1n8;
        const { Fp2: Fp22 } = Fp62;
        const { Fp: Fp3 } = Fp22;
        this.Fp6 = Fp62;
        this.ORDER = Fp22.ORDER;
        this.BITS = 2 * Fp62.BITS;
        this.BYTES = 2 * Fp62.BYTES;
        this.isLE = Fp62.isLE;
        this.ZERO = { c0: Fp62.ZERO, c1: Fp62.ZERO };
        this.ONE = { c0: Fp62.ONE, c1: Fp62.ZERO };
        this.FROBENIUS_COEFFICIENTS = calcFrobeniusCoefficients2(Fp22, Fp22.NONRESIDUE, Fp3.ORDER, 12, 1, 6)[0];
        this.X_LEN = opts.X_LEN;
        this.finalExponentiate = opts.Fp12finalExponentiate;
      }
      create(num) {
        return num;
      }
      isValid({ c0, c1 }) {
        const { Fp6: Fp62 } = this;
        return Fp62.isValid(c0) && Fp62.isValid(c1);
      }
      is0({ c0, c1 }) {
        const { Fp6: Fp62 } = this;
        return Fp62.is0(c0) && Fp62.is0(c1);
      }
      isValidNot0(num) {
        return !this.is0(num) && this.isValid(num);
      }
      neg({ c0, c1 }) {
        const { Fp6: Fp62 } = this;
        return { c0: Fp62.neg(c0), c1: Fp62.neg(c1) };
      }
      eql({ c0, c1 }, { c0: r0, c1: r1 }) {
        const { Fp6: Fp62 } = this;
        return Fp62.eql(c0, r0) && Fp62.eql(c1, r1);
      }
      sqrt(_) {
        (0, utils_ts_1.notImplemented)();
      }
      inv({ c0, c1 }) {
        const { Fp6: Fp62 } = this;
        let t = Fp62.inv(Fp62.sub(Fp62.sqr(c0), Fp62.mulByNonresidue(Fp62.sqr(c1))));
        return { c0: Fp62.mul(c0, t), c1: Fp62.neg(Fp62.mul(c1, t)) };
      }
      div(lhs, rhs) {
        const { Fp6: Fp62 } = this;
        const { Fp2: Fp22 } = Fp62;
        const { Fp: Fp3 } = Fp22;
        return this.mul(lhs, typeof rhs === "bigint" ? Fp3.inv(Fp3.create(rhs)) : this.inv(rhs));
      }
      pow(num, power) {
        return mod2.FpPow(this, num, power);
      }
      invertBatch(nums) {
        return mod2.FpInvertBatch(this, nums);
      }
      // Normalized
      add({ c0, c1 }, { c0: r0, c1: r1 }) {
        const { Fp6: Fp62 } = this;
        return {
          c0: Fp62.add(c0, r0),
          c1: Fp62.add(c1, r1)
        };
      }
      sub({ c0, c1 }, { c0: r0, c1: r1 }) {
        const { Fp6: Fp62 } = this;
        return {
          c0: Fp62.sub(c0, r0),
          c1: Fp62.sub(c1, r1)
        };
      }
      mul({ c0, c1 }, rhs) {
        const { Fp6: Fp62 } = this;
        if (typeof rhs === "bigint")
          return { c0: Fp62.mul(c0, rhs), c1: Fp62.mul(c1, rhs) };
        let { c0: r0, c1: r1 } = rhs;
        let t1 = Fp62.mul(c0, r0);
        let t2 = Fp62.mul(c1, r1);
        return {
          c0: Fp62.add(t1, Fp62.mulByNonresidue(t2)),
          // T1 + T2 * v
          // (c0 + c1) * (r0 + r1) - (T1 + T2)
          c1: Fp62.sub(Fp62.mul(Fp62.add(c0, c1), Fp62.add(r0, r1)), Fp62.add(t1, t2))
        };
      }
      sqr({ c0, c1 }) {
        const { Fp6: Fp62 } = this;
        let ab = Fp62.mul(c0, c1);
        return {
          // (c1 * v + c0) * (c0 + c1) - AB - AB * v
          c0: Fp62.sub(Fp62.sub(Fp62.mul(Fp62.add(Fp62.mulByNonresidue(c1), c0), Fp62.add(c0, c1)), ab), Fp62.mulByNonresidue(ab)),
          c1: Fp62.add(ab, ab)
        };
      }
      // NonNormalized stuff
      addN(a, b) {
        return this.add(a, b);
      }
      subN(a, b) {
        return this.sub(a, b);
      }
      mulN(a, b) {
        return this.mul(a, b);
      }
      sqrN(a) {
        return this.sqr(a);
      }
      // Bytes utils
      fromBytes(b) {
        const { Fp6: Fp62 } = this;
        if (b.length !== this.BYTES)
          throw new Error("fromBytes invalid length=" + b.length);
        return {
          c0: Fp62.fromBytes(b.subarray(0, Fp62.BYTES)),
          c1: Fp62.fromBytes(b.subarray(Fp62.BYTES))
        };
      }
      toBytes({ c0, c1 }) {
        const { Fp6: Fp62 } = this;
        return (0, utils_ts_1.concatBytes)(Fp62.toBytes(c0), Fp62.toBytes(c1));
      }
      cmov({ c0, c1 }, { c0: r0, c1: r1 }, c) {
        const { Fp6: Fp62 } = this;
        return {
          c0: Fp62.cmov(c0, r0, c),
          c1: Fp62.cmov(c1, r1, c)
        };
      }
      // Utils
      // toString() {
      //   return '' + 'Fp12(' + this.c0 + this.c1 + '* w');
      // },
      // fromTuple(c: [Fp6, Fp6]) {
      //   return new Fp12(...c);
      // }
      fromBigTwelve(t) {
        const { Fp6: Fp62 } = this;
        return {
          c0: Fp62.fromBigSix(t.slice(0, 6)),
          c1: Fp62.fromBigSix(t.slice(6, 12))
        };
      }
      // Raises to q**i -th power
      frobeniusMap(lhs, power) {
        const { Fp6: Fp62 } = this;
        const { Fp2: Fp22 } = Fp62;
        const { c0, c1, c2 } = Fp62.frobeniusMap(lhs.c1, power);
        const coeff = this.FROBENIUS_COEFFICIENTS[power % 12];
        return {
          c0: Fp62.frobeniusMap(lhs.c0, power),
          c1: Fp62.create({
            c0: Fp22.mul(c0, coeff),
            c1: Fp22.mul(c1, coeff),
            c2: Fp22.mul(c2, coeff)
          })
        };
      }
      mulByFp2({ c0, c1 }, rhs) {
        const { Fp6: Fp62 } = this;
        return {
          c0: Fp62.mulByFp2(c0, rhs),
          c1: Fp62.mulByFp2(c1, rhs)
        };
      }
      conjugate({ c0, c1 }) {
        return { c0, c1: this.Fp6.neg(c1) };
      }
      // Sparse multiplication
      mul014({ c0, c1 }, o0, o1, o4) {
        const { Fp6: Fp62 } = this;
        const { Fp2: Fp22 } = Fp62;
        let t0 = Fp62.mul01(c0, o0, o1);
        let t1 = Fp62.mul1(c1, o4);
        return {
          c0: Fp62.add(Fp62.mulByNonresidue(t1), t0),
          // T1 * v + T0
          // (c1 + c0) * [o0, o1+o4] - T0 - T1
          c1: Fp62.sub(Fp62.sub(Fp62.mul01(Fp62.add(c1, c0), o0, Fp22.add(o1, o4)), t0), t1)
        };
      }
      mul034({ c0, c1 }, o0, o3, o4) {
        const { Fp6: Fp62 } = this;
        const { Fp2: Fp22 } = Fp62;
        const a = Fp62.create({
          c0: Fp22.mul(c0.c0, o0),
          c1: Fp22.mul(c0.c1, o0),
          c2: Fp22.mul(c0.c2, o0)
        });
        const b = Fp62.mul01(c1, o3, o4);
        const e = Fp62.mul01(Fp62.add(c0, c1), Fp22.add(o0, o3), o4);
        return {
          c0: Fp62.add(Fp62.mulByNonresidue(b), a),
          c1: Fp62.sub(e, Fp62.add(a, b))
        };
      }
      // A cyclotomic group is a subgroup of Fp^n defined by
      //   GΦₙ(p) = {α ∈ Fpⁿ : α^Φₙ(p) = 1}
      // The result of any pairing is in a cyclotomic subgroup
      // https://eprint.iacr.org/2009/565.pdf
      // https://eprint.iacr.org/2010/354.pdf
      _cyclotomicSquare({ c0, c1 }) {
        const { Fp6: Fp62 } = this;
        const { Fp2: Fp22 } = Fp62;
        const { c0: c0c0, c1: c0c1, c2: c0c2 } = c0;
        const { c0: c1c0, c1: c1c1, c2: c1c2 } = c1;
        const { first: t3, second: t4 } = Fp22.Fp4Square(c0c0, c1c1);
        const { first: t5, second: t6 } = Fp22.Fp4Square(c1c0, c0c2);
        const { first: t7, second: t8 } = Fp22.Fp4Square(c0c1, c1c2);
        const t9 = Fp22.mulByNonresidue(t8);
        return {
          c0: Fp62.create({
            c0: Fp22.add(Fp22.mul(Fp22.sub(t3, c0c0), _2n6), t3),
            // 2 * (T3 - c0c0)  + T3
            c1: Fp22.add(Fp22.mul(Fp22.sub(t5, c0c1), _2n6), t5),
            // 2 * (T5 - c0c1)  + T5
            c2: Fp22.add(Fp22.mul(Fp22.sub(t7, c0c2), _2n6), t7)
          }),
          // 2 * (T7 - c0c2)  + T7
          c1: Fp62.create({
            c0: Fp22.add(Fp22.mul(Fp22.add(t9, c1c0), _2n6), t9),
            // 2 * (T9 + c1c0) + T9
            c1: Fp22.add(Fp22.mul(Fp22.add(t4, c1c1), _2n6), t4),
            // 2 * (T4 + c1c1) + T4
            c2: Fp22.add(Fp22.mul(Fp22.add(t6, c1c2), _2n6), t6)
          })
        };
      }
      // https://eprint.iacr.org/2009/565.pdf
      _cyclotomicExp(num, n) {
        let z = this.ONE;
        for (let i = this.X_LEN - 1; i >= 0; i--) {
          z = this._cyclotomicSquare(z);
          if ((0, utils_ts_1.bitGet)(n, i))
            z = this.mul(z, num);
        }
        return z;
      }
    };
    function tower122(opts) {
      const Fp3 = mod2.Field(opts.ORDER);
      const Fp22 = new _Field22(Fp3, opts);
      const Fp62 = new _Field62(Fp22);
      const Fp122 = new _Field122(Fp62, opts);
      return { Fp: Fp3, Fp2: Fp22, Fp6: Fp62, Fp12: Fp122 };
    }
  }
});

// node_modules/@noble/curves/bls12-381.js
var require_bls12_381 = __commonJS({
  "node_modules/@noble/curves/bls12-381.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.bls12_381 = exports.bls12_381_Fr = void 0;
    var sha2_js_1 = require_sha2();
    var bls_ts_1 = require_bls();
    var modular_ts_1 = require_modular();
    var utils_ts_1 = require_utils2();
    var hash_to_curve_ts_1 = require_hash_to_curve();
    var tower_ts_1 = require_tower();
    var weierstrass_ts_1 = require_weierstrass();
    var _0n8 = BigInt(0);
    var _1n8 = BigInt(1);
    var _2n6 = BigInt(2);
    var _3n6 = BigInt(3);
    var _4n4 = BigInt(4);
    var BLS_X2 = BigInt("0xd201000000010000");
    var BLS_X_LEN2 = (0, utils_ts_1.bitLen)(BLS_X2);
    var bls12_381_CURVE_G12 = {
      p: BigInt("0x1a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffaaab"),
      n: BigInt("0x73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001"),
      h: BigInt("0x396c8c005555e1568c00aaab0000aaab"),
      a: _0n8,
      b: _4n4,
      Gx: BigInt("0x17f1d3a73197d7942695638c4fa9ac0fc3688c4f9774b905a14e3a3f171bac586c55e83ff97a1aeffb3af00adb22c6bb"),
      Gy: BigInt("0x08b3f481e3aaa0f1a09e30ed741d8ae4fcf5e095d5d00af600db18cb2c04b3edd03cc744a2888ae40caa232946c5e7e1")
    };
    exports.bls12_381_Fr = (0, modular_ts_1.Field)(bls12_381_CURVE_G12.n, {
      modFromBytes: true,
      isLE: true
    });
    var { Fp: Fp3, Fp2: Fp22, Fp6: Fp62, Fp12: Fp122 } = (0, tower_ts_1.tower12)({
      ORDER: bls12_381_CURVE_G12.p,
      X_LEN: BLS_X_LEN2,
      // Finite extension field over irreducible polynominal.
      // Fp(u) / (u² - β) where β = -1
      FP2_NONRESIDUE: [_1n8, _1n8],
      Fp2mulByB: ({ c0, c1 }) => {
        const t0 = Fp3.mul(c0, _4n4);
        const t1 = Fp3.mul(c1, _4n4);
        return { c0: Fp3.sub(t0, t1), c1: Fp3.add(t0, t1) };
      },
      Fp12finalExponentiate: (num) => {
        const x = BLS_X2;
        const t0 = Fp122.div(Fp122.frobeniusMap(num, 6), num);
        const t1 = Fp122.mul(Fp122.frobeniusMap(t0, 2), t0);
        const t2 = Fp122.conjugate(Fp122._cyclotomicExp(t1, x));
        const t3 = Fp122.mul(Fp122.conjugate(Fp122._cyclotomicSquare(t1)), t2);
        const t4 = Fp122.conjugate(Fp122._cyclotomicExp(t3, x));
        const t5 = Fp122.conjugate(Fp122._cyclotomicExp(t4, x));
        const t6 = Fp122.mul(Fp122.conjugate(Fp122._cyclotomicExp(t5, x)), Fp122._cyclotomicSquare(t2));
        const t7 = Fp122.conjugate(Fp122._cyclotomicExp(t6, x));
        const t2_t5_pow_q2 = Fp122.frobeniusMap(Fp122.mul(t2, t5), 2);
        const t4_t1_pow_q3 = Fp122.frobeniusMap(Fp122.mul(t4, t1), 3);
        const t6_t1c_pow_q1 = Fp122.frobeniusMap(Fp122.mul(t6, Fp122.conjugate(t1)), 1);
        const t7_t3c_t1 = Fp122.mul(Fp122.mul(t7, Fp122.conjugate(t3)), t1);
        return Fp122.mul(Fp122.mul(Fp122.mul(t2_t5_pow_q2, t4_t1_pow_q3), t6_t1c_pow_q1), t7_t3c_t1);
      }
    });
    var { G2psi: G2psi3, G2psi2: G2psi22 } = (0, tower_ts_1.psiFrobenius)(Fp3, Fp22, Fp22.div(Fp22.ONE, Fp22.NONRESIDUE));
    var htfDefaults2 = Object.freeze({
      DST: "BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_NUL_",
      encodeDST: "BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_NUL_",
      p: Fp3.ORDER,
      m: 2,
      k: 128,
      expand: "xmd",
      hash: sha2_js_1.sha256
    });
    var bls12_381_CURVE_G22 = {
      p: Fp22.ORDER,
      n: bls12_381_CURVE_G12.n,
      h: BigInt("0x5d543a95414e7f1091d50792876a202cd91de4547085abaa68a205b2e5a7ddfa628f1cb4d9e82ef21537e293a6691ae1616ec6e786f0c70cf1c38e31c7238e5"),
      a: Fp22.ZERO,
      b: Fp22.fromBigTuple([_4n4, _4n4]),
      Gx: Fp22.fromBigTuple([
        BigInt("0x024aa2b2f08f0a91260805272dc51051c6e47ad4fa403b02b4510b647ae3d1770bac0326a805bbefd48056c8c121bdb8"),
        BigInt("0x13e02b6052719f607dacd3a088274f65596bd0d09920b61ab5da61bbdc7f5049334cf11213945d57e5ac7d055d042b7e")
      ]),
      Gy: Fp22.fromBigTuple([
        BigInt("0x0ce5d527727d6e118cc9cdc6da2e351aadfd9baa8cbdd3a76d429a695160d12c923ac9cc3baca289e193548608b82801"),
        BigInt("0x0606c4a02ea734cc32acd2b02bc28b99cb3e287e85a763af267492ab572e99ab3f370d275cec1da1aaa9075ff05f79be")
      ])
    };
    var COMPZERO2 = setMask2(Fp3.toBytes(_0n8), { infinity: true, compressed: true });
    function parseMask2(bytes) {
      bytes = bytes.slice();
      const mask = bytes[0] & 224;
      const compressed = !!(mask >> 7 & 1);
      const infinity = !!(mask >> 6 & 1);
      const sort = !!(mask >> 5 & 1);
      bytes[0] &= 31;
      return { compressed, infinity, sort, value: bytes };
    }
    function setMask2(bytes, mask) {
      if (bytes[0] & 224)
        throw new Error("setMask: non-empty mask");
      if (mask.compressed)
        bytes[0] |= 128;
      if (mask.infinity)
        bytes[0] |= 64;
      if (mask.sort)
        bytes[0] |= 32;
      return bytes;
    }
    function pointG1ToBytes2(_c, point, isComp) {
      const { BYTES: L, ORDER: P } = Fp3;
      const is0 = point.is0();
      const { x, y } = point.toAffine();
      if (isComp) {
        if (is0)
          return COMPZERO2.slice();
        const sort = Boolean(y * _2n6 / P);
        return setMask2((0, utils_ts_1.numberToBytesBE)(x, L), { compressed: true, sort });
      } else {
        if (is0) {
          return (0, utils_ts_1.concatBytes)(Uint8Array.of(64), new Uint8Array(2 * L - 1));
        } else {
          return (0, utils_ts_1.concatBytes)((0, utils_ts_1.numberToBytesBE)(x, L), (0, utils_ts_1.numberToBytesBE)(y, L));
        }
      }
    }
    function signatureG1ToBytes2(point) {
      point.assertValidity();
      const { BYTES: L, ORDER: P } = Fp3;
      const { x, y } = point.toAffine();
      if (point.is0())
        return COMPZERO2.slice();
      const sort = Boolean(y * _2n6 / P);
      return setMask2((0, utils_ts_1.numberToBytesBE)(x, L), { compressed: true, sort });
    }
    function pointG1FromBytes2(bytes) {
      const { compressed, infinity, sort, value } = parseMask2(bytes);
      const { BYTES: L, ORDER: P } = Fp3;
      if (value.length === 48 && compressed) {
        const compressedValue = (0, utils_ts_1.bytesToNumberBE)(value);
        const x = Fp3.create(compressedValue & (0, utils_ts_1.bitMask)(Fp3.BITS));
        if (infinity) {
          if (x !== _0n8)
            throw new Error("invalid G1 point: non-empty, at infinity, with compression");
          return { x: _0n8, y: _0n8 };
        }
        const right = Fp3.add(Fp3.pow(x, _3n6), Fp3.create(bls12_381_CURVE_G12.b));
        let y = Fp3.sqrt(right);
        if (!y)
          throw new Error("invalid G1 point: compressed point");
        if (y * _2n6 / P !== BigInt(sort))
          y = Fp3.neg(y);
        return { x: Fp3.create(x), y: Fp3.create(y) };
      } else if (value.length === 96 && !compressed) {
        const x = (0, utils_ts_1.bytesToNumberBE)(value.subarray(0, L));
        const y = (0, utils_ts_1.bytesToNumberBE)(value.subarray(L));
        if (infinity) {
          if (x !== _0n8 || y !== _0n8)
            throw new Error("G1: non-empty point at infinity");
          return exports.bls12_381.G1.Point.ZERO.toAffine();
        }
        return { x: Fp3.create(x), y: Fp3.create(y) };
      } else {
        throw new Error("invalid G1 point: expected 48/96 bytes");
      }
    }
    function signatureG1FromBytes2(hex) {
      const { infinity, sort, value } = parseMask2((0, utils_ts_1.ensureBytes)("signatureHex", hex, 48));
      const P = Fp3.ORDER;
      const Point = exports.bls12_381.G1.Point;
      const compressedValue = (0, utils_ts_1.bytesToNumberBE)(value);
      if (infinity)
        return Point.ZERO;
      const x = Fp3.create(compressedValue & (0, utils_ts_1.bitMask)(Fp3.BITS));
      const right = Fp3.add(Fp3.pow(x, _3n6), Fp3.create(bls12_381_CURVE_G12.b));
      let y = Fp3.sqrt(right);
      if (!y)
        throw new Error("invalid G1 point: compressed");
      const aflag = BigInt(sort);
      if (y * _2n6 / P !== aflag)
        y = Fp3.neg(y);
      const point = Point.fromAffine({ x, y });
      point.assertValidity();
      return point;
    }
    function pointG2ToBytes2(_c, point, isComp) {
      const { BYTES: L, ORDER: P } = Fp3;
      const is0 = point.is0();
      const { x, y } = point.toAffine();
      if (isComp) {
        if (is0)
          return (0, utils_ts_1.concatBytes)(COMPZERO2, (0, utils_ts_1.numberToBytesBE)(_0n8, L));
        const flag = Boolean(y.c1 === _0n8 ? y.c0 * _2n6 / P : y.c1 * _2n6 / P);
        return (0, utils_ts_1.concatBytes)(setMask2((0, utils_ts_1.numberToBytesBE)(x.c1, L), { compressed: true, sort: flag }), (0, utils_ts_1.numberToBytesBE)(x.c0, L));
      } else {
        if (is0)
          return (0, utils_ts_1.concatBytes)(Uint8Array.of(64), new Uint8Array(4 * L - 1));
        const { re: x0, im: x1 } = Fp22.reim(x);
        const { re: y0, im: y1 } = Fp22.reim(y);
        return (0, utils_ts_1.concatBytes)((0, utils_ts_1.numberToBytesBE)(x1, L), (0, utils_ts_1.numberToBytesBE)(x0, L), (0, utils_ts_1.numberToBytesBE)(y1, L), (0, utils_ts_1.numberToBytesBE)(y0, L));
      }
    }
    function signatureG2ToBytes2(point) {
      point.assertValidity();
      const { BYTES: L } = Fp3;
      if (point.is0())
        return (0, utils_ts_1.concatBytes)(COMPZERO2, (0, utils_ts_1.numberToBytesBE)(_0n8, L));
      const { x, y } = point.toAffine();
      const { re: x0, im: x1 } = Fp22.reim(x);
      const { re: y0, im: y1 } = Fp22.reim(y);
      const tmp = y1 > _0n8 ? y1 * _2n6 : y0 * _2n6;
      const sort = Boolean(tmp / Fp3.ORDER & _1n8);
      const z2 = x0;
      return (0, utils_ts_1.concatBytes)(setMask2((0, utils_ts_1.numberToBytesBE)(x1, L), { sort, compressed: true }), (0, utils_ts_1.numberToBytesBE)(z2, L));
    }
    function pointG2FromBytes2(bytes) {
      const { BYTES: L, ORDER: P } = Fp3;
      const { compressed, infinity, sort, value } = parseMask2(bytes);
      if (!compressed && !infinity && sort || // 00100000
      !compressed && infinity && sort || // 01100000
      sort && infinity && compressed) {
        throw new Error("invalid encoding flag: " + (bytes[0] & 224));
      }
      const slc = (b, from, to) => (0, utils_ts_1.bytesToNumberBE)(b.slice(from, to));
      if (value.length === 96 && compressed) {
        if (infinity) {
          if (value.reduce((p, c) => p !== 0 ? c + 1 : c, 0) > 0) {
            throw new Error("invalid G2 point: compressed");
          }
          return { x: Fp22.ZERO, y: Fp22.ZERO };
        }
        const x_1 = slc(value, 0, L);
        const x_0 = slc(value, L, 2 * L);
        const x = Fp22.create({ c0: Fp3.create(x_0), c1: Fp3.create(x_1) });
        const right = Fp22.add(Fp22.pow(x, _3n6), bls12_381_CURVE_G22.b);
        let y = Fp22.sqrt(right);
        const Y_bit = y.c1 === _0n8 ? y.c0 * _2n6 / P : y.c1 * _2n6 / P ? _1n8 : _0n8;
        y = sort && Y_bit > 0 ? y : Fp22.neg(y);
        return { x, y };
      } else if (value.length === 192 && !compressed) {
        if (infinity) {
          if (value.reduce((p, c) => p !== 0 ? c + 1 : c, 0) > 0) {
            throw new Error("invalid G2 point: uncompressed");
          }
          return { x: Fp22.ZERO, y: Fp22.ZERO };
        }
        const x1 = slc(value, 0 * L, 1 * L);
        const x0 = slc(value, 1 * L, 2 * L);
        const y1 = slc(value, 2 * L, 3 * L);
        const y0 = slc(value, 3 * L, 4 * L);
        return { x: Fp22.fromBigTuple([x0, x1]), y: Fp22.fromBigTuple([y0, y1]) };
      } else {
        throw new Error("invalid G2 point: expected 96/192 bytes");
      }
    }
    function signatureG2FromBytes2(hex) {
      const { ORDER: P } = Fp3;
      const { infinity, sort, value } = parseMask2((0, utils_ts_1.ensureBytes)("signatureHex", hex));
      const Point = exports.bls12_381.G2.Point;
      const half = value.length / 2;
      if (half !== 48 && half !== 96)
        throw new Error("invalid compressed signature length, expected 96/192 bytes");
      const z1 = (0, utils_ts_1.bytesToNumberBE)(value.slice(0, half));
      const z2 = (0, utils_ts_1.bytesToNumberBE)(value.slice(half));
      if (infinity)
        return Point.ZERO;
      const x1 = Fp3.create(z1 & (0, utils_ts_1.bitMask)(Fp3.BITS));
      const x2 = Fp3.create(z2);
      const x = Fp22.create({ c0: x2, c1: x1 });
      const y2 = Fp22.add(Fp22.pow(x, _3n6), bls12_381_CURVE_G22.b);
      let y = Fp22.sqrt(y2);
      if (!y)
        throw new Error("Failed to find a square root");
      const { re: y0, im: y1 } = Fp22.reim(y);
      const aflag1 = BigInt(sort);
      const isGreater = y1 > _0n8 && y1 * _2n6 / P !== aflag1;
      const is0 = y1 === _0n8 && y0 * _2n6 / P !== aflag1;
      if (isGreater || is0)
        y = Fp22.neg(y);
      const point = Point.fromAffine({ x, y });
      point.assertValidity();
      return point;
    }
    exports.bls12_381 = (0, bls_ts_1.bls)({
      // Fields
      fields: {
        Fp: Fp3,
        Fp2: Fp22,
        Fp6: Fp62,
        Fp12: Fp122,
        Fr: exports.bls12_381_Fr
      },
      // G1: y² = x³ + 4
      G1: {
        ...bls12_381_CURVE_G12,
        Fp: Fp3,
        htfDefaults: { ...htfDefaults2, m: 1, DST: "BLS_SIG_BLS12381G1_XMD:SHA-256_SSWU_RO_NUL_" },
        wrapPrivateKey: true,
        allowInfinityPoint: true,
        // Checks is the point resides in prime-order subgroup.
        // point.isTorsionFree() should return true for valid points
        // It returns false for shitty points.
        // https://eprint.iacr.org/2021/1130.pdf
        isTorsionFree: (c, point) => {
          const beta = BigInt("0x5f19672fdf76ce51ba69c6076a0f77eaddb3a93be6f89688de17d813620a00022e01fffffffefffe");
          const phi = new c(Fp3.mul(point.X, beta), point.Y, point.Z);
          const xP = point.multiplyUnsafe(BLS_X2).negate();
          const u2P = xP.multiplyUnsafe(BLS_X2);
          return u2P.equals(phi);
        },
        // Clear cofactor of G1
        // https://eprint.iacr.org/2019/403
        clearCofactor: (_c, point) => {
          return point.multiplyUnsafe(BLS_X2).add(point);
        },
        mapToCurve: mapToG12,
        fromBytes: pointG1FromBytes2,
        toBytes: pointG1ToBytes2,
        ShortSignature: {
          fromBytes(bytes) {
            (0, utils_ts_1.abytes)(bytes);
            return signatureG1FromBytes2(bytes);
          },
          fromHex(hex) {
            return signatureG1FromBytes2(hex);
          },
          toBytes(point) {
            return signatureG1ToBytes2(point);
          },
          toRawBytes(point) {
            return signatureG1ToBytes2(point);
          },
          toHex(point) {
            return (0, utils_ts_1.bytesToHex)(signatureG1ToBytes2(point));
          }
        }
      },
      G2: {
        ...bls12_381_CURVE_G22,
        Fp: Fp22,
        // https://datatracker.ietf.org/doc/html/rfc9380#name-clearing-the-cofactor
        // https://datatracker.ietf.org/doc/html/rfc9380#name-cofactor-clearing-for-bls12
        hEff: BigInt("0xbc69f08f2ee75b3584c6a0ea91b352888e2a8e9145ad7689986ff031508ffe1329c2f178731db956d82bf015d1212b02ec0ec69d7477c1ae954cbc06689f6a359894c0adebbf6b4e8020005aaa95551"),
        htfDefaults: { ...htfDefaults2 },
        wrapPrivateKey: true,
        allowInfinityPoint: true,
        mapToCurve: mapToG22,
        // Checks is the point resides in prime-order subgroup.
        // point.isTorsionFree() should return true for valid points
        // It returns false for shitty points.
        // https://eprint.iacr.org/2021/1130.pdf
        // Older version: https://eprint.iacr.org/2019/814.pdf
        isTorsionFree: (c, P) => {
          return P.multiplyUnsafe(BLS_X2).negate().equals(G2psi3(c, P));
        },
        // Maps the point into the prime-order subgroup G2.
        // clear_cofactor_bls12381_g2 from RFC 9380.
        // https://eprint.iacr.org/2017/419.pdf
        // prettier-ignore
        clearCofactor: (c, P) => {
          const x = BLS_X2;
          let t1 = P.multiplyUnsafe(x).negate();
          let t2 = G2psi3(c, P);
          let t3 = P.double();
          t3 = G2psi22(c, t3);
          t3 = t3.subtract(t2);
          t2 = t1.add(t2);
          t2 = t2.multiplyUnsafe(x).negate();
          t3 = t3.add(t2);
          t3 = t3.subtract(t1);
          const Q = t3.subtract(P);
          return Q;
        },
        fromBytes: pointG2FromBytes2,
        toBytes: pointG2ToBytes2,
        Signature: {
          fromBytes(bytes) {
            (0, utils_ts_1.abytes)(bytes);
            return signatureG2FromBytes2(bytes);
          },
          fromHex(hex) {
            return signatureG2FromBytes2(hex);
          },
          toBytes(point) {
            return signatureG2ToBytes2(point);
          },
          toRawBytes(point) {
            return signatureG2ToBytes2(point);
          },
          toHex(point) {
            return (0, utils_ts_1.bytesToHex)(signatureG2ToBytes2(point));
          }
        }
      },
      params: {
        ateLoopSize: BLS_X2,
        // The BLS parameter x for BLS12-381
        r: bls12_381_CURVE_G12.n,
        // order; z⁴ − z² + 1; CURVE.n from other curves
        xNegative: true,
        twistType: "multiplicative"
      },
      htfDefaults: htfDefaults2,
      hash: sha2_js_1.sha256
    });
    var isogenyMapG22 = (0, hash_to_curve_ts_1.isogenyMap)(Fp22, [
      // xNum
      [
        [
          "0x5c759507e8e333ebb5b7a9a47d7ed8532c52d39fd3a042a88b58423c50ae15d5c2638e343d9c71c6238aaaaaaaa97d6",
          "0x5c759507e8e333ebb5b7a9a47d7ed8532c52d39fd3a042a88b58423c50ae15d5c2638e343d9c71c6238aaaaaaaa97d6"
        ],
        [
          "0x0",
          "0x11560bf17baa99bc32126fced787c88f984f87adf7ae0c7f9a208c6b4f20a4181472aaa9cb8d555526a9ffffffffc71a"
        ],
        [
          "0x11560bf17baa99bc32126fced787c88f984f87adf7ae0c7f9a208c6b4f20a4181472aaa9cb8d555526a9ffffffffc71e",
          "0x8ab05f8bdd54cde190937e76bc3e447cc27c3d6fbd7063fcd104635a790520c0a395554e5c6aaaa9354ffffffffe38d"
        ],
        [
          "0x171d6541fa38ccfaed6dea691f5fb614cb14b4e7f4e810aa22d6108f142b85757098e38d0f671c7188e2aaaaaaaa5ed1",
          "0x0"
        ]
      ],
      // xDen
      [
        [
          "0x0",
          "0x1a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffaa63"
        ],
        [
          "0xc",
          "0x1a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffaa9f"
        ],
        ["0x1", "0x0"]
        // LAST 1
      ],
      // yNum
      [
        [
          "0x1530477c7ab4113b59a4c18b076d11930f7da5d4a07f649bf54439d87d27e500fc8c25ebf8c92f6812cfc71c71c6d706",
          "0x1530477c7ab4113b59a4c18b076d11930f7da5d4a07f649bf54439d87d27e500fc8c25ebf8c92f6812cfc71c71c6d706"
        ],
        [
          "0x0",
          "0x5c759507e8e333ebb5b7a9a47d7ed8532c52d39fd3a042a88b58423c50ae15d5c2638e343d9c71c6238aaaaaaaa97be"
        ],
        [
          "0x11560bf17baa99bc32126fced787c88f984f87adf7ae0c7f9a208c6b4f20a4181472aaa9cb8d555526a9ffffffffc71c",
          "0x8ab05f8bdd54cde190937e76bc3e447cc27c3d6fbd7063fcd104635a790520c0a395554e5c6aaaa9354ffffffffe38f"
        ],
        [
          "0x124c9ad43b6cf79bfbf7043de3811ad0761b0f37a1e26286b0e977c69aa274524e79097a56dc4bd9e1b371c71c718b10",
          "0x0"
        ]
      ],
      // yDen
      [
        [
          "0x1a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffa8fb",
          "0x1a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffa8fb"
        ],
        [
          "0x0",
          "0x1a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffa9d3"
        ],
        [
          "0x12",
          "0x1a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffaa99"
        ],
        ["0x1", "0x0"]
        // LAST 1
      ]
    ].map((i) => i.map((pair) => Fp22.fromBigTuple(pair.map(BigInt)))));
    var isogenyMapG12 = (0, hash_to_curve_ts_1.isogenyMap)(Fp3, [
      // xNum
      [
        "0x11a05f2b1e833340b809101dd99815856b303e88a2d7005ff2627b56cdb4e2c85610c2d5f2e62d6eaeac1662734649b7",
        "0x17294ed3e943ab2f0588bab22147a81c7c17e75b2f6a8417f565e33c70d1e86b4838f2a6f318c356e834eef1b3cb83bb",
        "0xd54005db97678ec1d1048c5d10a9a1bce032473295983e56878e501ec68e25c958c3e3d2a09729fe0179f9dac9edcb0",
        "0x1778e7166fcc6db74e0609d307e55412d7f5e4656a8dbf25f1b33289f1b330835336e25ce3107193c5b388641d9b6861",
        "0xe99726a3199f4436642b4b3e4118e5499db995a1257fb3f086eeb65982fac18985a286f301e77c451154ce9ac8895d9",
        "0x1630c3250d7313ff01d1201bf7a74ab5db3cb17dd952799b9ed3ab9097e68f90a0870d2dcae73d19cd13c1c66f652983",
        "0xd6ed6553fe44d296a3726c38ae652bfb11586264f0f8ce19008e218f9c86b2a8da25128c1052ecaddd7f225a139ed84",
        "0x17b81e7701abdbe2e8743884d1117e53356de5ab275b4db1a682c62ef0f2753339b7c8f8c8f475af9ccb5618e3f0c88e",
        "0x80d3cf1f9a78fc47b90b33563be990dc43b756ce79f5574a2c596c928c5d1de4fa295f296b74e956d71986a8497e317",
        "0x169b1f8e1bcfa7c42e0c37515d138f22dd2ecb803a0c5c99676314baf4bb1b7fa3190b2edc0327797f241067be390c9e",
        "0x10321da079ce07e272d8ec09d2565b0dfa7dccdde6787f96d50af36003b14866f69b771f8c285decca67df3f1605fb7b",
        "0x6e08c248e260e70bd1e962381edee3d31d79d7e22c837bc23c0bf1bc24c6b68c24b1b80b64d391fa9c8ba2e8ba2d229"
      ],
      // xDen
      [
        "0x8ca8d548cff19ae18b2e62f4bd3fa6f01d5ef4ba35b48ba9c9588617fc8ac62b558d681be343df8993cf9fa40d21b1c",
        "0x12561a5deb559c4348b4711298e536367041e8ca0cf0800c0126c2588c48bf5713daa8846cb026e9e5c8276ec82b3bff",
        "0xb2962fe57a3225e8137e629bff2991f6f89416f5a718cd1fca64e00b11aceacd6a3d0967c94fedcfcc239ba5cb83e19",
        "0x3425581a58ae2fec83aafef7c40eb545b08243f16b1655154cca8abc28d6fd04976d5243eecf5c4130de8938dc62cd8",
        "0x13a8e162022914a80a6f1d5f43e7a07dffdfc759a12062bb8d6b44e833b306da9bd29ba81f35781d539d395b3532a21e",
        "0xe7355f8e4e667b955390f7f0506c6e9395735e9ce9cad4d0a43bcef24b8982f7400d24bc4228f11c02df9a29f6304a5",
        "0x772caacf16936190f3e0c63e0596721570f5799af53a1894e2e073062aede9cea73b3538f0de06cec2574496ee84a3a",
        "0x14a7ac2a9d64a8b230b3f5b074cf01996e7f63c21bca68a81996e1cdf9822c580fa5b9489d11e2d311f7d99bbdcc5a5e",
        "0xa10ecf6ada54f825e920b3dafc7a3cce07f8d1d7161366b74100da67f39883503826692abba43704776ec3a79a1d641",
        "0x95fc13ab9e92ad4476d6e3eb3a56680f682b4ee96f7d03776df533978f31c1593174e4b4b7865002d6384d168ecdd0a",
        "0x000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001"
        // LAST 1
      ],
      // yNum
      [
        "0x90d97c81ba24ee0259d1f094980dcfa11ad138e48a869522b52af6c956543d3cd0c7aee9b3ba3c2be9845719707bb33",
        "0x134996a104ee5811d51036d776fb46831223e96c254f383d0f906343eb67ad34d6c56711962fa8bfe097e75a2e41c696",
        "0xcc786baa966e66f4a384c86a3b49942552e2d658a31ce2c344be4b91400da7d26d521628b00523b8dfe240c72de1f6",
        "0x1f86376e8981c217898751ad8746757d42aa7b90eeb791c09e4a3ec03251cf9de405aba9ec61deca6355c77b0e5f4cb",
        "0x8cc03fdefe0ff135caf4fe2a21529c4195536fbe3ce50b879833fd221351adc2ee7f8dc099040a841b6daecf2e8fedb",
        "0x16603fca40634b6a2211e11db8f0a6a074a7d0d4afadb7bd76505c3d3ad5544e203f6326c95a807299b23ab13633a5f0",
        "0x4ab0b9bcfac1bbcb2c977d027796b3ce75bb8ca2be184cb5231413c4d634f3747a87ac2460f415ec961f8855fe9d6f2",
        "0x987c8d5333ab86fde9926bd2ca6c674170a05bfe3bdd81ffd038da6c26c842642f64550fedfe935a15e4ca31870fb29",
        "0x9fc4018bd96684be88c9e221e4da1bb8f3abd16679dc26c1e8b6e6a1f20cabe69d65201c78607a360370e577bdba587",
        "0xe1bba7a1186bdb5223abde7ada14a23c42a0ca7915af6fe06985e7ed1e4d43b9b3f7055dd4eba6f2bafaaebca731c30",
        "0x19713e47937cd1be0dfd0b8f1d43fb93cd2fcbcb6caf493fd1183e416389e61031bf3a5cce3fbafce813711ad011c132",
        "0x18b46a908f36f6deb918c143fed2edcc523559b8aaf0c2462e6bfe7f911f643249d9cdf41b44d606ce07c8a4d0074d8e",
        "0xb182cac101b9399d155096004f53f447aa7b12a3426b08ec02710e807b4633f06c851c1919211f20d4c04f00b971ef8",
        "0x245a394ad1eca9b72fc00ae7be315dc757b3b080d4c158013e6632d3c40659cc6cf90ad1c232a6442d9d3f5db980133",
        "0x5c129645e44cf1102a159f748c4a3fc5e673d81d7e86568d9ab0f5d396a7ce46ba1049b6579afb7866b1e715475224b",
        "0x15e6be4e990f03ce4ea50b3b42df2eb5cb181d8f84965a3957add4fa95af01b2b665027efec01c7704b456be69c8b604"
      ],
      // yDen
      [
        "0x16112c4c3a9c98b252181140fad0eae9601a6de578980be6eec3232b5be72e7a07f3688ef60c206d01479253b03663c1",
        "0x1962d75c2381201e1a0cbd6c43c348b885c84ff731c4d59ca4a10356f453e01f78a4260763529e3532f6102c2e49a03d",
        "0x58df3306640da276faaae7d6e8eb15778c4855551ae7f310c35a5dd279cd2eca6757cd636f96f891e2538b53dbf67f2",
        "0x16b7d288798e5395f20d23bf89edb4d1d115c5dbddbcd30e123da489e726af41727364f2c28297ada8d26d98445f5416",
        "0xbe0e079545f43e4b00cc912f8228ddcc6d19c9f0f69bbb0542eda0fc9dec916a20b15dc0fd2ededda39142311a5001d",
        "0x8d9e5297186db2d9fb266eaac783182b70152c65550d881c5ecd87b6f0f5a6449f38db9dfa9cce202c6477faaf9b7ac",
        "0x166007c08a99db2fc3ba8734ace9824b5eecfdfa8d0cf8ef5dd365bc400a0051d5fa9c01a58b1fb93d1a1399126a775c",
        "0x16a3ef08be3ea7ea03bcddfabba6ff6ee5a4375efa1f4fd7feb34fd206357132b920f5b00801dee460ee415a15812ed9",
        "0x1866c8ed336c61231a1be54fd1d74cc4f9fb0ce4c6af5920abc5750c4bf39b4852cfe2f7bb9248836b233d9d55535d4a",
        "0x167a55cda70a6e1cea820597d94a84903216f763e13d87bb5308592e7ea7d4fbc7385ea3d529b35e346ef48bb8913f55",
        "0x4d2f259eea405bd48f010a01ad2911d9c6dd039bb61a6290e591b36e636a5c871a5c29f4f83060400f8b49cba8f6aa8",
        "0xaccbb67481d033ff5852c1e48c50c477f94ff8aefce42d28c0f9a88cea7913516f968986f7ebbea9684b529e2561092",
        "0xad6b9514c767fe3c3613144b45f1496543346d98adf02267d5ceef9a00d9b8693000763e3b90ac11e99b138573345cc",
        "0x2660400eb2e4f3b628bdd0d53cd76f2bf565b94e72927c1cb748df27942480e420517bd8714cc80d1fadc1326ed06f7",
        "0xe0fa1d816ddc03e6b24255e0d7819c171c40f65e273b853324efcd6356caa205ca2f570f13497804415473a1d634b8f",
        "0x000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001"
        // LAST 1
      ]
    ].map((i) => i.map((j) => BigInt(j))));
    var G1_SWU2 = (0, weierstrass_ts_1.mapToCurveSimpleSWU)(Fp3, {
      A: Fp3.create(BigInt("0x144698a3b8e9433d693a02c96d4982b0ea985383ee66a8d8e8981aefd881ac98936f8da0e0f97f5cf428082d584c1d")),
      B: Fp3.create(BigInt("0x12e2908d11688030018b12e8753eee3b2016c1f0f24f4070a0b9c14fcef35ef55a23215a316ceaa5d1cc48e98e172be0")),
      Z: Fp3.create(BigInt(11))
    });
    var G2_SWU2 = (0, weierstrass_ts_1.mapToCurveSimpleSWU)(Fp22, {
      A: Fp22.create({ c0: Fp3.create(_0n8), c1: Fp3.create(BigInt(240)) }),
      // A' = 240 * I
      B: Fp22.create({ c0: Fp3.create(BigInt(1012)), c1: Fp3.create(BigInt(1012)) }),
      // B' = 1012 * (1 + I)
      Z: Fp22.create({ c0: Fp3.create(BigInt(-2)), c1: Fp3.create(BigInt(-1)) })
      // Z: -(2 + I)
    });
    function mapToG12(scalars) {
      const { x, y } = G1_SWU2(Fp3.create(scalars[0]));
      return isogenyMapG12(x, y);
    }
    function mapToG22(scalars) {
      const { x, y } = G2_SWU2(Fp22.fromBigTuple(scalars));
      return isogenyMapG22(x, y);
    }
  }
});

// node_modules/@noble/hashes/sha256.js
var require_sha256 = __commonJS({
  "node_modules/@noble/hashes/sha256.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.sha224 = exports.SHA224 = exports.sha256 = exports.SHA256 = void 0;
    var sha2_ts_1 = require_sha2();
    exports.SHA256 = sha2_ts_1.SHA256;
    exports.sha256 = sha2_ts_1.sha256;
    exports.SHA224 = sha2_ts_1.SHA224;
    exports.sha224 = sha2_ts_1.sha224;
  }
});

// node_modules/@noble/curves/abstract/utils.js
var require_utils3 = __commonJS({
  "node_modules/@noble/curves/abstract/utils.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.isHash = exports.validateObject = exports.memoized = exports.notImplemented = exports.createHmacDrbg = exports.bitMask = exports.bitSet = exports.bitGet = exports.bitLen = exports.aInRange = exports.inRange = exports.asciiToBytes = exports.copyBytes = exports.equalBytes = exports.ensureBytes = exports.numberToVarBytesBE = exports.numberToBytesLE = exports.numberToBytesBE = exports.bytesToNumberLE = exports.bytesToNumberBE = exports.hexToNumber = exports.numberToHexUnpadded = exports.abool = exports.utf8ToBytes = exports.randomBytes = exports.isBytes = exports.hexToBytes = exports.concatBytes = exports.bytesToUtf8 = exports.bytesToHex = exports.anumber = exports.abytes = void 0;
    var u = require_utils2();
    exports.abytes = u.abytes;
    exports.anumber = u.anumber;
    exports.bytesToHex = u.bytesToHex;
    exports.bytesToUtf8 = u.bytesToUtf8;
    exports.concatBytes = u.concatBytes;
    exports.hexToBytes = u.hexToBytes;
    exports.isBytes = u.isBytes;
    exports.randomBytes = u.randomBytes;
    exports.utf8ToBytes = u.utf8ToBytes;
    exports.abool = u.abool;
    exports.numberToHexUnpadded = u.numberToHexUnpadded;
    exports.hexToNumber = u.hexToNumber;
    exports.bytesToNumberBE = u.bytesToNumberBE;
    exports.bytesToNumberLE = u.bytesToNumberLE;
    exports.numberToBytesBE = u.numberToBytesBE;
    exports.numberToBytesLE = u.numberToBytesLE;
    exports.numberToVarBytesBE = u.numberToVarBytesBE;
    exports.ensureBytes = u.ensureBytes;
    exports.equalBytes = u.equalBytes;
    exports.copyBytes = u.copyBytes;
    exports.asciiToBytes = u.asciiToBytes;
    exports.inRange = u.inRange;
    exports.aInRange = u.aInRange;
    exports.bitLen = u.bitLen;
    exports.bitGet = u.bitGet;
    exports.bitSet = u.bitSet;
    exports.bitMask = u.bitMask;
    exports.createHmacDrbg = u.createHmacDrbg;
    exports.notImplemented = u.notImplemented;
    exports.memoized = u.memoized;
    exports.validateObject = u.validateObject;
    exports.isHash = u.isHash;
  }
});

// node_modules/drand-client/version.js
var require_version = __commonJS({
  "node_modules/drand-client/version.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.LIB_VERSION = void 0;
    exports.LIB_VERSION = "1.2.5";
  }
});

// node_modules/drand-client/util.js
var require_util = __commonJS({
  "node_modules/drand-client/util.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.retryOnError = exports.jsonOrError = exports.defaultHttpOptions = exports.roundTime = exports.roundAt = exports.sleep = void 0;
    var version_1 = require_version();
    function sleep(timeMs) {
      return new Promise((resolve) => {
        if (timeMs <= 0) {
          resolve();
        }
        setTimeout(resolve, timeMs);
      });
    }
    exports.sleep = sleep;
    function roundAt(time, chain) {
      if (!Number.isFinite(time)) {
        throw new Error("Cannot use Infinity or NaN as a beacon time");
      }
      if (time < chain.genesis_time * 1e3) {
        throw Error("Cannot request a round before the genesis time");
      }
      return Math.floor((time - chain.genesis_time * 1e3) / (chain.period * 1e3)) + 1;
    }
    exports.roundAt = roundAt;
    function roundTime(chain, round) {
      if (!Number.isFinite(round)) {
        throw new Error("Cannot use Infinity or NaN as a round number");
      }
      round = round < 0 ? 0 : round;
      return (chain.genesis_time + (round - 1) * chain.period) * 1e3;
    }
    exports.roundTime = roundTime;
    exports.defaultHttpOptions = {
      userAgent: `drand-client-${version_1.LIB_VERSION}`
    };
    async function jsonOrError(url, options = exports.defaultHttpOptions) {
      const headers = { ...options.headers };
      if (options.userAgent) {
        headers["User-Agent"] = options.userAgent;
      }
      const response = await fetch(url, { headers });
      if (!response.ok) {
        throw Error(`Error response fetching ${url} - got ${response.status}`);
      }
      return await response.json();
    }
    exports.jsonOrError = jsonOrError;
    async function retryOnError(fn, times) {
      try {
        return await fn();
      } catch (err) {
        if (times === 0) {
          throw err;
        }
        return retryOnError(fn, times - 1);
      }
    }
    exports.retryOnError = retryOnError;
  }
});

// node_modules/drand-client/http-caching-chain.js
var require_http_caching_chain = __commonJS({
  "node_modules/drand-client/http-caching-chain.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.HttpChain = void 0;
    var index_1 = require_drand_client();
    var util_1 = require_util();
    var HttpChain = class {
      baseUrl;
      options;
      httpOptions;
      constructor(baseUrl, options = index_1.defaultChainOptions, httpOptions = {}) {
        this.baseUrl = baseUrl;
        this.options = options;
        this.httpOptions = httpOptions;
      }
      async info() {
        const chainInfo = await (0, util_1.jsonOrError)(`${this.baseUrl}/info`, this.httpOptions);
        if (!!this.options.chainVerificationParams && !isValidInfo(chainInfo, this.options.chainVerificationParams)) {
          throw Error(`The chain info retrieved from ${this.baseUrl} did not match the verification params!`);
        }
        return chainInfo;
      }
    };
    exports.HttpChain = HttpChain;
    function isValidInfo(chainInfo, validParams) {
      return chainInfo.hash === validParams.chainHash && chainInfo.public_key === validParams.publicKey;
    }
    var HttpCachingChain = class {
      baseUrl;
      options;
      chain;
      cachedInfo;
      constructor(baseUrl, options = index_1.defaultChainOptions) {
        this.baseUrl = baseUrl;
        this.options = options;
        this.chain = new HttpChain(baseUrl, options);
      }
      async info() {
        if (!this.cachedInfo) {
          this.cachedInfo = await this.chain.info();
        }
        return this.cachedInfo;
      }
    };
    exports.default = HttpCachingChain;
  }
});

// node_modules/drand-client/http-chain-client.js
var require_http_chain_client = __commonJS({
  "node_modules/drand-client/http-chain-client.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var index_1 = require_drand_client();
    var util_1 = require_util();
    var HttpChainClient = class {
      someChain;
      options;
      httpOptions;
      constructor(someChain, options = index_1.defaultChainOptions, httpOptions = util_1.defaultHttpOptions) {
        this.someChain = someChain;
        this.options = options;
        this.httpOptions = httpOptions;
      }
      async get(roundNumber) {
        const url = withCachingParams(`${this.someChain.baseUrl}/public/${roundNumber}`, this.options);
        return await (0, util_1.jsonOrError)(url, this.httpOptions);
      }
      async latest() {
        const url = withCachingParams(`${this.someChain.baseUrl}/public/latest`, this.options);
        return await (0, util_1.jsonOrError)(url, this.httpOptions);
      }
      chain() {
        return this.someChain;
      }
    };
    function withCachingParams(url, config) {
      if (config.noCache) {
        return `${url}?${Date.now()}`;
      }
      return url;
    }
    exports.default = HttpChainClient;
  }
});

// node_modules/drand-client/speedtest.js
var require_speedtest = __commonJS({
  "node_modules/drand-client/speedtest.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.createSpeedTest = void 0;
    function createSpeedTest(test, frequencyMs, samples = 5) {
      let queue = new DroppingQueue(samples);
      let intervalId = null;
      const executeSpeedTest = async () => {
        const startTime = Date.now();
        try {
          await test();
          queue.add(Date.now() - startTime);
        } catch (err) {
          queue.add(Number.MAX_SAFE_INTEGER);
        }
      };
      return {
        start: () => {
          if (intervalId != null) {
            console.warn("Attempted to start a speed test, but it had already been started!");
            return;
          }
          intervalId = setInterval(executeSpeedTest, frequencyMs);
        },
        stop: () => {
          if (intervalId !== null) {
            clearInterval(intervalId);
            intervalId = null;
            queue = new DroppingQueue(samples);
          }
        },
        average: () => {
          const values = queue.get();
          if (values.length === 0) {
            return Number.MAX_SAFE_INTEGER;
          }
          const total = values.reduce((acc, next) => acc + next, 0);
          return total / values.length;
        }
      };
    }
    exports.createSpeedTest = createSpeedTest;
    var DroppingQueue = class {
      capacity;
      values = [];
      constructor(capacity) {
        this.capacity = capacity;
      }
      add(value) {
        this.values.push(value);
        if (this.values.length > this.capacity) {
          this.values.pop();
        }
      }
      get() {
        return this.values;
      }
    };
  }
});

// node_modules/drand-client/fastest-node-client.js
var require_fastest_node_client = __commonJS({
  "node_modules/drand-client/fastest-node-client.js"(exports) {
    "use strict";
    var __createBinding = exports && exports.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __setModuleDefault = exports && exports.__setModuleDefault || (Object.create ? (function(o, v) {
      Object.defineProperty(o, "default", { enumerable: true, value: v });
    }) : function(o, v) {
      o["default"] = v;
    });
    var __importStar = exports && exports.__importStar || function(mod2) {
      if (mod2 && mod2.__esModule) return mod2;
      var result = {};
      if (mod2 != null) {
        for (var k in mod2) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod2, k)) __createBinding(result, mod2, k);
      }
      __setModuleDefault(result, mod2);
      return result;
    };
    var __importDefault = exports && exports.__importDefault || function(mod2) {
      return mod2 && mod2.__esModule ? mod2 : { "default": mod2 };
    };
    Object.defineProperty(exports, "__esModule", { value: true });
    var index_1 = require_drand_client();
    var http_caching_chain_1 = __importStar(require_http_caching_chain());
    var speedtest_1 = require_speedtest();
    var http_chain_client_1 = __importDefault(require_http_chain_client());
    var defaultSpeedTestInterval = 1e3 * 60 * 5;
    var FastestNodeClient = class {
      baseUrls;
      options;
      speedTestIntervalMs;
      speedTests = [];
      speedTestHttpOptions = { userAgent: "drand-web-client-speedtest" };
      constructor(baseUrls, options = index_1.defaultChainOptions, speedTestIntervalMs = defaultSpeedTestInterval) {
        this.baseUrls = baseUrls;
        this.options = options;
        this.speedTestIntervalMs = speedTestIntervalMs;
        if (baseUrls.length === 0) {
          throw Error("Can't optimise an empty `baseUrls` array!");
        }
      }
      async latest() {
        return new http_chain_client_1.default(this.current(), this.options).latest();
      }
      async get(roundNumber) {
        return new http_chain_client_1.default(this.current(), this.options).get(roundNumber);
      }
      chain() {
        return this.current();
      }
      start() {
        if (this.baseUrls.length === 1) {
          console.warn("There was only a single base URL in the `FastestNodeClient` - not running speed testing");
          return;
        }
        this.speedTests = this.baseUrls.map((url) => {
          const testFn = async () => {
            await new http_caching_chain_1.HttpChain(url, this.options, this.speedTestHttpOptions).info();
            return;
          };
          const test = (0, speedtest_1.createSpeedTest)(testFn, this.speedTestIntervalMs);
          test.start();
          return { test, url };
        });
      }
      current() {
        if (this.speedTests.length === 0) {
          console.warn("You are not currently running speed tests to choose the fastest client. Run `.start()` to speed test");
        }
        const fastestEntry = this.speedTests.slice().sort((entry1, entry2) => entry1.test.average() - entry2.test.average()).shift();
        if (!fastestEntry) {
          throw Error("Somehow there were no entries to optimise! This should be impossible by now");
        }
        return new http_caching_chain_1.default(fastestEntry.url, this.options);
      }
      stop() {
        this.speedTests.forEach((entry) => entry.test.stop());
        this.speedTests = [];
      }
    };
    exports.default = FastestNodeClient;
  }
});

// node_modules/drand-client/multi-beacon-node.js
var require_multi_beacon_node = __commonJS({
  "node_modules/drand-client/multi-beacon-node.js"(exports) {
    "use strict";
    var __importDefault = exports && exports.__importDefault || function(mod2) {
      return mod2 && mod2.__esModule ? mod2 : { "default": mod2 };
    };
    Object.defineProperty(exports, "__esModule", { value: true });
    var index_1 = require_drand_client();
    var http_caching_chain_1 = __importDefault(require_http_caching_chain());
    var util_1 = require_util();
    var MultiBeaconNode = class {
      baseUrl;
      options;
      constructor(baseUrl, options = index_1.defaultChainOptions) {
        this.baseUrl = baseUrl;
        this.options = options;
      }
      async chains() {
        const chains = await (0, util_1.jsonOrError)(`${this.baseUrl}/chains`);
        if (!Array.isArray(chains)) {
          throw Error(`Expected an array from the chains endpoint but got: ${chains}`);
        }
        return chains.map((chainHash) => new http_caching_chain_1.default(`${this.baseUrl}/${chainHash}`), this.options);
      }
      async health() {
        const response = await fetch(`${this.baseUrl}/health`);
        if (!response.ok) {
          return {
            status: response.status,
            current: -1,
            expected: -1
          };
        }
        const json = await response.json();
        return {
          status: response.status,
          current: json.current ?? -1,
          expected: json.expected ?? -1
        };
      }
    };
    exports.default = MultiBeaconNode;
  }
});

// node_modules/drand-client/index.js
var require_drand_client = __commonJS({
  "node_modules/drand-client/index.js"(exports) {
    "use strict";
    var __importDefault = exports && exports.__importDefault || function(mod2) {
      return mod2 && mod2.__esModule ? mod2 : { "default": mod2 };
    };
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.roundTime = exports.roundAt = exports.FastestNodeClient = exports.MultiBeaconNode = exports.HttpCachingChain = exports.HttpChainClient = exports.HttpChain = exports.isG1Rfc9380 = exports.isG1G2SwappedBeacon = exports.isUnchainedBeacon = exports.isChainedBeacon = exports.watch = exports.fetchBeaconByTime = exports.fetchBeacon = exports.defaultChainOptions = void 0;
    var http_caching_chain_1 = __importDefault(require_http_caching_chain());
    exports.HttpCachingChain = http_caching_chain_1.default;
    var http_caching_chain_2 = require_http_caching_chain();
    Object.defineProperty(exports, "HttpChain", { enumerable: true, get: function() {
      return http_caching_chain_2.HttpChain;
    } });
    var http_chain_client_1 = __importDefault(require_http_chain_client());
    exports.HttpChainClient = http_chain_client_1.default;
    var fastest_node_client_1 = __importDefault(require_fastest_node_client());
    exports.FastestNodeClient = fastest_node_client_1.default;
    var multi_beacon_node_1 = __importDefault(require_multi_beacon_node());
    exports.MultiBeaconNode = multi_beacon_node_1.default;
    var util_1 = require_util();
    Object.defineProperty(exports, "roundAt", { enumerable: true, get: function() {
      return util_1.roundAt;
    } });
    Object.defineProperty(exports, "roundTime", { enumerable: true, get: function() {
      return util_1.roundTime;
    } });
    var beacon_verification_1 = require_beacon_verification();
    exports.defaultChainOptions = {
      disableBeaconVerification: false,
      noCache: false
    };
    async function fetchBeacon(client2, roundNumber) {
      if (!roundNumber) {
        roundNumber = (0, util_1.roundAt)(Date.now(), await client2.chain().info());
      }
      if (roundNumber < 1) {
        throw Error("Cannot request lower than round number 1");
      }
      const beacon = await client2.get(roundNumber);
      return validatedBeacon(client2, beacon, roundNumber);
    }
    exports.fetchBeacon = fetchBeacon;
    async function fetchBeaconByTime(client2, time) {
      const info = await client2.chain().info();
      const roundNumber = (0, util_1.roundAt)(time, info);
      return fetchBeacon(client2, roundNumber);
    }
    exports.fetchBeaconByTime = fetchBeaconByTime;
    async function* watch(client2, abortController, options = defaultWatchOptions) {
      const info = await client2.chain().info();
      let currentRound = (0, util_1.roundAt)(Date.now(), info);
      while (!abortController.signal.aborted) {
        const now = Date.now();
        await (0, util_1.sleep)((0, util_1.roundTime)(info, currentRound) - now);
        const beacon = await (0, util_1.retryOnError)(async () => client2.get(currentRound), options.retriesOnFailure);
        yield validatedBeacon(client2, beacon, currentRound);
        currentRound = currentRound + 1;
      }
    }
    exports.watch = watch;
    var defaultWatchOptions = {
      retriesOnFailure: 3
    };
    async function validatedBeacon(client2, beacon, expectedRound) {
      if (client2.options.disableBeaconVerification) {
        return beacon;
      }
      const info = await client2.chain().info();
      if (!await (0, beacon_verification_1.verifyBeacon)(info, beacon, expectedRound)) {
        throw Error("The beacon retrieved was not valid!");
      }
      return beacon;
    }
    function isChainedBeacon(value, info) {
      return info.schemeID === "pedersen-bls-chained" && !!value.previous_signature && !!value.randomness && !!value.signature && value.round > 0;
    }
    exports.isChainedBeacon = isChainedBeacon;
    function isUnchainedBeacon(value, info) {
      return info.schemeID === "pedersen-bls-unchained" && !!value.randomness && !!value.signature && value.previous_signature === void 0 && value.round > 0;
    }
    exports.isUnchainedBeacon = isUnchainedBeacon;
    function isG1G2SwappedBeacon(value, info) {
      return info.schemeID === "bls-unchained-on-g1" && !!value.randomness && !!value.signature && value.previous_signature === void 0 && value.round > 0;
    }
    exports.isG1G2SwappedBeacon = isG1G2SwappedBeacon;
    function isG1Rfc9380(value, info) {
      return info.schemeID === "bls-unchained-g1-rfc9380" && !!value.randomness && !!value.signature && value.previous_signature === void 0 && value.round > 0;
    }
    exports.isG1Rfc9380 = isG1Rfc9380;
  }
});

// node_modules/drand-client/beacon-verification.js
var require_beacon_verification = __commonJS({
  "node_modules/drand-client/beacon-verification.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.roundBuffer = exports.verifyBeacon = exports.verifySigOnG1 = void 0;
    var bls12_381_1 = require_bls12_381();
    var sha256_1 = require_sha256();
    var utils_1 = require_utils3();
    var buffer_1 = __require("buffer");
    var index_1 = require_drand_client();
    async function verifyBeacon2(chainInfo, beacon, expectedRound) {
      const publicKey = chainInfo.public_key;
      if (beacon.round !== expectedRound) {
        console.error("round was not the expected round");
        return false;
      }
      if (!await randomnessIsValid(beacon)) {
        console.error("randomness did not match the signature");
        return false;
      }
      if ((0, index_1.isChainedBeacon)(beacon, chainInfo)) {
        return bls12_381_1.bls12_381.verify(beacon.signature, await chainedBeaconMessage(beacon), publicKey);
      }
      if ((0, index_1.isUnchainedBeacon)(beacon, chainInfo)) {
        return bls12_381_1.bls12_381.verify(beacon.signature, await unchainedBeaconMessage(beacon), publicKey);
      }
      if ((0, index_1.isG1G2SwappedBeacon)(beacon, chainInfo)) {
        return verifySigOnG1(beacon.signature, await unchainedBeaconMessage(beacon), publicKey);
      }
      if ((0, index_1.isG1Rfc9380)(beacon, chainInfo)) {
        return verifySigOnG1(beacon.signature, await unchainedBeaconMessage(beacon), publicKey, "BLS_SIG_BLS12381G1_XMD:SHA-256_SSWU_RO_NUL_");
      }
      console.error(`Beacon type ${chainInfo.schemeID} was not supported or the beacon was not of the purported type`);
      return false;
    }
    exports.verifyBeacon = verifyBeacon2;
    function normP1(point) {
      return point instanceof bls12_381_1.bls12_381.G1.ProjectivePoint ? point : bls12_381_1.bls12_381.G1.ProjectivePoint.fromHex(point);
    }
    function normP2(point) {
      return point instanceof bls12_381_1.bls12_381.G2.ProjectivePoint ? point : bls12_381_1.bls12_381.G2.ProjectivePoint.fromHex(point);
    }
    function normP1Hash(point, domainSeparationTag) {
      return point instanceof bls12_381_1.bls12_381.G1.ProjectivePoint ? point : bls12_381_1.bls12_381.G1.hashToCurve((0, utils_1.ensureBytes)("point", point), { DST: domainSeparationTag });
    }
    async function verifySigOnG1(signature, message, publicKey, domainSeparationTag = "BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_NUL_") {
      const P = normP2(publicKey);
      const Hm = normP1Hash(message, domainSeparationTag);
      const G = bls12_381_1.bls12_381.G2.ProjectivePoint.BASE;
      const S = normP1(signature);
      const ePHm = bls12_381_1.bls12_381.pairing(Hm, P.negate(), true);
      const eGS = bls12_381_1.bls12_381.pairing(S, G, true);
      const exp = bls12_381_1.bls12_381.fields.Fp12.mul(eGS, ePHm);
      return bls12_381_1.bls12_381.fields.Fp12.eql(exp, bls12_381_1.bls12_381.fields.Fp12.ONE);
    }
    exports.verifySigOnG1 = verifySigOnG1;
    async function chainedBeaconMessage(beacon) {
      const message = buffer_1.Buffer.concat([
        signatureBuffer(beacon.previous_signature),
        roundBuffer(beacon.round)
      ]);
      return (0, sha256_1.sha256)(message);
    }
    async function unchainedBeaconMessage(beacon) {
      return (0, sha256_1.sha256)(roundBuffer(beacon.round));
    }
    function signatureBuffer(sig) {
      return buffer_1.Buffer.from(sig, "hex");
    }
    function roundBuffer(round) {
      const buffer = buffer_1.Buffer.alloc(8);
      buffer.writeBigUInt64BE(BigInt(round));
      return buffer;
    }
    exports.roundBuffer = roundBuffer;
    async function randomnessIsValid(beacon) {
      const expectedRandomness = (0, sha256_1.sha256)(buffer_1.Buffer.from(beacon.signature, "hex"));
      return buffer_1.Buffer.from(beacon.randomness, "hex").compare(expectedRandomness) == 0;
    }
  }
});

// node_modules/tlock-js/crypto/utils.js
var require_utils4 = __commonJS({
  "node_modules/tlock-js/crypto/utils.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.fp12ToBytes = exports.fp6ToBytes = exports.fp2ToBytes = exports.fpToBytes = exports.bytesToHex = exports.bytesToNumberBE = exports.xor = void 0;
    var buffer_1 = __require("buffer");
    function xor(a, b) {
      if (a.length != b.length) {
        throw new Error("Error: incompatible sizes");
      }
      const ret = new Uint8Array(a.length);
      for (let i = 0; i < a.length; i++) {
        ret[i] = a[i] ^ b[i];
      }
      return ret;
    }
    exports.xor = xor;
    function bytesToNumberBE2(uint8a) {
      return BigInt("0x" + bytesToHex2(Uint8Array.from(uint8a)));
    }
    exports.bytesToNumberBE = bytesToNumberBE2;
    var hexes2 = Array.from({ length: 256 }, (v, i) => i.toString(16).padStart(2, "0"));
    function bytesToHex2(uint8a) {
      let hex = "";
      for (let i = 0; i < uint8a.length; i++) {
        hex += hexes2[uint8a[i]];
      }
      return hex;
    }
    exports.bytesToHex = bytesToHex2;
    function fpToBytes(fp) {
      const hex = fp.toString(16).padStart(96, "0");
      const buf = buffer_1.Buffer.alloc(hex.length / 2);
      buf.write(hex, "hex");
      return buf;
    }
    exports.fpToBytes = fpToBytes;
    function fp2ToBytes(fp2) {
      return buffer_1.Buffer.concat([fp2.c1, fp2.c0].map(fpToBytes));
    }
    exports.fp2ToBytes = fp2ToBytes;
    function fp6ToBytes(fp6) {
      return buffer_1.Buffer.concat([fp6.c2, fp6.c1, fp6.c0].map(fp2ToBytes));
    }
    exports.fp6ToBytes = fp6ToBytes;
    function fp12ToBytes(fp12) {
      return buffer_1.Buffer.concat([fp12.c1, fp12.c0].map(fp6ToBytes));
    }
    exports.fp12ToBytes = fp12ToBytes;
  }
});

// node_modules/tlock-js/crypto/ibe.js
var require_ibe = __commonJS({
  "node_modules/tlock-js/crypto/ibe.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.gtToHash = exports.decryptOnG2 = exports.decryptOnG1 = exports.encryptOnG2RFC9380 = exports.encryptOnG2 = exports.encryptOnG1 = void 0;
    var sha256_1 = require_sha256();
    var utils_1 = require_utils();
    var bls12_381_1 = require_bls12_381();
    var buffer_1 = __require("buffer");
    var utils_2 = require_utils4();
    var PointG1 = bls12_381_1.bls12_381.G1;
    var PointG2 = bls12_381_1.bls12_381.G2;
    async function encryptOnG1(master, ID, msg) {
      if (msg.length >> 8 > 1) {
        throw new Error("cannot encrypt messages larger than our hash output: 256 bits.");
      }
      const Qid = PointG2.hashToCurve(ID, { DST: "BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_NUL_" });
      const m = PointG1.ProjectivePoint.fromHex(master);
      const Gid = bls12_381_1.bls12_381.pairing(m, Qid);
      const sigma = (0, utils_1.randomBytes)(msg.length);
      const r = h3(sigma, msg);
      const U = PointG1.ProjectivePoint.BASE.multiply(r);
      const rGid = bls12_381_1.bls12_381.fields.Fp12.pow(Gid, r);
      const hrGid = gtToHash(rGid, msg.length);
      const V = (0, utils_2.xor)(sigma, hrGid);
      const hsigma = h4(sigma, msg.length);
      const W = (0, utils_2.xor)(msg, hsigma);
      return {
        U: U.toRawBytes(),
        V,
        W
      };
    }
    exports.encryptOnG1 = encryptOnG1;
    async function encryptOnG2(master, ID, msg) {
      return encOnG2(master, ID, msg, "BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_NUL_");
    }
    exports.encryptOnG2 = encryptOnG2;
    async function encryptOnG2RFC9380(master, ID, msg) {
      return encOnG2(master, ID, msg, "BLS_SIG_BLS12381G1_XMD:SHA-256_SSWU_RO_NUL_");
    }
    exports.encryptOnG2RFC9380 = encryptOnG2RFC9380;
    async function encOnG2(master, ID, msg, dst) {
      if (msg.length >> 8 > 1) {
        throw new Error("cannot encrypt messages larger than our hash output: 256 bits.");
      }
      const Qid = PointG1.hashToCurve(ID, { DST: dst });
      const m = PointG2.ProjectivePoint.fromHex(master);
      const Gid = bls12_381_1.bls12_381.pairing(Qid, m);
      const sigma = (0, utils_1.randomBytes)(msg.length);
      const r = h3(sigma, msg);
      const U = PointG2.ProjectivePoint.BASE.multiply(r);
      const rGid = bls12_381_1.bls12_381.fields.Fp12.pow(Gid, r);
      const hrGid = gtToHash(rGid, msg.length);
      const V = (0, utils_2.xor)(sigma, hrGid);
      const hsigma = h4(sigma, msg.length);
      const W = (0, utils_2.xor)(msg, hsigma);
      return {
        U: U.toRawBytes(),
        V,
        W
      };
    }
    async function decryptOnG1(key, ciphertext) {
      const Qid = PointG1.ProjectivePoint.fromHex(ciphertext.U);
      const m = PointG2.ProjectivePoint.fromHex(key);
      const gidt = bls12_381_1.bls12_381.pairing(Qid, m);
      const hgidt = gtToHash(gidt, ciphertext.W.length);
      if (hgidt.length != ciphertext.V.length) {
        throw new Error("XorSigma is of invalid length");
      }
      const sigma = (0, utils_2.xor)(hgidt, ciphertext.V);
      const hsigma = h4(sigma, ciphertext.W.length);
      const msg = (0, utils_2.xor)(hsigma, ciphertext.W);
      const r = h3(sigma, msg);
      const rP = PointG1.ProjectivePoint.BASE.multiply(r);
      if (!rP.equals(Qid)) {
        throw new Error("invalid proof: rP check failed");
      }
      return msg;
    }
    exports.decryptOnG1 = decryptOnG1;
    async function decryptOnG2(key, ciphertext) {
      const Qid = PointG1.ProjectivePoint.fromHex(key);
      const m = PointG2.ProjectivePoint.fromHex(ciphertext.U);
      const gidt = bls12_381_1.bls12_381.pairing(Qid, m);
      const hgidt = gtToHash(gidt, ciphertext.W.length);
      if (hgidt.length != ciphertext.V.length) {
        throw new Error("XorSigma is of invalid length");
      }
      const sigma = (0, utils_2.xor)(hgidt, ciphertext.V);
      const hsigma = h4(sigma, ciphertext.W.length);
      const msg = (0, utils_2.xor)(hsigma, ciphertext.W);
      const r = h3(sigma, msg);
      const rP = PointG2.ProjectivePoint.BASE.multiply(r);
      if (!rP.equals(m)) {
        throw new Error("invalid proof: rP check failed");
      }
      return msg;
    }
    exports.decryptOnG2 = decryptOnG2;
    function gtToHash(gt, len) {
      return sha256_1.sha256.create().update("IBE-H2").update((0, utils_2.fp12ToBytes)(gt)).digest().slice(0, len);
    }
    exports.gtToHash = gtToHash;
    var BitsToMaskForBLS12381 = 1;
    function h3(sigma, msg) {
      const h3ret = sha256_1.sha256.create().update("IBE-H3").update(sigma).update(msg).digest();
      for (let i = 1; i < 65535; i++) {
        let data = h3ret;
        data = sha256_1.sha256.create().update(create16BitUintBuffer(i)).update(data).digest();
        data[0] = data[0] >> BitsToMaskForBLS12381;
        const n = (0, utils_2.bytesToNumberBE)(data);
        if (n < bls12_381_1.bls12_381.fields.Fr.ORDER) {
          return n;
        }
      }
      throw new Error("invalid proof: rP check failed");
    }
    function h4(sigma, len) {
      const h4sigma = sha256_1.sha256.create().update("IBE-H4").update(sigma).digest();
      return h4sigma.slice(0, len);
    }
    function create16BitUintBuffer(input) {
      if (input < 0) {
        throw Error("cannot write a negative value as uint!");
      }
      if (input > 2 ** 16) {
        throw Error("input value too large to fit in a uint16!");
      }
      const buf = buffer_1.Buffer.alloc(2);
      buf.writeUint16LE(input);
      return buf;
    }
  }
});

// node_modules/tlock-js/drand/timelock-encrypter.js
var require_timelock_encrypter = __commonJS({
  "node_modules/tlock-js/drand/timelock-encrypter.js"(exports) {
    "use strict";
    var __createBinding = exports && exports.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __setModuleDefault = exports && exports.__setModuleDefault || (Object.create ? (function(o, v) {
      Object.defineProperty(o, "default", { enumerable: true, value: v });
    }) : function(o, v) {
      o["default"] = v;
    });
    var __importStar = exports && exports.__importStar || function(mod2) {
      if (mod2 && mod2.__esModule) return mod2;
      var result = {};
      if (mod2 != null) {
        for (var k in mod2) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod2, k)) __createBinding(result, mod2, k);
      }
      __setModuleDefault(result, mod2);
      return result;
    };
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.hashedRoundNumber = exports.createTimelockEncrypter = void 0;
    var sha256_1 = require_sha256();
    var buffer_1 = __require("buffer");
    var ibe = __importStar(require_ibe());
    function createTimelockEncrypter(client2, roundNumber) {
      if (roundNumber < 1) {
        throw Error("You cannot encrypt for a roundNumber less than 1 (genesis = 0)");
      }
      return async (fileKey) => {
        const chainInfo = await client2.chain().info();
        const pk = buffer_1.Buffer.from(chainInfo.public_key, "hex");
        const id = hashedRoundNumber(roundNumber);
        let ciphertext;
        switch (chainInfo.schemeID) {
          case "pedersen-bls-unchained":
            {
              ciphertext = await ibe.encryptOnG1(pk, id, fileKey);
            }
            break;
          case "bls-unchained-on-g1":
            {
              ciphertext = await ibe.encryptOnG2(pk, id, fileKey);
            }
            break;
          case "bls-unchained-g1-rfc9380":
            {
              ciphertext = await ibe.encryptOnG2RFC9380(pk, id, fileKey);
            }
            break;
          default:
            throw Error(`Unsupported scheme: ${chainInfo.schemeID} - you must use a drand network with an unchained scheme for timelock encryption!`);
        }
        return [{
          type: "tlock",
          args: [`${roundNumber}`, chainInfo.hash],
          body: serialisedCiphertext(ciphertext)
        }];
      };
    }
    exports.createTimelockEncrypter = createTimelockEncrypter;
    function hashedRoundNumber(round) {
      const roundNumberBuffer = buffer_1.Buffer.alloc(64 / 8);
      roundNumberBuffer.writeBigUInt64BE(BigInt(round));
      return (0, sha256_1.sha256)(roundNumberBuffer);
    }
    exports.hashedRoundNumber = hashedRoundNumber;
    function serialisedCiphertext(ciphertext) {
      return buffer_1.Buffer.concat([ciphertext.U, ciphertext.V, ciphertext.W]);
    }
  }
});

// node_modules/@noble/hashes/hkdf.js
var require_hkdf = __commonJS({
  "node_modules/@noble/hashes/hkdf.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.hkdf = void 0;
    exports.extract = extract;
    exports.expand = expand;
    var hmac_ts_1 = require_hmac();
    var utils_ts_1 = require_utils();
    function extract(hash2, ikm, salt) {
      (0, utils_ts_1.ahash)(hash2);
      if (salt === void 0)
        salt = new Uint8Array(hash2.outputLen);
      return (0, hmac_ts_1.hmac)(hash2, (0, utils_ts_1.toBytes)(salt), (0, utils_ts_1.toBytes)(ikm));
    }
    var HKDF_COUNTER = /* @__PURE__ */ Uint8Array.from([0]);
    var EMPTY_BUFFER = /* @__PURE__ */ Uint8Array.of();
    function expand(hash2, prk, info, length = 32) {
      (0, utils_ts_1.ahash)(hash2);
      (0, utils_ts_1.anumber)(length);
      const olen = hash2.outputLen;
      if (length > 255 * olen)
        throw new Error("Length should be <= 255*HashLen");
      const blocks = Math.ceil(length / olen);
      if (info === void 0)
        info = EMPTY_BUFFER;
      const okm = new Uint8Array(blocks * olen);
      const HMAC = hmac_ts_1.hmac.create(hash2, prk);
      const HMACTmp = HMAC._cloneInto();
      const T = new Uint8Array(HMAC.outputLen);
      for (let counter = 0; counter < blocks; counter++) {
        HKDF_COUNTER[0] = counter + 1;
        HMACTmp.update(counter === 0 ? EMPTY_BUFFER : T).update(info).update(HKDF_COUNTER).digestInto(T);
        okm.set(T, olen * counter);
        HMAC._cloneInto(HMACTmp);
      }
      HMAC.destroy();
      HMACTmp.destroy();
      (0, utils_ts_1.clean)(T, HKDF_COUNTER);
      return okm.slice(0, length);
    }
    var hkdf = (hash2, ikm, salt, info, length) => expand(hash2, extract(hash2, ikm, salt), info, length);
    exports.hkdf = hkdf;
  }
});

// node_modules/@stablelib/int/lib/int.js
var require_int = __commonJS({
  "node_modules/@stablelib/int/lib/int.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    function imulShim(a, b) {
      var ah = a >>> 16 & 65535, al = a & 65535;
      var bh = b >>> 16 & 65535, bl = b & 65535;
      return al * bl + (ah * bl + al * bh << 16 >>> 0) | 0;
    }
    exports.mul = Math.imul || imulShim;
    function add(a, b) {
      return a + b | 0;
    }
    exports.add = add;
    function sub(a, b) {
      return a - b | 0;
    }
    exports.sub = sub;
    function rotl(x, n) {
      return x << n | x >>> 32 - n;
    }
    exports.rotl = rotl;
    function rotr2(x, n) {
      return x << 32 - n | x >>> n;
    }
    exports.rotr = rotr2;
    function isIntegerShim(n) {
      return typeof n === "number" && isFinite(n) && Math.floor(n) === n;
    }
    exports.isInteger = Number.isInteger || isIntegerShim;
    exports.MAX_SAFE_INTEGER = 9007199254740991;
    exports.isSafeInteger = function(n) {
      return exports.isInteger(n) && (n >= -exports.MAX_SAFE_INTEGER && n <= exports.MAX_SAFE_INTEGER);
    };
  }
});

// node_modules/@stablelib/binary/lib/binary.js
var require_binary = __commonJS({
  "node_modules/@stablelib/binary/lib/binary.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var int_1 = require_int();
    function readInt16BE(array, offset) {
      if (offset === void 0) {
        offset = 0;
      }
      return (array[offset + 0] << 8 | array[offset + 1]) << 16 >> 16;
    }
    exports.readInt16BE = readInt16BE;
    function readUint16BE(array, offset) {
      if (offset === void 0) {
        offset = 0;
      }
      return (array[offset + 0] << 8 | array[offset + 1]) >>> 0;
    }
    exports.readUint16BE = readUint16BE;
    function readInt16LE(array, offset) {
      if (offset === void 0) {
        offset = 0;
      }
      return (array[offset + 1] << 8 | array[offset]) << 16 >> 16;
    }
    exports.readInt16LE = readInt16LE;
    function readUint16LE(array, offset) {
      if (offset === void 0) {
        offset = 0;
      }
      return (array[offset + 1] << 8 | array[offset]) >>> 0;
    }
    exports.readUint16LE = readUint16LE;
    function writeUint16BE(value, out, offset) {
      if (out === void 0) {
        out = new Uint8Array(2);
      }
      if (offset === void 0) {
        offset = 0;
      }
      out[offset + 0] = value >>> 8;
      out[offset + 1] = value >>> 0;
      return out;
    }
    exports.writeUint16BE = writeUint16BE;
    exports.writeInt16BE = writeUint16BE;
    function writeUint16LE(value, out, offset) {
      if (out === void 0) {
        out = new Uint8Array(2);
      }
      if (offset === void 0) {
        offset = 0;
      }
      out[offset + 0] = value >>> 0;
      out[offset + 1] = value >>> 8;
      return out;
    }
    exports.writeUint16LE = writeUint16LE;
    exports.writeInt16LE = writeUint16LE;
    function readInt32BE(array, offset) {
      if (offset === void 0) {
        offset = 0;
      }
      return array[offset] << 24 | array[offset + 1] << 16 | array[offset + 2] << 8 | array[offset + 3];
    }
    exports.readInt32BE = readInt32BE;
    function readUint32BE(array, offset) {
      if (offset === void 0) {
        offset = 0;
      }
      return (array[offset] << 24 | array[offset + 1] << 16 | array[offset + 2] << 8 | array[offset + 3]) >>> 0;
    }
    exports.readUint32BE = readUint32BE;
    function readInt32LE(array, offset) {
      if (offset === void 0) {
        offset = 0;
      }
      return array[offset + 3] << 24 | array[offset + 2] << 16 | array[offset + 1] << 8 | array[offset];
    }
    exports.readInt32LE = readInt32LE;
    function readUint32LE(array, offset) {
      if (offset === void 0) {
        offset = 0;
      }
      return (array[offset + 3] << 24 | array[offset + 2] << 16 | array[offset + 1] << 8 | array[offset]) >>> 0;
    }
    exports.readUint32LE = readUint32LE;
    function writeUint32BE(value, out, offset) {
      if (out === void 0) {
        out = new Uint8Array(4);
      }
      if (offset === void 0) {
        offset = 0;
      }
      out[offset + 0] = value >>> 24;
      out[offset + 1] = value >>> 16;
      out[offset + 2] = value >>> 8;
      out[offset + 3] = value >>> 0;
      return out;
    }
    exports.writeUint32BE = writeUint32BE;
    exports.writeInt32BE = writeUint32BE;
    function writeUint32LE(value, out, offset) {
      if (out === void 0) {
        out = new Uint8Array(4);
      }
      if (offset === void 0) {
        offset = 0;
      }
      out[offset + 0] = value >>> 0;
      out[offset + 1] = value >>> 8;
      out[offset + 2] = value >>> 16;
      out[offset + 3] = value >>> 24;
      return out;
    }
    exports.writeUint32LE = writeUint32LE;
    exports.writeInt32LE = writeUint32LE;
    function readInt64BE(array, offset) {
      if (offset === void 0) {
        offset = 0;
      }
      var hi = readInt32BE(array, offset);
      var lo = readInt32BE(array, offset + 4);
      return hi * 4294967296 + lo - (lo >> 31) * 4294967296;
    }
    exports.readInt64BE = readInt64BE;
    function readUint64BE(array, offset) {
      if (offset === void 0) {
        offset = 0;
      }
      var hi = readUint32BE(array, offset);
      var lo = readUint32BE(array, offset + 4);
      return hi * 4294967296 + lo;
    }
    exports.readUint64BE = readUint64BE;
    function readInt64LE(array, offset) {
      if (offset === void 0) {
        offset = 0;
      }
      var lo = readInt32LE(array, offset);
      var hi = readInt32LE(array, offset + 4);
      return hi * 4294967296 + lo - (lo >> 31) * 4294967296;
    }
    exports.readInt64LE = readInt64LE;
    function readUint64LE(array, offset) {
      if (offset === void 0) {
        offset = 0;
      }
      var lo = readUint32LE(array, offset);
      var hi = readUint32LE(array, offset + 4);
      return hi * 4294967296 + lo;
    }
    exports.readUint64LE = readUint64LE;
    function writeUint64BE(value, out, offset) {
      if (out === void 0) {
        out = new Uint8Array(8);
      }
      if (offset === void 0) {
        offset = 0;
      }
      writeUint32BE(value / 4294967296 >>> 0, out, offset);
      writeUint32BE(value >>> 0, out, offset + 4);
      return out;
    }
    exports.writeUint64BE = writeUint64BE;
    exports.writeInt64BE = writeUint64BE;
    function writeUint64LE(value, out, offset) {
      if (out === void 0) {
        out = new Uint8Array(8);
      }
      if (offset === void 0) {
        offset = 0;
      }
      writeUint32LE(value >>> 0, out, offset);
      writeUint32LE(value / 4294967296 >>> 0, out, offset + 4);
      return out;
    }
    exports.writeUint64LE = writeUint64LE;
    exports.writeInt64LE = writeUint64LE;
    function readUintBE(bitLength, array, offset) {
      if (offset === void 0) {
        offset = 0;
      }
      if (bitLength % 8 !== 0) {
        throw new Error("readUintBE supports only bitLengths divisible by 8");
      }
      if (bitLength / 8 > array.length - offset) {
        throw new Error("readUintBE: array is too short for the given bitLength");
      }
      var result = 0;
      var mul = 1;
      for (var i = bitLength / 8 + offset - 1; i >= offset; i--) {
        result += array[i] * mul;
        mul *= 256;
      }
      return result;
    }
    exports.readUintBE = readUintBE;
    function readUintLE(bitLength, array, offset) {
      if (offset === void 0) {
        offset = 0;
      }
      if (bitLength % 8 !== 0) {
        throw new Error("readUintLE supports only bitLengths divisible by 8");
      }
      if (bitLength / 8 > array.length - offset) {
        throw new Error("readUintLE: array is too short for the given bitLength");
      }
      var result = 0;
      var mul = 1;
      for (var i = offset; i < offset + bitLength / 8; i++) {
        result += array[i] * mul;
        mul *= 256;
      }
      return result;
    }
    exports.readUintLE = readUintLE;
    function writeUintBE(bitLength, value, out, offset) {
      if (out === void 0) {
        out = new Uint8Array(bitLength / 8);
      }
      if (offset === void 0) {
        offset = 0;
      }
      if (bitLength % 8 !== 0) {
        throw new Error("writeUintBE supports only bitLengths divisible by 8");
      }
      if (!int_1.isSafeInteger(value)) {
        throw new Error("writeUintBE value must be an integer");
      }
      var div = 1;
      for (var i = bitLength / 8 + offset - 1; i >= offset; i--) {
        out[i] = value / div & 255;
        div *= 256;
      }
      return out;
    }
    exports.writeUintBE = writeUintBE;
    function writeUintLE(bitLength, value, out, offset) {
      if (out === void 0) {
        out = new Uint8Array(bitLength / 8);
      }
      if (offset === void 0) {
        offset = 0;
      }
      if (bitLength % 8 !== 0) {
        throw new Error("writeUintLE supports only bitLengths divisible by 8");
      }
      if (!int_1.isSafeInteger(value)) {
        throw new Error("writeUintLE value must be an integer");
      }
      var div = 1;
      for (var i = offset; i < offset + bitLength / 8; i++) {
        out[i] = value / div & 255;
        div *= 256;
      }
      return out;
    }
    exports.writeUintLE = writeUintLE;
    function readFloat32BE(array, offset) {
      if (offset === void 0) {
        offset = 0;
      }
      var view = new DataView(array.buffer, array.byteOffset, array.byteLength);
      return view.getFloat32(offset);
    }
    exports.readFloat32BE = readFloat32BE;
    function readFloat32LE(array, offset) {
      if (offset === void 0) {
        offset = 0;
      }
      var view = new DataView(array.buffer, array.byteOffset, array.byteLength);
      return view.getFloat32(offset, true);
    }
    exports.readFloat32LE = readFloat32LE;
    function readFloat64BE(array, offset) {
      if (offset === void 0) {
        offset = 0;
      }
      var view = new DataView(array.buffer, array.byteOffset, array.byteLength);
      return view.getFloat64(offset);
    }
    exports.readFloat64BE = readFloat64BE;
    function readFloat64LE(array, offset) {
      if (offset === void 0) {
        offset = 0;
      }
      var view = new DataView(array.buffer, array.byteOffset, array.byteLength);
      return view.getFloat64(offset, true);
    }
    exports.readFloat64LE = readFloat64LE;
    function writeFloat32BE(value, out, offset) {
      if (out === void 0) {
        out = new Uint8Array(4);
      }
      if (offset === void 0) {
        offset = 0;
      }
      var view = new DataView(out.buffer, out.byteOffset, out.byteLength);
      view.setFloat32(offset, value);
      return out;
    }
    exports.writeFloat32BE = writeFloat32BE;
    function writeFloat32LE(value, out, offset) {
      if (out === void 0) {
        out = new Uint8Array(4);
      }
      if (offset === void 0) {
        offset = 0;
      }
      var view = new DataView(out.buffer, out.byteOffset, out.byteLength);
      view.setFloat32(offset, value, true);
      return out;
    }
    exports.writeFloat32LE = writeFloat32LE;
    function writeFloat64BE(value, out, offset) {
      if (out === void 0) {
        out = new Uint8Array(8);
      }
      if (offset === void 0) {
        offset = 0;
      }
      var view = new DataView(out.buffer, out.byteOffset, out.byteLength);
      view.setFloat64(offset, value);
      return out;
    }
    exports.writeFloat64BE = writeFloat64BE;
    function writeFloat64LE(value, out, offset) {
      if (out === void 0) {
        out = new Uint8Array(8);
      }
      if (offset === void 0) {
        offset = 0;
      }
      var view = new DataView(out.buffer, out.byteOffset, out.byteLength);
      view.setFloat64(offset, value, true);
      return out;
    }
    exports.writeFloat64LE = writeFloat64LE;
  }
});

// node_modules/@stablelib/wipe/lib/wipe.js
var require_wipe = __commonJS({
  "node_modules/@stablelib/wipe/lib/wipe.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    function wipe(array) {
      for (var i = 0; i < array.length; i++) {
        array[i] = 0;
      }
      return array;
    }
    exports.wipe = wipe;
  }
});

// node_modules/@stablelib/chacha/lib/chacha.js
var require_chacha = __commonJS({
  "node_modules/@stablelib/chacha/lib/chacha.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var binary_1 = require_binary();
    var wipe_1 = require_wipe();
    var ROUNDS = 20;
    function core(out, input, key) {
      var j0 = 1634760805;
      var j1 = 857760878;
      var j2 = 2036477234;
      var j3 = 1797285236;
      var j4 = key[3] << 24 | key[2] << 16 | key[1] << 8 | key[0];
      var j5 = key[7] << 24 | key[6] << 16 | key[5] << 8 | key[4];
      var j6 = key[11] << 24 | key[10] << 16 | key[9] << 8 | key[8];
      var j7 = key[15] << 24 | key[14] << 16 | key[13] << 8 | key[12];
      var j8 = key[19] << 24 | key[18] << 16 | key[17] << 8 | key[16];
      var j9 = key[23] << 24 | key[22] << 16 | key[21] << 8 | key[20];
      var j10 = key[27] << 24 | key[26] << 16 | key[25] << 8 | key[24];
      var j11 = key[31] << 24 | key[30] << 16 | key[29] << 8 | key[28];
      var j12 = input[3] << 24 | input[2] << 16 | input[1] << 8 | input[0];
      var j13 = input[7] << 24 | input[6] << 16 | input[5] << 8 | input[4];
      var j14 = input[11] << 24 | input[10] << 16 | input[9] << 8 | input[8];
      var j15 = input[15] << 24 | input[14] << 16 | input[13] << 8 | input[12];
      var x0 = j0;
      var x1 = j1;
      var x2 = j2;
      var x3 = j3;
      var x4 = j4;
      var x5 = j5;
      var x6 = j6;
      var x7 = j7;
      var x8 = j8;
      var x9 = j9;
      var x10 = j10;
      var x11 = j11;
      var x12 = j12;
      var x13 = j13;
      var x14 = j14;
      var x15 = j15;
      for (var i = 0; i < ROUNDS; i += 2) {
        x0 = x0 + x4 | 0;
        x12 ^= x0;
        x12 = x12 >>> 32 - 16 | x12 << 16;
        x8 = x8 + x12 | 0;
        x4 ^= x8;
        x4 = x4 >>> 32 - 12 | x4 << 12;
        x1 = x1 + x5 | 0;
        x13 ^= x1;
        x13 = x13 >>> 32 - 16 | x13 << 16;
        x9 = x9 + x13 | 0;
        x5 ^= x9;
        x5 = x5 >>> 32 - 12 | x5 << 12;
        x2 = x2 + x6 | 0;
        x14 ^= x2;
        x14 = x14 >>> 32 - 16 | x14 << 16;
        x10 = x10 + x14 | 0;
        x6 ^= x10;
        x6 = x6 >>> 32 - 12 | x6 << 12;
        x3 = x3 + x7 | 0;
        x15 ^= x3;
        x15 = x15 >>> 32 - 16 | x15 << 16;
        x11 = x11 + x15 | 0;
        x7 ^= x11;
        x7 = x7 >>> 32 - 12 | x7 << 12;
        x2 = x2 + x6 | 0;
        x14 ^= x2;
        x14 = x14 >>> 32 - 8 | x14 << 8;
        x10 = x10 + x14 | 0;
        x6 ^= x10;
        x6 = x6 >>> 32 - 7 | x6 << 7;
        x3 = x3 + x7 | 0;
        x15 ^= x3;
        x15 = x15 >>> 32 - 8 | x15 << 8;
        x11 = x11 + x15 | 0;
        x7 ^= x11;
        x7 = x7 >>> 32 - 7 | x7 << 7;
        x1 = x1 + x5 | 0;
        x13 ^= x1;
        x13 = x13 >>> 32 - 8 | x13 << 8;
        x9 = x9 + x13 | 0;
        x5 ^= x9;
        x5 = x5 >>> 32 - 7 | x5 << 7;
        x0 = x0 + x4 | 0;
        x12 ^= x0;
        x12 = x12 >>> 32 - 8 | x12 << 8;
        x8 = x8 + x12 | 0;
        x4 ^= x8;
        x4 = x4 >>> 32 - 7 | x4 << 7;
        x0 = x0 + x5 | 0;
        x15 ^= x0;
        x15 = x15 >>> 32 - 16 | x15 << 16;
        x10 = x10 + x15 | 0;
        x5 ^= x10;
        x5 = x5 >>> 32 - 12 | x5 << 12;
        x1 = x1 + x6 | 0;
        x12 ^= x1;
        x12 = x12 >>> 32 - 16 | x12 << 16;
        x11 = x11 + x12 | 0;
        x6 ^= x11;
        x6 = x6 >>> 32 - 12 | x6 << 12;
        x2 = x2 + x7 | 0;
        x13 ^= x2;
        x13 = x13 >>> 32 - 16 | x13 << 16;
        x8 = x8 + x13 | 0;
        x7 ^= x8;
        x7 = x7 >>> 32 - 12 | x7 << 12;
        x3 = x3 + x4 | 0;
        x14 ^= x3;
        x14 = x14 >>> 32 - 16 | x14 << 16;
        x9 = x9 + x14 | 0;
        x4 ^= x9;
        x4 = x4 >>> 32 - 12 | x4 << 12;
        x2 = x2 + x7 | 0;
        x13 ^= x2;
        x13 = x13 >>> 32 - 8 | x13 << 8;
        x8 = x8 + x13 | 0;
        x7 ^= x8;
        x7 = x7 >>> 32 - 7 | x7 << 7;
        x3 = x3 + x4 | 0;
        x14 ^= x3;
        x14 = x14 >>> 32 - 8 | x14 << 8;
        x9 = x9 + x14 | 0;
        x4 ^= x9;
        x4 = x4 >>> 32 - 7 | x4 << 7;
        x1 = x1 + x6 | 0;
        x12 ^= x1;
        x12 = x12 >>> 32 - 8 | x12 << 8;
        x11 = x11 + x12 | 0;
        x6 ^= x11;
        x6 = x6 >>> 32 - 7 | x6 << 7;
        x0 = x0 + x5 | 0;
        x15 ^= x0;
        x15 = x15 >>> 32 - 8 | x15 << 8;
        x10 = x10 + x15 | 0;
        x5 ^= x10;
        x5 = x5 >>> 32 - 7 | x5 << 7;
      }
      binary_1.writeUint32LE(x0 + j0 | 0, out, 0);
      binary_1.writeUint32LE(x1 + j1 | 0, out, 4);
      binary_1.writeUint32LE(x2 + j2 | 0, out, 8);
      binary_1.writeUint32LE(x3 + j3 | 0, out, 12);
      binary_1.writeUint32LE(x4 + j4 | 0, out, 16);
      binary_1.writeUint32LE(x5 + j5 | 0, out, 20);
      binary_1.writeUint32LE(x6 + j6 | 0, out, 24);
      binary_1.writeUint32LE(x7 + j7 | 0, out, 28);
      binary_1.writeUint32LE(x8 + j8 | 0, out, 32);
      binary_1.writeUint32LE(x9 + j9 | 0, out, 36);
      binary_1.writeUint32LE(x10 + j10 | 0, out, 40);
      binary_1.writeUint32LE(x11 + j11 | 0, out, 44);
      binary_1.writeUint32LE(x12 + j12 | 0, out, 48);
      binary_1.writeUint32LE(x13 + j13 | 0, out, 52);
      binary_1.writeUint32LE(x14 + j14 | 0, out, 56);
      binary_1.writeUint32LE(x15 + j15 | 0, out, 60);
    }
    function streamXOR(key, nonce, src, dst, nonceInplaceCounterLength) {
      if (nonceInplaceCounterLength === void 0) {
        nonceInplaceCounterLength = 0;
      }
      if (key.length !== 32) {
        throw new Error("ChaCha: key size must be 32 bytes");
      }
      if (dst.length < src.length) {
        throw new Error("ChaCha: destination is shorter than source");
      }
      var nc2;
      var counterLength;
      if (nonceInplaceCounterLength === 0) {
        if (nonce.length !== 8 && nonce.length !== 12) {
          throw new Error("ChaCha nonce must be 8 or 12 bytes");
        }
        nc2 = new Uint8Array(16);
        counterLength = nc2.length - nonce.length;
        nc2.set(nonce, counterLength);
      } else {
        if (nonce.length !== 16) {
          throw new Error("ChaCha nonce with counter must be 16 bytes");
        }
        nc2 = nonce;
        counterLength = nonceInplaceCounterLength;
      }
      var block = new Uint8Array(64);
      for (var i = 0; i < src.length; i += 64) {
        core(block, nc2, key);
        for (var j = i; j < i + 64 && j < src.length; j++) {
          dst[j] = src[j] ^ block[j - i];
        }
        incrementCounter(nc2, 0, counterLength);
      }
      wipe_1.wipe(block);
      if (nonceInplaceCounterLength === 0) {
        wipe_1.wipe(nc2);
      }
      return dst;
    }
    exports.streamXOR = streamXOR;
    function stream(key, nonce, dst, nonceInplaceCounterLength) {
      if (nonceInplaceCounterLength === void 0) {
        nonceInplaceCounterLength = 0;
      }
      wipe_1.wipe(dst);
      return streamXOR(key, nonce, dst, dst, nonceInplaceCounterLength);
    }
    exports.stream = stream;
    function incrementCounter(counter, pos, len) {
      var carry = 1;
      while (len--) {
        carry = carry + (counter[pos] & 255) | 0;
        counter[pos] = carry & 255;
        carry >>>= 8;
        pos++;
      }
      if (carry > 0) {
        throw new Error("ChaCha: counter overflow");
      }
    }
  }
});

// node_modules/@stablelib/constant-time/lib/constant-time.js
var require_constant_time = __commonJS({
  "node_modules/@stablelib/constant-time/lib/constant-time.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    function select(subject, resultIfOne, resultIfZero) {
      return ~(subject - 1) & resultIfOne | subject - 1 & resultIfZero;
    }
    exports.select = select;
    function lessOrEqual(a, b) {
      return (a | 0) - (b | 0) - 1 >>> 31 & 1;
    }
    exports.lessOrEqual = lessOrEqual;
    function compare(a, b) {
      if (a.length !== b.length) {
        return 0;
      }
      var result = 0;
      for (var i = 0; i < a.length; i++) {
        result |= a[i] ^ b[i];
      }
      return 1 & result - 1 >>> 8;
    }
    exports.compare = compare;
    function equal(a, b) {
      if (a.length === 0 || b.length === 0) {
        return false;
      }
      return compare(a, b) !== 0;
    }
    exports.equal = equal;
  }
});

// node_modules/@stablelib/poly1305/lib/poly1305.js
var require_poly1305 = __commonJS({
  "node_modules/@stablelib/poly1305/lib/poly1305.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var constant_time_1 = require_constant_time();
    var wipe_1 = require_wipe();
    exports.DIGEST_LENGTH = 16;
    var Poly1305 = (
      /** @class */
      (function() {
        function Poly13052(key) {
          this.digestLength = exports.DIGEST_LENGTH;
          this._buffer = new Uint8Array(16);
          this._r = new Uint16Array(10);
          this._h = new Uint16Array(10);
          this._pad = new Uint16Array(8);
          this._leftover = 0;
          this._fin = 0;
          this._finished = false;
          var t0 = key[0] | key[1] << 8;
          this._r[0] = t0 & 8191;
          var t1 = key[2] | key[3] << 8;
          this._r[1] = (t0 >>> 13 | t1 << 3) & 8191;
          var t2 = key[4] | key[5] << 8;
          this._r[2] = (t1 >>> 10 | t2 << 6) & 7939;
          var t3 = key[6] | key[7] << 8;
          this._r[3] = (t2 >>> 7 | t3 << 9) & 8191;
          var t4 = key[8] | key[9] << 8;
          this._r[4] = (t3 >>> 4 | t4 << 12) & 255;
          this._r[5] = t4 >>> 1 & 8190;
          var t5 = key[10] | key[11] << 8;
          this._r[6] = (t4 >>> 14 | t5 << 2) & 8191;
          var t6 = key[12] | key[13] << 8;
          this._r[7] = (t5 >>> 11 | t6 << 5) & 8065;
          var t7 = key[14] | key[15] << 8;
          this._r[8] = (t6 >>> 8 | t7 << 8) & 8191;
          this._r[9] = t7 >>> 5 & 127;
          this._pad[0] = key[16] | key[17] << 8;
          this._pad[1] = key[18] | key[19] << 8;
          this._pad[2] = key[20] | key[21] << 8;
          this._pad[3] = key[22] | key[23] << 8;
          this._pad[4] = key[24] | key[25] << 8;
          this._pad[5] = key[26] | key[27] << 8;
          this._pad[6] = key[28] | key[29] << 8;
          this._pad[7] = key[30] | key[31] << 8;
        }
        Poly13052.prototype._blocks = function(m, mpos, bytes) {
          var hibit = this._fin ? 0 : 1 << 11;
          var h0 = this._h[0], h1 = this._h[1], h2 = this._h[2], h3 = this._h[3], h4 = this._h[4], h5 = this._h[5], h6 = this._h[6], h7 = this._h[7], h8 = this._h[8], h9 = this._h[9];
          var r0 = this._r[0], r1 = this._r[1], r2 = this._r[2], r3 = this._r[3], r4 = this._r[4], r5 = this._r[5], r6 = this._r[6], r7 = this._r[7], r8 = this._r[8], r9 = this._r[9];
          while (bytes >= 16) {
            var t0 = m[mpos + 0] | m[mpos + 1] << 8;
            h0 += t0 & 8191;
            var t1 = m[mpos + 2] | m[mpos + 3] << 8;
            h1 += (t0 >>> 13 | t1 << 3) & 8191;
            var t2 = m[mpos + 4] | m[mpos + 5] << 8;
            h2 += (t1 >>> 10 | t2 << 6) & 8191;
            var t3 = m[mpos + 6] | m[mpos + 7] << 8;
            h3 += (t2 >>> 7 | t3 << 9) & 8191;
            var t4 = m[mpos + 8] | m[mpos + 9] << 8;
            h4 += (t3 >>> 4 | t4 << 12) & 8191;
            h5 += t4 >>> 1 & 8191;
            var t5 = m[mpos + 10] | m[mpos + 11] << 8;
            h6 += (t4 >>> 14 | t5 << 2) & 8191;
            var t6 = m[mpos + 12] | m[mpos + 13] << 8;
            h7 += (t5 >>> 11 | t6 << 5) & 8191;
            var t7 = m[mpos + 14] | m[mpos + 15] << 8;
            h8 += (t6 >>> 8 | t7 << 8) & 8191;
            h9 += t7 >>> 5 | hibit;
            var c = 0;
            var d0 = c;
            d0 += h0 * r0;
            d0 += h1 * (5 * r9);
            d0 += h2 * (5 * r8);
            d0 += h3 * (5 * r7);
            d0 += h4 * (5 * r6);
            c = d0 >>> 13;
            d0 &= 8191;
            d0 += h5 * (5 * r5);
            d0 += h6 * (5 * r4);
            d0 += h7 * (5 * r3);
            d0 += h8 * (5 * r2);
            d0 += h9 * (5 * r1);
            c += d0 >>> 13;
            d0 &= 8191;
            var d1 = c;
            d1 += h0 * r1;
            d1 += h1 * r0;
            d1 += h2 * (5 * r9);
            d1 += h3 * (5 * r8);
            d1 += h4 * (5 * r7);
            c = d1 >>> 13;
            d1 &= 8191;
            d1 += h5 * (5 * r6);
            d1 += h6 * (5 * r5);
            d1 += h7 * (5 * r4);
            d1 += h8 * (5 * r3);
            d1 += h9 * (5 * r2);
            c += d1 >>> 13;
            d1 &= 8191;
            var d2 = c;
            d2 += h0 * r2;
            d2 += h1 * r1;
            d2 += h2 * r0;
            d2 += h3 * (5 * r9);
            d2 += h4 * (5 * r8);
            c = d2 >>> 13;
            d2 &= 8191;
            d2 += h5 * (5 * r7);
            d2 += h6 * (5 * r6);
            d2 += h7 * (5 * r5);
            d2 += h8 * (5 * r4);
            d2 += h9 * (5 * r3);
            c += d2 >>> 13;
            d2 &= 8191;
            var d3 = c;
            d3 += h0 * r3;
            d3 += h1 * r2;
            d3 += h2 * r1;
            d3 += h3 * r0;
            d3 += h4 * (5 * r9);
            c = d3 >>> 13;
            d3 &= 8191;
            d3 += h5 * (5 * r8);
            d3 += h6 * (5 * r7);
            d3 += h7 * (5 * r6);
            d3 += h8 * (5 * r5);
            d3 += h9 * (5 * r4);
            c += d3 >>> 13;
            d3 &= 8191;
            var d4 = c;
            d4 += h0 * r4;
            d4 += h1 * r3;
            d4 += h2 * r2;
            d4 += h3 * r1;
            d4 += h4 * r0;
            c = d4 >>> 13;
            d4 &= 8191;
            d4 += h5 * (5 * r9);
            d4 += h6 * (5 * r8);
            d4 += h7 * (5 * r7);
            d4 += h8 * (5 * r6);
            d4 += h9 * (5 * r5);
            c += d4 >>> 13;
            d4 &= 8191;
            var d5 = c;
            d5 += h0 * r5;
            d5 += h1 * r4;
            d5 += h2 * r3;
            d5 += h3 * r2;
            d5 += h4 * r1;
            c = d5 >>> 13;
            d5 &= 8191;
            d5 += h5 * r0;
            d5 += h6 * (5 * r9);
            d5 += h7 * (5 * r8);
            d5 += h8 * (5 * r7);
            d5 += h9 * (5 * r6);
            c += d5 >>> 13;
            d5 &= 8191;
            var d6 = c;
            d6 += h0 * r6;
            d6 += h1 * r5;
            d6 += h2 * r4;
            d6 += h3 * r3;
            d6 += h4 * r2;
            c = d6 >>> 13;
            d6 &= 8191;
            d6 += h5 * r1;
            d6 += h6 * r0;
            d6 += h7 * (5 * r9);
            d6 += h8 * (5 * r8);
            d6 += h9 * (5 * r7);
            c += d6 >>> 13;
            d6 &= 8191;
            var d7 = c;
            d7 += h0 * r7;
            d7 += h1 * r6;
            d7 += h2 * r5;
            d7 += h3 * r4;
            d7 += h4 * r3;
            c = d7 >>> 13;
            d7 &= 8191;
            d7 += h5 * r2;
            d7 += h6 * r1;
            d7 += h7 * r0;
            d7 += h8 * (5 * r9);
            d7 += h9 * (5 * r8);
            c += d7 >>> 13;
            d7 &= 8191;
            var d8 = c;
            d8 += h0 * r8;
            d8 += h1 * r7;
            d8 += h2 * r6;
            d8 += h3 * r5;
            d8 += h4 * r4;
            c = d8 >>> 13;
            d8 &= 8191;
            d8 += h5 * r3;
            d8 += h6 * r2;
            d8 += h7 * r1;
            d8 += h8 * r0;
            d8 += h9 * (5 * r9);
            c += d8 >>> 13;
            d8 &= 8191;
            var d9 = c;
            d9 += h0 * r9;
            d9 += h1 * r8;
            d9 += h2 * r7;
            d9 += h3 * r6;
            d9 += h4 * r5;
            c = d9 >>> 13;
            d9 &= 8191;
            d9 += h5 * r4;
            d9 += h6 * r3;
            d9 += h7 * r2;
            d9 += h8 * r1;
            d9 += h9 * r0;
            c += d9 >>> 13;
            d9 &= 8191;
            c = (c << 2) + c | 0;
            c = c + d0 | 0;
            d0 = c & 8191;
            c = c >>> 13;
            d1 += c;
            h0 = d0;
            h1 = d1;
            h2 = d2;
            h3 = d3;
            h4 = d4;
            h5 = d5;
            h6 = d6;
            h7 = d7;
            h8 = d8;
            h9 = d9;
            mpos += 16;
            bytes -= 16;
          }
          this._h[0] = h0;
          this._h[1] = h1;
          this._h[2] = h2;
          this._h[3] = h3;
          this._h[4] = h4;
          this._h[5] = h5;
          this._h[6] = h6;
          this._h[7] = h7;
          this._h[8] = h8;
          this._h[9] = h9;
        };
        Poly13052.prototype.finish = function(mac, macpos) {
          if (macpos === void 0) {
            macpos = 0;
          }
          var g = new Uint16Array(10);
          var c;
          var mask;
          var f;
          var i;
          if (this._leftover) {
            i = this._leftover;
            this._buffer[i++] = 1;
            for (; i < 16; i++) {
              this._buffer[i] = 0;
            }
            this._fin = 1;
            this._blocks(this._buffer, 0, 16);
          }
          c = this._h[1] >>> 13;
          this._h[1] &= 8191;
          for (i = 2; i < 10; i++) {
            this._h[i] += c;
            c = this._h[i] >>> 13;
            this._h[i] &= 8191;
          }
          this._h[0] += c * 5;
          c = this._h[0] >>> 13;
          this._h[0] &= 8191;
          this._h[1] += c;
          c = this._h[1] >>> 13;
          this._h[1] &= 8191;
          this._h[2] += c;
          g[0] = this._h[0] + 5;
          c = g[0] >>> 13;
          g[0] &= 8191;
          for (i = 1; i < 10; i++) {
            g[i] = this._h[i] + c;
            c = g[i] >>> 13;
            g[i] &= 8191;
          }
          g[9] -= 1 << 13;
          mask = (c ^ 1) - 1;
          for (i = 0; i < 10; i++) {
            g[i] &= mask;
          }
          mask = ~mask;
          for (i = 0; i < 10; i++) {
            this._h[i] = this._h[i] & mask | g[i];
          }
          this._h[0] = (this._h[0] | this._h[1] << 13) & 65535;
          this._h[1] = (this._h[1] >>> 3 | this._h[2] << 10) & 65535;
          this._h[2] = (this._h[2] >>> 6 | this._h[3] << 7) & 65535;
          this._h[3] = (this._h[3] >>> 9 | this._h[4] << 4) & 65535;
          this._h[4] = (this._h[4] >>> 12 | this._h[5] << 1 | this._h[6] << 14) & 65535;
          this._h[5] = (this._h[6] >>> 2 | this._h[7] << 11) & 65535;
          this._h[6] = (this._h[7] >>> 5 | this._h[8] << 8) & 65535;
          this._h[7] = (this._h[8] >>> 8 | this._h[9] << 5) & 65535;
          f = this._h[0] + this._pad[0];
          this._h[0] = f & 65535;
          for (i = 1; i < 8; i++) {
            f = (this._h[i] + this._pad[i] | 0) + (f >>> 16) | 0;
            this._h[i] = f & 65535;
          }
          mac[macpos + 0] = this._h[0] >>> 0;
          mac[macpos + 1] = this._h[0] >>> 8;
          mac[macpos + 2] = this._h[1] >>> 0;
          mac[macpos + 3] = this._h[1] >>> 8;
          mac[macpos + 4] = this._h[2] >>> 0;
          mac[macpos + 5] = this._h[2] >>> 8;
          mac[macpos + 6] = this._h[3] >>> 0;
          mac[macpos + 7] = this._h[3] >>> 8;
          mac[macpos + 8] = this._h[4] >>> 0;
          mac[macpos + 9] = this._h[4] >>> 8;
          mac[macpos + 10] = this._h[5] >>> 0;
          mac[macpos + 11] = this._h[5] >>> 8;
          mac[macpos + 12] = this._h[6] >>> 0;
          mac[macpos + 13] = this._h[6] >>> 8;
          mac[macpos + 14] = this._h[7] >>> 0;
          mac[macpos + 15] = this._h[7] >>> 8;
          this._finished = true;
          return this;
        };
        Poly13052.prototype.update = function(m) {
          var mpos = 0;
          var bytes = m.length;
          var want;
          if (this._leftover) {
            want = 16 - this._leftover;
            if (want > bytes) {
              want = bytes;
            }
            for (var i = 0; i < want; i++) {
              this._buffer[this._leftover + i] = m[mpos + i];
            }
            bytes -= want;
            mpos += want;
            this._leftover += want;
            if (this._leftover < 16) {
              return this;
            }
            this._blocks(this._buffer, 0, 16);
            this._leftover = 0;
          }
          if (bytes >= 16) {
            want = bytes - bytes % 16;
            this._blocks(m, mpos, want);
            mpos += want;
            bytes -= want;
          }
          if (bytes) {
            for (var i = 0; i < bytes; i++) {
              this._buffer[this._leftover + i] = m[mpos + i];
            }
            this._leftover += bytes;
          }
          return this;
        };
        Poly13052.prototype.digest = function() {
          if (this._finished) {
            throw new Error("Poly1305 was finished");
          }
          var mac = new Uint8Array(16);
          this.finish(mac);
          return mac;
        };
        Poly13052.prototype.clean = function() {
          wipe_1.wipe(this._buffer);
          wipe_1.wipe(this._r);
          wipe_1.wipe(this._h);
          wipe_1.wipe(this._pad);
          this._leftover = 0;
          this._fin = 0;
          this._finished = true;
          return this;
        };
        return Poly13052;
      })()
    );
    exports.Poly1305 = Poly1305;
    function oneTimeAuth(key, data) {
      var h = new Poly1305(key);
      h.update(data);
      var digest = h.digest();
      h.clean();
      return digest;
    }
    exports.oneTimeAuth = oneTimeAuth;
    function equal(a, b) {
      if (a.length !== exports.DIGEST_LENGTH || b.length !== exports.DIGEST_LENGTH) {
        return false;
      }
      return constant_time_1.equal(a, b);
    }
    exports.equal = equal;
  }
});

// node_modules/@stablelib/chacha20poly1305/lib/chacha20poly1305.js
var require_chacha20poly1305 = __commonJS({
  "node_modules/@stablelib/chacha20poly1305/lib/chacha20poly1305.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var chacha_1 = require_chacha();
    var poly1305_1 = require_poly1305();
    var wipe_1 = require_wipe();
    var binary_1 = require_binary();
    var constant_time_1 = require_constant_time();
    exports.KEY_LENGTH = 32;
    exports.NONCE_LENGTH = 12;
    exports.TAG_LENGTH = 16;
    var ZEROS = new Uint8Array(16);
    var ChaCha20Poly1305 = (
      /** @class */
      (function() {
        function ChaCha20Poly13052(key) {
          this.nonceLength = exports.NONCE_LENGTH;
          this.tagLength = exports.TAG_LENGTH;
          if (key.length !== exports.KEY_LENGTH) {
            throw new Error("ChaCha20Poly1305 needs 32-byte key");
          }
          this._key = new Uint8Array(key);
        }
        ChaCha20Poly13052.prototype.seal = function(nonce, plaintext, associatedData, dst) {
          if (nonce.length > 16) {
            throw new Error("ChaCha20Poly1305: incorrect nonce length");
          }
          var counter = new Uint8Array(16);
          counter.set(nonce, counter.length - nonce.length);
          var authKey = new Uint8Array(32);
          chacha_1.stream(this._key, counter, authKey, 4);
          var resultLength = plaintext.length + this.tagLength;
          var result;
          if (dst) {
            if (dst.length !== resultLength) {
              throw new Error("ChaCha20Poly1305: incorrect destination length");
            }
            result = dst;
          } else {
            result = new Uint8Array(resultLength);
          }
          chacha_1.streamXOR(this._key, counter, plaintext, result, 4);
          this._authenticate(result.subarray(result.length - this.tagLength, result.length), authKey, result.subarray(0, result.length - this.tagLength), associatedData);
          wipe_1.wipe(counter);
          return result;
        };
        ChaCha20Poly13052.prototype.open = function(nonce, sealed, associatedData, dst) {
          if (nonce.length > 16) {
            throw new Error("ChaCha20Poly1305: incorrect nonce length");
          }
          if (sealed.length < this.tagLength) {
            return null;
          }
          var counter = new Uint8Array(16);
          counter.set(nonce, counter.length - nonce.length);
          var authKey = new Uint8Array(32);
          chacha_1.stream(this._key, counter, authKey, 4);
          var calculatedTag = new Uint8Array(this.tagLength);
          this._authenticate(calculatedTag, authKey, sealed.subarray(0, sealed.length - this.tagLength), associatedData);
          if (!constant_time_1.equal(calculatedTag, sealed.subarray(sealed.length - this.tagLength, sealed.length))) {
            return null;
          }
          var resultLength = sealed.length - this.tagLength;
          var result;
          if (dst) {
            if (dst.length !== resultLength) {
              throw new Error("ChaCha20Poly1305: incorrect destination length");
            }
            result = dst;
          } else {
            result = new Uint8Array(resultLength);
          }
          chacha_1.streamXOR(this._key, counter, sealed.subarray(0, sealed.length - this.tagLength), result, 4);
          wipe_1.wipe(counter);
          return result;
        };
        ChaCha20Poly13052.prototype.clean = function() {
          wipe_1.wipe(this._key);
          return this;
        };
        ChaCha20Poly13052.prototype._authenticate = function(tagOut, authKey, ciphertext, associatedData) {
          var h = new poly1305_1.Poly1305(authKey);
          if (associatedData) {
            h.update(associatedData);
            if (associatedData.length % 16 > 0) {
              h.update(ZEROS.subarray(associatedData.length % 16));
            }
          }
          h.update(ciphertext);
          if (ciphertext.length % 16 > 0) {
            h.update(ZEROS.subarray(ciphertext.length % 16));
          }
          var length = new Uint8Array(8);
          if (associatedData) {
            binary_1.writeUint64LE(associatedData.length, length);
          }
          h.update(length);
          binary_1.writeUint64LE(ciphertext.length, length);
          h.update(length);
          var tag = h.digest();
          for (var i = 0; i < tag.length; i++) {
            tagOut[i] = tag[i];
          }
          h.clean();
          wipe_1.wipe(tag);
          wipe_1.wipe(length);
        };
        return ChaCha20Poly13052;
      })()
    );
    exports.ChaCha20Poly1305 = ChaCha20Poly1305;
  }
});

// node_modules/tlock-js/age/stream-cipher.js
var require_stream_cipher = __commonJS({
  "node_modules/tlock-js/age/stream-cipher.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.STREAM = void 0;
    var chacha20poly1305_1 = require_chacha20poly1305();
    var CHUNK_SIZE = 64 * 1024;
    var TAG_SIZE = 16;
    var ENCRYPTED_CHUNK_SIZE = CHUNK_SIZE + TAG_SIZE;
    var NONCE_SIZE = 12;
    var COUNTER_MAX = Math.pow(2, 32) - 1;
    var STREAM = class _STREAM {
      static seal(plaintext, privateKey) {
        const stream = new _STREAM(privateKey);
        const chunks = Math.ceil(plaintext.length / CHUNK_SIZE);
        const ciphertext = new Uint8Array(plaintext.length + chunks * TAG_SIZE);
        for (let chunk64kb = 1; chunk64kb <= chunks; chunk64kb++) {
          const start = chunk64kb - 1;
          const end = chunk64kb;
          const isLast = chunk64kb === chunks;
          const input = plaintext.slice(start * CHUNK_SIZE, end * CHUNK_SIZE);
          const output = ciphertext.subarray(start * ENCRYPTED_CHUNK_SIZE, end * ENCRYPTED_CHUNK_SIZE);
          stream.encryptChunk(input, isLast, output);
        }
        stream.clear();
        return ciphertext;
      }
      static open(ciphertext, privateKey) {
        const stream = new _STREAM(privateKey);
        const chunks = Math.ceil(ciphertext.length / ENCRYPTED_CHUNK_SIZE);
        const plaintext = new Uint8Array(ciphertext.length - chunks * TAG_SIZE);
        for (let chunk64kb = 1; chunk64kb <= chunks; chunk64kb++) {
          const start = chunk64kb - 1;
          const end = chunk64kb;
          const isLast = chunk64kb === chunks;
          const input = ciphertext.slice(start * ENCRYPTED_CHUNK_SIZE, end * ENCRYPTED_CHUNK_SIZE);
          const output = plaintext.subarray(start * CHUNK_SIZE, end * CHUNK_SIZE);
          stream.decryptChunk(input, isLast, output);
        }
        stream.clear();
        return plaintext;
      }
      constructor(key) {
        this.key = key.slice();
        this.nonce = new Uint8Array(NONCE_SIZE);
        this.nonceView = new DataView(this.nonce.buffer);
        this.counter = 0;
      }
      encryptChunk(chunk, isLast, output) {
        if (chunk.length > CHUNK_SIZE)
          throw new Error("Chunk is too big");
        if (this.nonce[11] === 1)
          throw new Error("Last chunk has been processed");
        if (isLast)
          this.nonce[11] = 1;
        const ciphertext = new chacha20poly1305_1.ChaCha20Poly1305(this.key).seal(this.nonce, chunk);
        output.set(ciphertext);
        this.incrementCounter();
      }
      decryptChunk(chunk, isLast, output) {
        if (chunk.length > ENCRYPTED_CHUNK_SIZE)
          throw new Error("Chunk is too big");
        if (this.nonce[11] === 1)
          throw new Error("Last chunk has been processed");
        if (isLast)
          this.nonce[11] = 1;
        const plaintext = new chacha20poly1305_1.ChaCha20Poly1305(this.key).open(this.nonce, chunk);
        if (plaintext == null) {
          throw Error("Error during decryption!");
        }
        output.set(plaintext);
        this.incrementCounter();
      }
      // Increments Big Endian Uint8Array-based counter.
      // [0, 0, 0] => [0, 0, 1] ... => [0, 0, 255] => [0, 1, 0]
      incrementCounter() {
        if (this.counter == COUNTER_MAX) {
          throw new Error("Stream cipher counter has already hit max value! Aborting to avoid nonce reuse - tlock only supports payloads up to 256TB");
        }
        this.counter += 1;
        this.nonceView.setUint32(7, this.counter, false);
      }
      clear() {
        function clear2(arr) {
          for (let i = 0; i < arr.length; i++) {
            arr[i] = 0;
          }
        }
        clear2(this.key);
        clear2(this.nonce);
        this.counter = 0;
      }
    };
    exports.STREAM = STREAM;
  }
});

// node_modules/tlock-js/age/no-op-encdec.js
var require_no_op_encdec = __commonJS({
  "node_modules/tlock-js/age/no-op-encdec.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.NoOpEncDec = void 0;
    var noOpType = "no-op";
    var NoOpEncDec = class {
      static async wrap(filekey) {
        return [{
          type: noOpType,
          args: [],
          body: filekey
        }];
      }
      static async unwrap(recipients) {
        if (recipients.length !== 1) {
          throw Error("NoOpEncDec only expects a single stanza!");
        }
        if (recipients[0].type !== noOpType) {
          throw Error(`NoOpEncDec expects the type of the stanza to be ${noOpType}`);
        }
        return recipients[0].body;
      }
    };
    exports.NoOpEncDec = NoOpEncDec;
  }
});

// node_modules/tlock-js/age/utils.js
var require_utils5 = __commonJS({
  "node_modules/tlock-js/age/utils.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.sliceUntil = exports.chunked = exports.unpaddedBase64Buffer = exports.unpaddedBase64 = void 0;
    var buffer_1 = __require("buffer");
    function unpaddedBase64(buf) {
      const encodedBuf = buffer_1.Buffer.from(buf).toString("base64");
      let lastIndex = encodedBuf.length - 1;
      while (encodedBuf[lastIndex] === "=") {
        lastIndex--;
      }
      return encodedBuf.slice(0, lastIndex + 1);
    }
    exports.unpaddedBase64 = unpaddedBase64;
    function unpaddedBase64Buffer(buf) {
      return buffer_1.Buffer.from(unpaddedBase64(buf), "base64");
    }
    exports.unpaddedBase64Buffer = unpaddedBase64Buffer;
    function chunked(input, chunkSize, suffix = "") {
      const output = [];
      let currentChunk = "";
      for (let i = 0, chunks = 0; i < input.length; i++) {
        currentChunk += input[i];
        const posInChunk = i - chunks * chunkSize;
        if (posInChunk === chunkSize - 1) {
          output.push(currentChunk + suffix);
          currentChunk = "";
          chunks++;
        } else if (i === input.length - 1) {
          output.push(currentChunk + suffix);
        }
      }
      return output;
    }
    exports.chunked = chunked;
    function sliceUntil(input, searchTerm) {
      let lettersMatched = 0;
      let inputPointer = 0;
      while (inputPointer < input.length && lettersMatched < searchTerm.length) {
        if (input[inputPointer] === searchTerm[lettersMatched]) {
          ++lettersMatched;
        } else if (input[inputPointer] === searchTerm[0]) {
          lettersMatched = 1;
        } else {
          lettersMatched = 0;
        }
        ++inputPointer;
      }
      return input.slice(0, inputPointer);
    }
    exports.sliceUntil = sliceUntil;
  }
});

// node_modules/tlock-js/age/utils-crypto.js
var require_utils_crypto = __commonJS({
  "node_modules/tlock-js/age/utils-crypto.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.random = exports.createMacKey = void 0;
    var hkdf_1 = require_hkdf();
    var sha256_1 = require_sha256();
    var hmac_1 = require_hmac();
    var buffer_1 = __require("buffer");
    function createMacKey(fileKey, macMessage, headerText) {
      const hmacKey = (0, hkdf_1.hkdf)(sha256_1.sha256, fileKey, "", buffer_1.Buffer.from(macMessage, "utf8"), 32);
      return buffer_1.Buffer.from((0, hmac_1.hmac)(sha256_1.sha256, hmacKey, buffer_1.Buffer.from(headerText, "utf8")));
    }
    exports.createMacKey = createMacKey;
    async function random(n) {
      if (typeof window === "object" && "crypto" in window) {
        return window.crypto.getRandomValues(new Uint8Array(n));
      }
      const x = "crypto";
      const bytes = __require(x).randomBytes(n);
      return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    }
    exports.random = random;
  }
});

// node_modules/tlock-js/age/age-reader-writer.js
var require_age_reader_writer = __commonJS({
  "node_modules/tlock-js/age/age-reader-writer.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.readAge = exports.header = exports.writeAge = void 0;
    var buffer_1 = __require("buffer");
    var utils_1 = require_utils5();
    var utils_crypto_1 = require_utils_crypto();
    function writeAge(input) {
      const headerStr = header(input);
      const macKey = mac((0, utils_crypto_1.createMacKey)(input.fileKey, input.headerMacMessage, headerStr));
      const payload = buffer_1.Buffer.from(input.body).toString("binary");
      return `${headerStr} ${macKey}
${payload}`;
    }
    exports.writeAge = writeAge;
    function header(input) {
      return `${input.version}
${recipients(input.recipients)}---`;
    }
    exports.header = header;
    var recipients = (stanzas) => stanzas.map((it) => recipient(it) + "\n");
    var recipient = (stanza) => {
      const type = stanza.type;
      const aggregatedArgs = stanza.args.join(" ");
      const encodedBody = (0, utils_1.unpaddedBase64)(stanza.body);
      const chunkedEncodedBody = (0, utils_1.chunked)(encodedBody, 64).join("\n");
      return `-> ${type} ${aggregatedArgs}
` + chunkedEncodedBody;
    };
    var mac = (macStr) => (0, utils_1.unpaddedBase64)(macStr);
    function readAge(input) {
      const [version, ...lines] = input.split("\n");
      const recipients2 = parseRecipients(lines);
      const macStartingTag = "--- ";
      const macLine = lines.shift();
      if (!macLine || !macLine.startsWith(macStartingTag)) {
        throw Error("Expected mac, but there were no more lines left!");
      }
      const mac2 = buffer_1.Buffer.from(macLine.slice(macStartingTag.length, macLine.length), "base64");
      const ciphertext = buffer_1.Buffer.from(lines.join("\n") ?? "", "binary");
      return {
        header: { version, recipients: recipients2, mac: mac2 },
        body: ciphertext
      };
    }
    exports.readAge = readAge;
    function validateArguments(args) {
      args.forEach((arg) => {
        for (let i = 0; i < arg.length; i++) {
          const charCode = arg.charCodeAt(i);
          if (charCode < 33 || charCode > 126) {
            throw Error(`Invalid character ${arg[i]} in argument ${arg}`);
          }
        }
      });
    }
    function parseRecipients(lines) {
      const recipients2 = [];
      for (let current = peek(lines); current != null && current.startsWith("->"); current = peek(lines)) {
        const [type, ...args] = current.slice(3, current.length).split(" ");
        lines.shift();
        validateArguments(args);
        const body = parseRecipientBody(lines);
        if (!body) {
          throw Error(`expected stanza '${type} to have a body, but it didn't`);
        }
        recipients2.push({ type, args, body: buffer_1.Buffer.from(body, "base64") });
      }
      if (recipients2.length === 0) {
        throw Error("Expected at least one stanza! (beginning with -->)");
      }
      return recipients2;
    }
    function parseRecipientBody(lines) {
      let body = "";
      for (let next = peek(lines); next != null; next = peek(lines)) {
        body += lines.shift();
        if (next.length < 64) {
          break;
        }
      }
      return body;
    }
    function peek(arr) {
      return arr[0];
    }
  }
});

// node_modules/tlock-js/age/age-encrypt-decrypt.js
var require_age_encrypt_decrypt = __commonJS({
  "node_modules/tlock-js/age/age-encrypt-decrypt.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.decryptAge = exports.encryptAge = void 0;
    var hkdf_1 = require_hkdf();
    var sha256_1 = require_sha256();
    var stream_cipher_1 = require_stream_cipher();
    var no_op_encdec_1 = require_no_op_encdec();
    var age_reader_writer_1 = require_age_reader_writer();
    var utils_1 = require_utils5();
    var utils_crypto_1 = require_utils_crypto();
    var buffer_1 = __require("buffer");
    var ageVersion = "age-encryption.org/v1";
    var headerMacMessage = "header";
    var hkdfBodyMessage = "payload";
    var fileKeyLengthBytes = 16;
    var bodyHkdfNonceLengthBytes = 16;
    var hkdfKeyLengthBytes = 32;
    async function encryptAge(plaintext, wrapFileKey = no_op_encdec_1.NoOpEncDec.wrap) {
      const fileKey = await (0, utils_crypto_1.random)(fileKeyLengthBytes);
      const recipients = await wrapFileKey(fileKey);
      const body = await encryptedPayload(fileKey, plaintext);
      return (0, age_reader_writer_1.writeAge)({
        fileKey,
        version: ageVersion,
        recipients,
        headerMacMessage,
        body
      });
    }
    exports.encryptAge = encryptAge;
    async function encryptedPayload(fileKey, payload) {
      const nonce = await (0, utils_crypto_1.random)(bodyHkdfNonceLengthBytes);
      const hkdfKey = (0, hkdf_1.hkdf)(sha256_1.sha256, fileKey, nonce, buffer_1.Buffer.from(hkdfBodyMessage, "utf8"), hkdfKeyLengthBytes);
      const ciphertext = stream_cipher_1.STREAM.seal(payload, hkdfKey);
      return buffer_1.Buffer.concat([nonce, ciphertext]);
    }
    async function decryptAge(payload, unwrapFileKey = no_op_encdec_1.NoOpEncDec.unwrap) {
      const encryptedPayload2 = (0, age_reader_writer_1.readAge)(payload);
      const version = encryptedPayload2.header.version;
      if (version !== ageVersion) {
        throw Error(`The payload version ${version} is not supported, only ${ageVersion}`);
      }
      const fileKey = await unwrapFileKey(encryptedPayload2.header.recipients);
      const header = (0, utils_1.sliceUntil)(payload, "---");
      const expectedMac = (0, utils_1.unpaddedBase64Buffer)((0, utils_crypto_1.createMacKey)(fileKey, headerMacMessage, header));
      const actualMac = encryptedPayload2.header.mac;
      if (buffer_1.Buffer.compare(actualMac, expectedMac) !== 0) {
        throw Error("The MAC did not validate for the fileKey and payload!");
      }
      const nonce = buffer_1.Buffer.from(encryptedPayload2.body.slice(0, bodyHkdfNonceLengthBytes));
      const cipherText = encryptedPayload2.body.slice(bodyHkdfNonceLengthBytes);
      const hkdfKey = (0, hkdf_1.hkdf)(sha256_1.sha256, fileKey, nonce, buffer_1.Buffer.from(hkdfBodyMessage, "utf8"), hkdfKeyLengthBytes);
      const plaintext = stream_cipher_1.STREAM.open(cipherText, hkdfKey);
      return buffer_1.Buffer.from(plaintext);
    }
    exports.decryptAge = decryptAge;
  }
});

// node_modules/tlock-js/age/armor.js
var require_armor = __commonJS({
  "node_modules/tlock-js/age/armor.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.isProbablyArmored = exports.decodeArmor = exports.encodeArmor = void 0;
    var buffer_1 = __require("buffer");
    var utils_1 = require_utils5();
    var header = "-----BEGIN AGE ENCRYPTED FILE-----";
    var footer = "-----END AGE ENCRYPTED FILE-----";
    function encodeArmor(input, chunkSize = 64) {
      const base64Input = buffer_1.Buffer.from(input, "binary").toString("base64");
      const columnisedInput = (0, utils_1.chunked)(base64Input, chunkSize).join("\n");
      let paddedFooter = footer;
      if (columnisedInput.length > 0 && columnisedInput[columnisedInput.length - 1].length === 64) {
        paddedFooter = "\n" + footer;
      }
      return `${header}
${columnisedInput}
${paddedFooter}
`;
    }
    exports.encodeArmor = encodeArmor;
    function decodeArmor(armor, chunkSize = 64) {
      armor = armor.trimStart();
      const lengthBeforeEndTrim = armor.length;
      armor = armor.trimEnd();
      const lengthAfterTrim = armor.length;
      const trimmedWhitespace = lengthBeforeEndTrim - lengthAfterTrim;
      if (trimmedWhitespace > 1024) {
        throw Error("too much whitespace at the end of the armor payload");
      }
      if (!armor.startsWith(header)) {
        throw Error(`Armor cannot be decoded if it does not start with a header! i.e. ${header}`);
      }
      if (!armor.endsWith(footer)) {
        throw Error(`Armor cannot be decoded if it does not end with a footer! i.e. ${footer}`);
      }
      const base64Payload = armor.slice(header.length, armor.length - footer.length);
      const lines = base64Payload.split("\n");
      if (lines.some((line) => line.length > chunkSize)) {
        throw Error(`Armor to decode cannot have lines longer than ${chunkSize} (configurable) in order to stop padding attacks`);
      }
      if (lines[lines.length - 1].length >= chunkSize) {
        throw Error(`The last line of an armored payload must be less than ${chunkSize} (configurable) to stop padding attacks`);
      }
      return buffer_1.Buffer.from(base64Payload, "base64").toString("binary");
    }
    exports.decodeArmor = decodeArmor;
    function isProbablyArmored(input) {
      return input.startsWith(header);
    }
    exports.isProbablyArmored = isProbablyArmored;
  }
});

// node_modules/tlock-js/drand/timelock-decrypter.js
var require_timelock_decrypter = __commonJS({
  "node_modules/tlock-js/drand/timelock-decrypter.js"(exports) {
    "use strict";
    var __createBinding = exports && exports.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __setModuleDefault = exports && exports.__setModuleDefault || (Object.create ? (function(o, v) {
      Object.defineProperty(o, "default", { enumerable: true, value: v });
    }) : function(o, v) {
      o["default"] = v;
    });
    var __importStar = exports && exports.__importStar || function(mod2) {
      if (mod2 && mod2.__esModule) return mod2;
      var result = {};
      if (mod2 != null) {
        for (var k in mod2) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod2, k)) __createBinding(result, mod2, k);
      }
      __setModuleDefault(result, mod2);
      return result;
    };
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.createTimelockDecrypter = void 0;
    var buffer_1 = __require("buffer");
    var drand_client_1 = require_drand_client();
    var ibe = __importStar(require_ibe());
    var bls12_381_1 = require_bls12_381();
    function createTimelockDecrypter(network) {
      return async (recipients) => {
        const tlockStanza = recipients.find((it) => it.type === "tlock");
        if (!tlockStanza) {
          throw Error("You must pass a timelock stanza!");
        }
        const { type, args, body } = tlockStanza;
        if (type !== "tlock") {
          throw Error(`Timelock expects the type of the stanza to be "tlock`);
        }
        if (args.length !== 2) {
          throw Error(`Timelock stanza expected 2 args: roundNumber and chainHash. Only received ${args.length}`);
        }
        const chainInfo = await network.chain().info();
        const roundNumber = parseRoundNumber(args);
        if ((0, drand_client_1.roundTime)(chainInfo, roundNumber) > Date.now()) {
          throw Error(`It's too early to decrypt the ciphertext - decryptable at round ${roundNumber}`);
        }
        const beacon = await (0, drand_client_1.fetchBeacon)(network, roundNumber);
        console.log(`beacon received: ${JSON.stringify(beacon)}`);
        switch (chainInfo.schemeID) {
          case "pedersen-bls-unchained": {
            const ciphertext = parseCiphertext(body, bls12_381_1.bls12_381.G1.ProjectivePoint.BASE);
            return await ibe.decryptOnG1(buffer_1.Buffer.from(beacon.signature, "hex"), ciphertext);
          }
          case "bls-unchained-on-g1": {
            const ciphertext = parseCiphertext(body, bls12_381_1.bls12_381.G2.ProjectivePoint.BASE);
            return await ibe.decryptOnG2(buffer_1.Buffer.from(beacon.signature, "hex"), ciphertext);
          }
          case "bls-unchained-g1-rfc9380": {
            const ciphertext = parseCiphertext(body, bls12_381_1.bls12_381.G2.ProjectivePoint.BASE);
            return await ibe.decryptOnG2(buffer_1.Buffer.from(beacon.signature, "hex"), ciphertext);
          }
          default:
            throw Error(`Unsupported scheme: ${chainInfo.schemeID} - you must use a drand network with an unchained scheme for timelock decryption!`);
        }
      };
      function parseRoundNumber(args) {
        const [roundNumber] = args;
        const roundNumberParsed = Number.parseInt(roundNumber);
        if (roundNumberParsed !== roundNumberParsed) {
          throw Error(`Expected the roundNumber arg to be a number, but it was ${roundNumber}!`);
        }
        return roundNumberParsed;
      }
      function parseCiphertext(body, base) {
        const pointLength = base.toRawBytes(true).byteLength;
        const pointBytes = body.subarray(0, pointLength);
        const theRest = body.subarray(pointLength);
        const eachHalf = theRest.length / 2;
        const U = pointBytes;
        const V = theRest.subarray(0, eachHalf);
        const W = theRest.subarray(eachHalf);
        return { U, V, W };
      }
    }
    exports.createTimelockDecrypter = createTimelockDecrypter;
  }
});

// node_modules/tlock-js/drand/defaults.js
var require_defaults = __commonJS({
  "node_modules/tlock-js/drand/defaults.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.TESTNET_CHAIN_INFO = exports.TESTNET_CHAIN_URL = exports.defaultChainInfo = exports.defaultChainUrl = exports.MAINNET_CHAIN_INFO_NON_RFC = exports.MAINNET_CHAIN_URL_NON_RFC = exports.MAINNET_CHAIN_INFO = exports.MAINNET_CHAIN_URL = void 0;
    exports.MAINNET_CHAIN_URL = "https://api.drand.sh/52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971";
    exports.MAINNET_CHAIN_INFO = {
      public_key: "83cf0f2896adee7eb8b5f01fcad3912212c437e0073e911fb90022d3e760183c8c4b450b6a0a6c3ac6a5776a2d1064510d1fec758c921cc22b0e17e63aaf4bcb5ed66304de9cf809bd274ca73bab4af5a6e9c76a4bc09e76eae8991ef5ece45a",
      period: 3,
      genesis_time: 1692803367,
      hash: "52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971",
      groupHash: "f477d5c89f21a17c863a7f937c6a6d15859414d2be09cd448d4279af331c5d3e",
      schemeID: "bls-unchained-g1-rfc9380",
      metadata: {
        beaconID: "quicknet"
      }
    };
    exports.MAINNET_CHAIN_URL_NON_RFC = "https://api.drand.sh/dbd506d6ef76e5f386f41c651dcb808c5bcbd75471cc4eafa3f4df7ad4e4c493";
    exports.MAINNET_CHAIN_INFO_NON_RFC = {
      hash: "dbd506d6ef76e5f386f41c651dcb808c5bcbd75471cc4eafa3f4df7ad4e4c493",
      public_key: "a0b862a7527fee3a731bcb59280ab6abd62d5c0b6ea03dc4ddf6612fdfc9d01f01c31542541771903475eb1ec6615f8d0df0b8b6dce385811d6dcf8cbefb8759e5e616a3dfd054c928940766d9a5b9db91e3b697e5d70a975181e007f87fca5e",
      period: 3,
      genesis_time: 1677685200,
      groupHash: "a81e9d63f614ccdb144b8ff79fbd4d5a2d22055c0bfe4ee9a8092003dab1c6c0",
      schemeID: "bls-unchained-on-g1",
      metadata: {
        beaconID: "fastnet"
      }
    };
    exports.defaultChainUrl = exports.MAINNET_CHAIN_URL;
    exports.defaultChainInfo = exports.MAINNET_CHAIN_INFO;
    exports.TESTNET_CHAIN_URL = "https://pl-us.testnet.drand.sh/7672797f548f3f4748ac4bf3352fc6c6b6468c9ad40ad456a397545c6e2df5bf";
    exports.TESTNET_CHAIN_INFO = {
      hash: "7672797f548f3f4748ac4bf3352fc6c6b6468c9ad40ad456a397545c6e2df5bf",
      public_key: "8200fc249deb0148eb918d6e213980c5d01acd7fc251900d9260136da3b54836ce125172399ddc69c4e3e11429b62c11",
      genesis_time: 1651677099,
      period: 3,
      schemeID: "pedersen-bls-unchained",
      groupHash: "65083634d852ae169e21b6ce5f0410be9ed4cc679b9970236f7875cff667e13d",
      metadata: {
        beaconID: "testnet-unchained-3s"
      }
    };
  }
});

// node_modules/tlock-js/version.js
var require_version2 = __commonJS({
  "node_modules/tlock-js/version.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.LIB_VERSION = void 0;
    exports.LIB_VERSION = "0.9.0";
  }
});

// node_modules/tlock-js/index.js
var require_tlock_js = __commonJS({
  "node_modules/tlock-js/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.Buffer = exports.roundAt = exports.roundTime = exports.defaultChainUrl = exports.defaultChainInfo = exports.HttpCachingChain = exports.HttpChainClient = exports.nonRFCMainnetClient = exports.mainnetClient = exports.testnetClient = exports.timelockDecrypt = exports.timelockEncrypt = void 0;
    var drand_client_1 = require_drand_client();
    Object.defineProperty(exports, "HttpChainClient", { enumerable: true, get: function() {
      return drand_client_1.HttpChainClient;
    } });
    Object.defineProperty(exports, "HttpCachingChain", { enumerable: true, get: function() {
      return drand_client_1.HttpCachingChain;
    } });
    Object.defineProperty(exports, "roundTime", { enumerable: true, get: function() {
      return drand_client_1.roundTime;
    } });
    Object.defineProperty(exports, "roundAt", { enumerable: true, get: function() {
      return drand_client_1.roundAt;
    } });
    var buffer_1 = __require("buffer");
    Object.defineProperty(exports, "Buffer", { enumerable: true, get: function() {
      return buffer_1.Buffer;
    } });
    var timelock_encrypter_1 = require_timelock_encrypter();
    var age_encrypt_decrypt_1 = require_age_encrypt_decrypt();
    var armor_1 = require_armor();
    var timelock_decrypter_1 = require_timelock_decrypter();
    var defaults_1 = require_defaults();
    Object.defineProperty(exports, "defaultChainInfo", { enumerable: true, get: function() {
      return defaults_1.defaultChainInfo;
    } });
    Object.defineProperty(exports, "defaultChainUrl", { enumerable: true, get: function() {
      return defaults_1.defaultChainUrl;
    } });
    var version_1 = require_version2();
    async function timelockEncrypt(roundNumber, payload, chainClient) {
      const timelockEncrypter = (0, timelock_encrypter_1.createTimelockEncrypter)(chainClient, roundNumber);
      const agePayload = await (0, age_encrypt_decrypt_1.encryptAge)(payload, timelockEncrypter);
      return (0, armor_1.encodeArmor)(agePayload);
    }
    exports.timelockEncrypt = timelockEncrypt;
    async function timelockDecrypt2(ciphertext, chainClient) {
      const timelockDecrypter = (0, timelock_decrypter_1.createTimelockDecrypter)(chainClient);
      let cipher = ciphertext;
      if ((0, armor_1.isProbablyArmored)(ciphertext)) {
        cipher = (0, armor_1.decodeArmor)(cipher);
      }
      return await (0, age_encrypt_decrypt_1.decryptAge)(cipher, timelockDecrypter);
    }
    exports.timelockDecrypt = timelockDecrypt2;
    var userAgentOpts = {
      userAgent: `tlock-js-${version_1.LIB_VERSION}`
    };
    function testnetClient() {
      const opts = {
        ...drand_client_1.defaultChainOptions,
        chainVerificationParams: {
          chainHash: defaults_1.TESTNET_CHAIN_INFO.hash,
          publicKey: defaults_1.TESTNET_CHAIN_INFO.public_key
        }
      };
      const chain = new drand_client_1.HttpCachingChain(defaults_1.TESTNET_CHAIN_URL, opts);
      return new drand_client_1.HttpChainClient(chain, opts, userAgentOpts);
    }
    exports.testnetClient = testnetClient;
    function mainnetClient() {
      const opts = {
        ...drand_client_1.defaultChainOptions,
        chainVerificationParams: {
          chainHash: "52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971",
          publicKey: "83cf0f2896adee7eb8b5f01fcad3912212c437e0073e911fb90022d3e760183c8c4b450b6a0a6c3ac6a5776a2d1064510d1fec758c921cc22b0e17e63aaf4bcb5ed66304de9cf809bd274ca73bab4af5a6e9c76a4bc09e76eae8991ef5ece45a"
        }
      };
      const chain = new drand_client_1.HttpCachingChain(defaults_1.MAINNET_CHAIN_URL, opts);
      return new drand_client_1.HttpChainClient(chain, opts, userAgentOpts);
    }
    exports.mainnetClient = mainnetClient;
    function nonRFCMainnetClient() {
      const opts = {
        ...drand_client_1.defaultChainOptions,
        chainVerificationParams: {
          chainHash: "dbd506d6ef76e5f386f41c651dcb808c5bcbd75471cc4eafa3f4df7ad4e4c493",
          publicKey: "a0b862a7527fee3a731bcb59280ab6abd62d5c0b6ea03dc4ddf6612fdfc9d01f01c31542541771903475eb1ec6615f8d0df0b8b6dce385811d6dcf8cbefb8759e5e616a3dfd054c928940766d9a5b9db91e3b697e5d70a975181e007f87fca5e"
        }
      };
      const chain = new drand_client_1.HttpCachingChain(defaults_1.MAINNET_CHAIN_URL_NON_RFC, opts);
      return new drand_client_1.HttpChainClient(chain, opts, userAgentOpts);
    }
    exports.nonRFCMainnetClient = nonRFCMainnetClient;
  }
});

// cli/commands/verify.ts
var import_beacon_verification = __toESM(require_beacon_verification(), 1);

// manifest/schema.ts
import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
var QUICKNET = {
  chain_hash: "52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971",
  public_key: "83cf0f2896adee7eb8b5f01fcad3912212c437e0073e911fb90022d3e760183c8c4b450b6a0a6c3ac6a5776a2d1064510d1fec758c921cc22b0e17e63aaf4bcb5ed66304de9cf809bd274ca73bab4af5a6e9c76a4bc09e76eae8991ef5ece45a",
  scheme: "bls-unchained-g1-rfc9380",
  genesis: 1692803367,
  period: 3
};
var hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
var requireThat = (ok, reason) => {
  if (!ok) throw new Error(`refused: ${reason}`);
};
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
  requireThat(value !== void 0 && (typeof value !== "number" || Number.isFinite(value)), "non-JSON value");
  return JSON.stringify(value);
}
var jsonBytes = (value) => Buffer.from(canonical(value) + "\n");
function zats(value, name) {
  requireThat(typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value), `${name} must be decimal zatoshis`);
  const n = BigInt(value);
  requireThat(n <= 2100000000000000n, `${name} exceeds money range`);
  return n;
}
function integer(n, name, min = 1, max = 2 ** 32 - 1) {
  requireThat(Number.isSafeInteger(n) && n >= min && n <= max, `${name} is out of range`);
}
function keys(object, expected) {
  requireThat(object && typeof object === "object" && !Array.isArray(object), "expected object");
  requireThat(Object.keys(object).sort().join(",") === expected.split(" ").sort().join(","), "unknown or missing manifest field");
}
function validateManifest(m) {
  requireThat(m.witness_set_hash === void 0 || typeof m.witness_set_hash === "string" && /^[0-9a-f]{64}$/.test(m.witness_set_hash), "witness_set_hash");
  requireThat(m.envelope_keys === void 0 || Array.isArray(m.envelope_keys) && m.envelope_keys.length === 3 && m.envelope_keys.every((k) => typeof k === "string" && /^[0-9a-f]{64}$/.test(k)) && new Set(m.envelope_keys).size === 3, "envelope_keys");
  requireThat(m.bond === void 0 || m.bond && typeof m.bond === "object" && !Array.isArray(m.bond) && Object.keys(m.bond).sort().join(",") === "balance_window_blocks,bond_bps" && Number.isSafeInteger(m.bond.bond_bps) && m.bond.bond_bps >= 1 && m.bond.bond_bps <= 1e4 && Number.isSafeInteger(m.bond.balance_window_blocks) && m.bond.balance_window_blocks >= 1, "bond");
  requireThat(m.sealed_reserve === void 0 || typeof m.sealed_reserve === "string" && /^[0-9a-f]+$/.test(m.sealed_reserve) && m.sealed_reserve.length % 2 === 0 && m.sealed_reserve.length >= 96 && m.sealed_reserve.length <= 4096, "sealed_reserve");
  requireThat(m.lots === void 0 || Array.isArray(m.lots) && m.lots.length >= 2 && m.lots.every((l) => /^[0-9a-f]{64}$/.test(l)) && new Set(m.lots).size === m.lots.length, "lots");
  requireThat(m.series === void 0 || m.series && typeof m.series === "object" && !Array.isArray(m.series) && Object.keys(m.series).sort().join(",") === "previous_result_hash,round_index,series_id" && /^[0-9a-f]{64}$/.test(m.series.series_id) && Number.isSafeInteger(m.series.round_index) && m.series.round_index >= 1 && (m.series.previous_result_hash === null ? m.series.round_index === 1 : m.series.round_index > 1 && /^[0-9a-f]{64}$/.test(m.series.previous_result_hash)), "series");
  if (m.serials !== void 0) {
    keys(m.serials, "first count seed_round_offset");
    integer(m.serials.first, "serial first", 0);
    integer(m.serials.count, "serial count");
    integer(m.serials.seed_round_offset, "serial seed offset");
    requireThat(m.clearing.mode === "uniform" && m.lots !== void 0, "serials require multi-lot uniform auction");
    requireThat(Number.isSafeInteger(m.serials.first + m.serials.count - 1) && Number.isSafeInteger(m.drand.R + m.serials.seed_round_offset), "serial range/round overflow");
  }
  const base = { ...m };
  delete base.witness_set_hash;
  delete base.envelope_keys;
  delete base.bond;
  delete base.sealed_reserve;
  delete base.lots;
  delete base.series;
  delete base.serials;
  keys(base, ["version", "network", "auction_id", "escrow_ua", "frost_group_key", "supply", "reserve_zats", "tick_zats", "B_max_zats", "q_max", "C_zats", "fee_zats", "deposit_addresses", "drand", "T_submit", "T_freeze", "confirmations", "clearing", "refund", "freeze"].concat(m.lots === void 0 ? ["lot"] : []).join(" "));
  requireThat(m.version === 1 && m.network === "test", "manifest version/network");
  requireThat(/^[0-9a-f]{64}$/.test(m.auction_id) && /^[0-9a-f]{64}$/.test(m.frost_group_key), "auction/group key");
  requireThat(m.lots !== void 0 || typeof m.lot === "string" && m.lot.length > 0 && m.lot.length <= 256, "lot");
  requireThat(/^utest1[a-z0-9]+$/.test(m.escrow_ua), "testnet escrow address");
  requireThat(Array.isArray(m.deposit_addresses) && m.deposit_addresses.length > 0 && m.deposit_addresses.every((a) => /^utest1[a-z0-9]+$/.test(a)) && new Set(m.deposit_addresses).size === m.deposit_addresses.length, "per-bid addresses");
  integer(m.supply, "supply");
  integer(m.q_max, "q_max");
  const reserve = zats(m.reserve_zats, "reserve"), tick = zats(m.tick_zats, "tick"), cap = zats(m.B_max_zats, "B_max");
  const C = zats(m.C_zats, "C"), fee = zats(m.fee_zats, "fee");
  requireThat(tick > 0n && reserve <= cap && reserve % tick === 0n && cap % tick === 0n && fee < C, "collateral/caps/tick/fee");
  if (m.bond !== void 0) requireThat(C * 10000n === BigInt(m.bond.bond_bps) * cap, "bond C/cap");
  else requireThat(C >= BigInt(m.q_max) * cap + fee, "collateral/caps/tick/fee");
  keys(m.drand, "chain_hash public_key scheme genesis period R");
  for (const k of Object.keys(QUICKNET))
    requireThat(m.drand[k] === QUICKNET[k], `quicknet ${k}`);
  integer(m.drand.R, "R", 1, Number.MAX_SAFE_INTEGER);
  integer(m.T_submit, "T_submit", 1, Number.MAX_SAFE_INTEGER);
  integer(m.T_freeze, "T_freeze", 1, Number.MAX_SAFE_INTEGER);
  requireThat(m.T_submit < m.T_freeze && m.T_freeze - m.T_submit >= 750 && m.T_freeze < QUICKNET.genesis + (m.drand.R - 1) * QUICKNET.period, "submit/freeze/release ordering or confirmation buffer");
  requireThat(m.confirmations === 10 && m.freeze === "merkle_root_v1", "confirmations/freeze");
  keys(m.clearing, "mode band dust tie minimum_fill");
  requireThat(m.clearing.mode === "uniform" || m.clearing.mode === "vickrey" && m.supply === 1, "clearing mode/supply");
  requireThat(m.clearing.band === "floor_pro_rata_units" && m.clearing.dust === "ascending_leaf_index" && m.clearing.tie === "ascending_leaf_index", "clearing rules");
  integer(m.clearing.minimum_fill, "minimum fill", 1, m.supply);
  keys(m.refund, "invalid reorg cancel");
  requireThat(["full_C", "C_minus_fee"].includes(m.refund.invalid) && m.refund.reorg === "C_minus_fee_remove_leaf" && m.refund.cancel === "full_C", "refund policies");
}
function signingBytes(bytes) {
  return bytes;
}
function verifyRecord(packet, trustedSigner) {
  requireThat(packet && /^[0-9a-f]{88}$/.test(trustedSigner) && packet.signer === trustedSigner, "untrusted manifest/receipt signer");
  requireThat(typeof packet.bytes === "string" && /^[A-Za-z0-9+/]+={0,2}$/.test(packet.bytes), "manifest bytes");
  const bytes = Buffer.from(packet.bytes, "base64");
  requireThat(bytes.toString("base64") === packet.bytes && hash(bytes) === packet.sha256, "manifest byte hash");
  requireThat(/^[0-9a-f]{128}$/.test(packet.signature), "manifest signature length");
  const key = createPublicKey({ key: Buffer.from(trustedSigner, "hex"), type: "spki", format: "der" });
  requireThat(key.asymmetricKeyType === "ed25519" && verify(null, signingBytes(bytes), key, Buffer.from(packet.signature, "hex")), "manifest signature");
  const value = JSON.parse(bytes.toString("utf8"));
  requireThat(jsonBytes(value).equals(bytes), "noncanonical manifest/receipt bytes");
  return value;
}
function client(packet, trustedSigner) {
  const manifest = verifyRecord(packet, trustedSigner);
  validateManifest(manifest);
  return { manifest_hash: hash(Buffer.from(packet.bytes, "base64")), manifest };
}

// manifest/reserve.ts
import { spawnSync } from "node:child_process";
function tleOpening(tleBin, chainHash, ciphertextHex) {
  const r = spawnSync(
    tleBin,
    ["-d", "-c", chainHash],
    { input: Buffer.from(ciphertextHex, "hex"), maxBuffer: 1 << 20 }
  );
  if (r.error) throw r.error;
  if (r.status === 0) return r.stdout.toString("hex");
  const error = r.stderr.toString().trim();
  if (/bad header MAC|failed to decrypt and authenticate payload chunk/.test(error)) return null;
  throw new Error(`tle: ${error || `exit ${r.status}`}`);
}
function requireReserveOpening(m, publishedOpening, derived, tleDerived) {
  if (m.sealed_reserve === void 0) {
    requireThat(publishedOpening === null || publishedOpening === void 0, "reserve opening without sealed reserve");
    return null;
  }
  requireThat(derived !== null && publishedOpening === derived, "reserve opening published differs from re-derived");
  if (tleDerived !== void 0) requireThat(tleDerived === derived, "reserve opening tle differs");
  return derived;
}

// api/missing-deposits.ts
import { existsSync as existsSync2, readFileSync as readFileSync2 } from "node:fs";
import path2 from "node:path";

// clear/merkle.ts
var leafHash = (ciphertextHash, deposit) => hash(Buffer.concat([Buffer.from([0]), Buffer.from(ciphertextHash, "hex"), jsonBytes(deposit)]));
var parent = (left, right) => hash(Buffer.concat([Buffer.from([1]), Buffer.from(left, "hex"), Buffer.from(right, "hex")]));
function tree(leaves) {
  const levels = [leaves.map((l) => leafHash(l.ciphertext_hash, l.deposit))];
  while (levels[levels.length - 1].length > 1) {
    const level = levels[levels.length - 1], next = [];
    for (let i = 0; i < level.length; i += 2) next.push(parent(level[i], level[i + 1] ?? level[i]));
    levels.push(next);
  }
  const paths = leaves.map((_, index) => {
    const path5 = [];
    for (const level of levels.slice(0, -1)) {
      path5.push({ side: index % 2 ? "left" : "right", hash: level[index ^ 1] ?? level[index] });
      index = Math.floor(index / 2);
    }
    return path5;
  });
  return { root: levels[levels.length - 1][0] ?? hash(Buffer.from([2])), paths };
}
function member(ciphertextHash, deposit, index, count, path5, root) {
  if (!/^[0-9a-f]{64}$/.test(ciphertextHash) || !Number.isInteger(index) || index < 0 || index >= count || path5.length !== Math.ceil(Math.log2(count))) return false;
  let node = leafHash(ciphertextHash, deposit);
  for (const sibling of path5) {
    if (!/^[0-9a-f]{64}$/.test(sibling.hash) || sibling.side !== (index % 2 ? "left" : "right")) return false;
    node = sibling.side === "left" ? parent(sibling.hash, node) : parent(node, sibling.hash);
    index = Math.floor(index / 2);
  }
  return node === root;
}
function checkFrozen(frozen, auctionId, manifestHash) {
  requireThat(frozen.auction_id === auctionId && frozen.manifest_hash === manifestHash && frozen.leaf_count === frozen.leaves.length, "freeze auction/count");
  const refs = /* @__PURE__ */ new Set(), ciphertexts = /* @__PURE__ */ new Set();
  for (const [i, l] of frozen.leaves.entries()) {
    requireThat(l.auction_id === auctionId && l.manifest_hash === manifestHash && l.leaf_index === i && /^[0-9a-f]+$/.test(l.ciphertext_hex) && l.ciphertext_hex.length % 2 === 0 && hash(Buffer.from(l.ciphertext_hex, "hex")) === l.ciphertext_hash, "freeze leaf binding");
    const ref = jsonBytes(l.deposit).toString("utf8");
    requireThat(!refs.has(ref) && !ciphertexts.has(l.ciphertext_hash), "duplicate frozen leaf");
    refs.add(ref);
    ciphertexts.add(l.ciphertext_hash);
  }
  requireThat(tree(frozen.leaves).root === frozen.root, "freeze root");
}
function receiptMember(packet, frozen, signer) {
  const r = verifyRecord(packet, signer);
  return r.auction_id === frozen.auction_id && r.manifest_hash === frozen.manifest_hash && member(r.ciphertext_hash, r.deposit, r.leaf_index, frozen.leaf_count, frozen.paths[r.leaf_index] ?? [], frozen.root);
}

// clear/layout.ts
var LAYOUT_V0 = { version: 0, bytes: 128, price_at: 33, quantity_at: 41, auction_at: 1, auction_len: 32, owner_at: 61, pad_at: 125 };
function readOrder(layout, plaintextHex, allowedBindings) {
  const fail = (reason, bound_hex2 = "", owner_hex2 = "") => ({ price: 0n, quantity: 0, bound_hex: bound_hex2, owner_hex: owner_hex2, reason });
  if (!/^[0-9a-f]+$/.test(plaintextHex) || plaintextHex.length !== layout.bytes * 2) return fail("plaintext_length");
  const pt = Buffer.from(plaintextHex, "hex");
  const price = pt.readBigUInt64BE(layout.price_at), quantity = pt.readUInt32BE(layout.quantity_at);
  const bound_hex = pt.subarray(layout.auction_at, layout.auction_at + layout.auction_len).toString("hex");
  const owner_hex = pt.subarray(layout.owner_at, layout.owner_at + 32).toString("hex");
  const bound = pt[0] === layout.version && pt.subarray(layout.pad_at).equals(Buffer.alloc(layout.bytes - layout.pad_at)) && allowedBindings.includes(bound_hex);
  return bound ? { price, quantity, bound_hex, owner_hex, reason: "" } : { ...fail("plaintext_binding", bound_hex, owner_hex), price, quantity };
}

// clear/features.ts
function readOrders(input, m, layout = LAYOUT_V0) {
  const lots = m.lots ?? null;
  const allowed = lots ?? [m.auction_id];
  requireThat(input.opened.length === input.frozen.leaf_count && new Set(input.opened.map((o) => o.leaf_index)).size === input.opened.length, "one opening per frozen leaf");
  const orders = input.frozen.leaves.map((l) => {
    const o = input.opened.find((x) => x.leaf_index === l.leaf_index);
    let price = 0n, quantity = 0, bound_hex = "", owner_hex = "", reason = "";
    if (o?.error === "reorg") reason = "reorg";
    else if (!o || o.plaintext_hex === null) reason = "undecryptable";
    else {
      const r = readOrder(layout, o.plaintext_hex, allowed);
      price = r.price;
      quantity = r.quantity;
      bound_hex = r.bound_hex;
      owner_hex = r.owner_hex;
      reason = r.reason;
    }
    return { leaf_index: l.leaf_index, lot: lots && !reason ? bound_hex : null, bound_hex, owner_hex, price, quantity, reason, superseded: false };
  });
  const latest = /* @__PURE__ */ new Map();
  for (const o of orders) {
    if (o.reason) continue;
    const key = `${o.owner_hex}:${o.lot ?? ""}`;
    latest.set(key, Math.max(latest.get(key) ?? 0, o.leaf_index));
  }
  for (const o of orders) {
    if (o.reason) continue;
    if (o.leaf_index < (latest.get(`${o.owner_hex}:${o.lot ?? ""}`) ?? 0)) {
      o.superseded = true;
      o.reason = "superseded";
    }
  }
  return orders;
}
function readReserve(plaintextHex, auctionId, tick) {
  requireThat(/^[0-9a-f]{80}$/.test(plaintextHex), "reserve opening length");
  const pt = Buffer.from(plaintextHex, "hex");
  requireThat(pt.subarray(8, 40).toString("hex") === auctionId, "reserve opening binding");
  const price = pt.readBigUInt64BE(0);
  requireThat(price <= 2100000000000000n && price % tick === 0n, "reserve opening price");
  return price;
}
function sealedReserve(m, opening, tick) {
  if (m.sealed_reserve === void 0) {
    requireThat(opening === null || opening === void 0, "reserve opening without sealed reserve");
    return null;
  }
  requireThat(typeof opening === "string" && /^[0-9a-f]+$/.test(opening), "missing reserve opening");
  return readReserve(opening, m.auction_id, tick);
}
function effectiveReserve(m, sealed) {
  const r = zats(m.reserve_zats, "reserve");
  return sealed !== null && sealed > r ? sealed : r;
}
function effectiveMaxPrice(m, sealed) {
  const p = zats(m.buyback.max_price_zats, "max_price");
  return sealed !== null && sealed < p ? sealed : p;
}
var balanceDue = (payment, fee, C) => payment + fee > C ? payment + fee - C : 0n;
var refundAfter = (payment, fee, C) => C > fee + payment ? C - fee - payment : 0n;
function checkSeriesLink(current, previous) {
  requireThat(current !== void 0, "series linkage missing");
  requireThat(previous.link !== void 0 && previous.link.series_id === current.series_id, "series id");
  requireThat(current.round_index === previous.link.round_index + 1, "series round index");
  requireThat(current.previous_result_hash === previous.result_hash, "series previous result hash");
}

// clear/core.ts
function calculate(input, mode) {
  const { manifest: m, manifest_hash } = client(input.manifest, input.signer);
  checkFrozen(input.frozen, m.auction_id, manifest_hash);
  const C = zats(m.C_zats, "C"), fee = zats(m.fee_zats, "fee"), tick = zats(m.tick_zats, "tick"), cap = zats(m.B_max_zats, "B_max");
  const reserve = effectiveReserve(m, sealedReserve(m, input.reserve_opening, tick));
  const orders = readOrders(input, m);
  const bids = orders.map((o) => {
    let { price, quantity, reason } = o;
    if (!reason) {
      if (!quantity || quantity > m.q_max || price > cap || price % tick !== 0n || m.bond === void 0 && price * BigInt(quantity) + fee > C) reason = "over_cap";
      else if (price < reserve) reason = "below_reserve";
    }
    return { leaf_index: o.leaf_index, lot: o.lot ?? null, price, quantity, reason, fill: 0 };
  });
  const lotPrice = /* @__PURE__ */ new Map();
  for (const lot of m.lots ?? [null]) {
    const ranked = bids.filter((b) => !b.reason && b.lot === lot).sort((a, b) => a.price !== b.price ? a.price > b.price ? -1 : 1 : a.leaf_index - b.leaf_index);
    let clearingPrice = 0n;
    if (mode === "vickrey") {
      if (ranked.length) {
        ranked[0].fill = 1;
        clearingPrice = ranked[1]?.price ?? reserve;
      }
    } else {
      let left = m.supply;
      for (let start = 0; start < ranked.length && left > 0; ) {
        let end = start + 1;
        while (end < ranked.length && ranked[end].price === ranked[start].price) end++;
        const band = ranked.slice(start, end), demand = band.reduce((n, b) => n + BigInt(b.quantity), 0n);
        if (demand <= BigInt(left)) {
          for (const b of band) b.fill = b.quantity;
          left -= Number(demand);
        } else {
          for (const b of band) b.fill = Number(BigInt(left) * BigInt(b.quantity) / demand);
          let dust = left - band.reduce((n, b) => n + b.fill, 0);
          for (const b of band) {
            if (dust > 0 && b.fill < b.quantity) {
              b.fill++;
              dust--;
            }
          }
          left = 0;
        }
        clearingPrice = band[0].price;
        start = end;
      }
    }
    if (bids.filter((b) => b.lot === lot).reduce((n, b) => n + b.fill, 0) < m.clearing.minimum_fill) {
      for (const b of bids) if (b.lot === lot) b.fill = 0;
      clearingPrice = 0n;
    }
    lotPrice.set(lot, clearingPrice);
  }
  let payout = 0n, refunds = 0n, balances = 0n;
  const allocations = bids.map((b) => {
    const paid = (lotPrice.get(b.lot) ?? 0n) * BigInt(b.fill), refund = refundAfter(paid, fee, C), balance = m.bond ? balanceDue(paid, fee, C) : 0n;
    payout += paid;
    refunds += refund;
    balances += balance;
    return {
      leaf_index: b.leaf_index,
      ...m.lots ? { lot: b.lot } : {},
      price_zats: mode === "vickrey" ? null : b.price.toString(),
      quantity: b.quantity,
      fill: b.fill,
      payment_zats: paid.toString(),
      refund_zats: refund.toString(),
      ...m.bond ? { balance_due_zats: balance.toString() } : {},
      outcome: b.reason || (b.fill ? "winner" : "unfilled")
    };
  });
  const total = C * BigInt(bids.length), fees = fee * BigInt(bids.length);
  requireThat(total + balances === payout + refunds + fees, "conservation");
  return {
    auction_id: m.auction_id,
    manifest_hash,
    freeze_root: input.frozen.root,
    mode,
    // Multi-lot rounds clear each lot at its own price (lots[]); the top-level price is for the single lot.
    clearing_price_zats: (lotPrice.get(null) ?? 0n).toString(),
    ...m.lots ? { lots: m.lots.map((lot_id) => ({ lot_id, clearing_price_zats: (lotPrice.get(lot_id) ?? 0n).toString() })) } : {},
    allocations,
    conservation: {
      input_zats: total.toString(),
      payout_zats: payout.toString(),
      refund_zats: refunds.toString(),
      fees_zats: fees.toString(),
      ...m.bond ? { balances_zats: balances.toString() } : {}
    }
  };
}
function clear(input) {
  const mode = client(input.manifest, input.signer).manifest.clearing.mode;
  return { ...calculate(input, mode), comparison: mode === "uniform" ? calculate(input, "vickrey") : null };
}
function checkResultModeA(m, result) {
  const fee = zats(m.fee_zats, "fee"), C = zats(m.C_zats, "C");
  requireThat(m.bond !== void 0 === result.allocations.every((a) => a.balance_due_zats !== void 0) && m.bond !== void 0 === (result.conservation.balances_zats !== void 0), "bond/balance fields");
  let balances = 0n;
  for (const a of result.allocations) {
    const payment = BigInt(a.payment_zats), refund = BigInt(a.refund_zats);
    if (m.bond !== void 0) {
      const balance = balanceDue(payment, fee, C);
      requireThat(a.balance_due_zats !== void 0 && BigInt(a.balance_due_zats) === balance, `allocation ${a.leaf_index} balance due`);
      requireThat(refund === refundAfter(payment, fee, C), `allocation ${a.leaf_index} refund`);
      balances += balance;
    } else {
      requireThat(payment + refund + fee === C, `allocation ${a.leaf_index} does not account C`);
    }
  }
  if (m.bond !== void 0)
    requireThat(result.conservation.balances_zats !== void 0 && BigInt(result.conservation.balances_zats) === balances, "balances total");
  if (m.lots !== void 0) {
    requireThat(Array.isArray(result.lots) && result.lots.map((l) => l.lot_id).join(",") === m.lots.join(","), "lots");
    for (const a of result.allocations) {
      const lot = result.lots.find((l) => l.lot_id === a.lot);
      requireThat(lot, `allocation ${a.leaf_index} lot`);
      requireThat(BigInt(a.payment_zats) === zats(lot.clearing_price_zats, "lot clearing price") * BigInt(a.fill), `allocation ${a.leaf_index} payment`);
    }
  } else {
    requireThat(result.lots === void 0 && result.allocations.every((a) => a.lot === void 0), "lots without manifest lots");
    for (const a of result.allocations)
      requireThat(BigInt(a.payment_zats) === zats(result.clearing_price_zats, "clearing price") * BigInt(a.fill), `allocation ${a.leaf_index} payment`);
  }
}
function obligationsModeA(result, settlement) {
  const map = /* @__PURE__ */ new Map();
  const defaults = settlement?.defaults ?? [];
  requireThat(new Set(defaults).size === defaults.length, "duplicate default");
  requireThat(defaults.length === 0 || result.allocations.every((a) => a.balance_due_zats !== void 0), "defaults without bond");
  let seller = BigInt(result.conservation.payout_zats);
  for (const a of result.allocations) {
    if (defaults.includes(a.leaf_index)) {
      requireThat(a.fill > 0 && BigInt(a.balance_due_zats ?? "0") > 0n, `default for leaf ${a.leaf_index} that owes no balance`);
      seller += BigInt(a.refund_zats) - BigInt(a.balance_due_zats);
      continue;
    }
    const owed = BigInt(a.refund_zats);
    if (owed > 0n) map.set(`leaf:${a.leaf_index}`, owed.toString());
  }
  if (seller > 0n) map.set("seller", seller.toString());
  return map;
}

// clear/mode-b.ts
function clientPhase5(packet, trustedSigner) {
  const m = verifyRecord(packet, trustedSigner);
  requireThat(m.clearing && ["uniform", "vickrey", "buyback"].includes(m.clearing.mode), "clearing mode");
  requireThat(m.clearing.mode === "buyback" === (m.buyback !== void 0), "buyback parameters/mode");
  if (m.buyback !== void 0) {
    requireThat(m.buyback && typeof m.buyback === "object" && !Array.isArray(m.buyback), "buyback parameters");
    requireThat(Object.keys(m.buyback).sort().join(",") === "budget_zats,max_price_zats", "buyback field set");
    requireThat(m.bond === void 0, "bond-then-pay is auction-side");
    requireThat(m.serials === void 0, "serials are uniform auction-side");
  }
  const base = { ...m, clearing: { ...m.clearing, mode: m.clearing.mode === "buyback" ? "uniform" : m.clearing.mode }, buyback: void 0 };
  delete base.buyback;
  validateManifest(base);
  if (m.buyback !== void 0) {
    const tick = zats(m.tick_zats, "tick"), budget = zats(m.buyback.budget_zats, "budget"), maxPrice = zats(m.buyback.max_price_zats, "max_price");
    requireThat(budget > 0n && maxPrice >= tick && maxPrice % tick === 0n, "buyback budget/max_price");
  }
  return { manifest_hash: hash(Buffer.from(packet.bytes, "base64")), manifest: m };
}
function clientBuyback(packet, trustedSigner) {
  const r = clientPhase5(packet, trustedSigner);
  requireThat(r.manifest.clearing.mode === "buyback" && r.manifest.buyback, "buyback clearing mode");
  return r;
}
function calculate2(input) {
  const { manifest: m, manifest_hash } = clientBuyback(input.manifest, input.signer);
  checkFrozen(input.frozen, m.auction_id, manifest_hash);
  const C = zats(m.C_zats, "C"), fee = zats(m.fee_zats, "fee"), tick = zats(m.tick_zats, "tick"), cap = zats(m.B_max_zats, "B_max");
  const budget = zats(m.buyback.budget_zats, "budget");
  const maxPrice = effectiveMaxPrice(m, sealedReserve(m, input.reserve_opening, tick));
  const orders = readOrders(input, m);
  const asks = orders.map((o) => {
    let { price, quantity, reason } = o;
    if (!reason) {
      if (!price || !quantity || quantity > m.q_max || price > cap || price % tick !== 0n || price * BigInt(quantity) + fee > C) reason = "over_cap";
      else if (price > maxPrice) reason = "above_max_price";
    }
    return { leaf_index: o.leaf_index, lot: o.lot ?? null, price, quantity, reason, fill: 0 };
  });
  const lotPrice = /* @__PURE__ */ new Map();
  for (const lot of m.lots ?? [null]) {
    const ranked = asks.filter((a) => !a.reason && a.lot === lot).sort((a, b) => a.price !== b.price ? a.price < b.price ? -1 : 1 : a.leaf_index - b.leaf_index);
    let clearingPrice = 0n, filled = 0;
    for (let start = 0; start < ranked.length; ) {
      let end = start + 1;
      while (end < ranked.length && ranked[end].price === ranked[start].price) end++;
      const band = ranked.slice(start, end), p = band[0].price, demand = band.reduce((n, b) => n + BigInt(b.quantity), 0n);
      const room = budget / p - BigInt(filled);
      if (room <= 0n) break;
      if (demand <= room) for (const b of band) b.fill = b.quantity;
      else {
        for (const b of band) b.fill = Number(room * BigInt(b.quantity) / demand);
        let dust = Number(room) - band.reduce((n, b) => n + b.fill, 0);
        for (const b of band) {
          if (dust > 0 && b.fill < b.quantity) {
            b.fill++;
            dust--;
          }
        }
      }
      filled += band.reduce((n, b) => n + b.fill, 0);
      clearingPrice = p;
      start = end;
      if (demand > room) break;
    }
    if (asks.filter((a) => a.lot === lot).reduce((n, a) => n + a.fill, 0) < m.clearing.minimum_fill) {
      for (const a of asks) if (a.lot === lot) a.fill = 0;
      clearingPrice = 0n;
    }
    lotPrice.set(lot, clearingPrice);
  }
  let payout = 0n, refunds = 0n, fees = 0n;
  const allocations = asks.map((a) => {
    const clearingPrice = lotPrice.get(a.lot) ?? 0n;
    const gross = clearingPrice * BigInt(a.fill), feeShare = a.fill ? fee < gross ? fee : gross : 0n;
    const payment = gross - feeShare, refund = C;
    payout += payment;
    refunds += refund;
    fees += feeShare;
    return {
      leaf_index: a.leaf_index,
      ...m.lots ? { lot: a.lot } : {},
      price_zats: a.price.toString(),
      quantity: a.quantity,
      fill: a.fill,
      payment_zats: payment.toString(),
      refund_zats: refund.toString(),
      outcome: a.reason || (a.fill ? "winner" : "unfilled")
    };
  });
  const treasury = payout + fees, totalFill = asks.reduce((n, a) => n + a.fill, 0);
  for (const lot of m.lots ?? [null]) {
    const lotFill = asks.filter((a) => a.lot === lot).reduce((n, a) => n + a.fill, 0);
    requireThat((lotPrice.get(lot) ?? 0n) * BigInt(lotFill) <= budget, "budget exceeded");
    for (const a of asks.filter((x) => x.lot === lot && x.fill))
      requireThat(a.price <= (lotPrice.get(lot) ?? 0n), `allocation ${a.leaf_index} ask above clearing price`);
  }
  for (const a of asks) requireThat(a.fill <= a.quantity, `allocation ${a.leaf_index} fill exceeds quantity`);
  return {
    auction_id: m.auction_id,
    manifest_hash,
    freeze_root: input.frozen.root,
    mode: "buyback",
    clearing_price_zats: (lotPrice.get(null) ?? 0n).toString(),
    ...m.lots ? { lots: m.lots.map((lot_id) => ({ lot_id, clearing_price_zats: (lotPrice.get(lot_id) ?? 0n).toString() })) } : {},
    allocations,
    conservation: { input_zats: (C * BigInt(asks.length) + treasury).toString(), payout_zats: payout.toString(), refund_zats: refunds.toString(), fees_zats: fees.toString(), treasury_zats: treasury.toString() }
  };
}
function clearModeB(input) {
  return { ...calculate2(input), comparison: null };
}
function checkResultBuyback(m, result) {
  const C = zats(m.C_zats, "C"), fee = zats(m.fee_zats, "fee"), budget = zats(m.buyback.budget_zats, "budget");
  const c = result.conservation;
  requireThat(c.treasury_zats !== void 0 && zats(c.treasury_zats, "treasury") === zats(c.payout_zats, "payout") + zats(c.fees_zats, "fees"), "treasury_zats is not payout + fees");
  const priceOf = (a) => {
    if (m.lots === void 0) {
      requireThat(a.lot === void 0 && result.lots === void 0, "lots without manifest lots");
      return zats(result.clearing_price_zats, "clearing price");
    }
    requireThat(Array.isArray(result.lots) && result.lots.map((l) => l.lot_id).join(",") === m.lots.join(","), "lots");
    const lot = result.lots.find((l) => l.lot_id === a.lot);
    requireThat(lot, `allocation ${a.leaf_index} lot`);
    return zats(lot.clearing_price_zats, "lot clearing price");
  };
  const fillByLot = /* @__PURE__ */ new Map();
  for (const a of result.allocations) {
    requireThat(Number.isInteger(a.fill) && a.fill >= 0 && a.fill <= a.quantity, `allocation ${a.leaf_index} fill exceeds quantity`);
    const price = priceOf(a);
    const gross = price * BigInt(a.fill), feeShare = a.fill ? fee < gross ? fee : gross : 0n;
    requireThat(BigInt(a.payment_zats) + feeShare === gross, `allocation ${a.leaf_index} payment`);
    requireThat(BigInt(a.refund_zats) === C, `allocation ${a.leaf_index} refund is not exact C`);
    if (a.fill) requireThat(a.price_zats !== null && BigInt(a.price_zats) <= price, `allocation ${a.leaf_index} ask above clearing price`);
    fillByLot.set(a.lot ?? null, (fillByLot.get(a.lot ?? null) ?? 0n) + BigInt(a.fill));
    requireThat(price * (fillByLot.get(a.lot ?? null) ?? 0n) <= budget, "budget exceeded");
  }
}
function obligationsModeB(result, settlement) {
  requireThat((settlement?.defaults ?? []).length === 0, "defaults are auction-side");
  const map = /* @__PURE__ */ new Map();
  for (const a of result.allocations) {
    const owed = BigInt(a.refund_zats) + BigInt(a.payment_zats);
    if (owed > 0n) map.set(`leaf:${a.leaf_index}`, owed.toString());
  }
  return map;
}

// clear/market.ts
function marketClient(packet, signer, mode, validate) {
  const m = verifyRecord(packet, signer);
  requireThat(m.clearing.mode === mode, `${mode} mode`);
  const base = { ...m, clearing: { ...m.clearing, mode: "uniform" } };
  delete base[mode];
  validateManifest(base);
  validate(m);
  return { manifest: m, manifest_hash: hash(Buffer.from(packet.bytes, "base64")) };
}
function marketOrders(input, m, layout = LAYOUT_V0) {
  checkFrozen(input.frozen, m.auction_id, input.manifest.sha256);
  return readOrders(input, m, layout).map((o) => ({
    ...o,
    fill: 0,
    reason: o.reason || (!o.quantity || o.quantity > m.q_max || o.price > zats(m.B_max_zats, "cap") || o.price % zats(m.tick_zats, "tick") !== 0n || !m.bond && o.price * BigInt(o.quantity) + zats(m.fee_zats, "fee") > zats(m.C_zats, "C") ? "over_cap" : "")
  }));
}
function marketResult(input, m, allocations, price, fees, treasury = 0n) {
  const inputZats = zats(m.C_zats, "C") * BigInt(allocations.length) + treasury;
  const payout = allocations.reduce((n, a) => n + BigInt(a.payment_zats), 0n);
  const refunds = allocations.reduce((n, a) => n + BigInt(a.refund_zats), 0n);
  const balances = allocations.reduce((n, a) => n + BigInt(a.balance_due_zats ?? "0"), 0n);
  requireThat(inputZats + balances === payout + refunds + fees, "conservation");
  return {
    auction_id: m.auction_id,
    manifest_hash: input.manifest.sha256,
    freeze_root: input.frozen.root,
    mode: m.clearing.mode,
    clearing_price_zats: price.toString(),
    allocations,
    comparison: null,
    conservation: {
      input_zats: inputZats.toString(),
      payout_zats: payout.toString(),
      refund_zats: refunds.toString(),
      fees_zats: fees.toString(),
      ...treasury ? { treasury_zats: treasury.toString() } : {},
      ...m.bond ? { balances_zats: balances.toString() } : {}
    }
  };
}

// clear/otc.ts
var OTC_LAYOUT = { ...LAYOUT_V0, version: 3 };
function clientOTC(packet, signer) {
  return marketClient(packet, signer, "otc", (m) => {
    requireThat(m.otc && Object.keys(m.otc).sort().join(",") === "buyer_key,seller_key" && /^[0-9a-f]{64}$/.test(m.otc.buyer_key) && /^[0-9a-f]{64}$/.test(m.otc.seller_key) && m.otc.buyer_key !== m.otc.seller_key, "otc parties");
    requireThat(m.supply === 1 && m.q_max === 1 && !m.lots && !m.bond && !m.serials && !m.sealed_reserve && m.reserve_zats === "0", "otc single-unit limits");
  });
}
function clearOTC(input) {
  const { manifest: m } = clientOTC(input.manifest, input.signer), orders = marketOrders(input, m, OTC_LAYOUT);
  for (const o of orders) if (!o.reason && ![m.otc.buyer_key, m.otc.seller_key].includes(o.owner_hex)) o.reason = "not_party";
  const buyer = orders.find((o) => !o.reason && o.owner_hex === m.otc.buyer_key), seller = orders.find((o) => !o.reason && o.owner_hex === m.otc.seller_key);
  const matched = !!buyer && !!seller && buyer.price >= seller.price, price = matched ? (buyer.price + seller.price) / 2n : 0n;
  const C = zats(m.C_zats, "C"), fee = zats(m.fee_zats, "fee"), fees = matched ? fee < price ? fee : price : 0n;
  const allocations = orders.map((o) => {
    const isBuyer = o === buyer, isSeller = o === seller, fill = matched && (isBuyer || isSeller) ? 1 : 0;
    return {
      leaf_index: o.leaf_index,
      price_zats: o.price.toString(),
      quantity: o.quantity,
      fill,
      payment_zats: (fill && isSeller ? price - fees : 0n).toString(),
      refund_zats: (fill && isBuyer ? C - price : C).toString(),
      outcome: o.reason || (fill ? "winner" : "no_match"),
      side: o.owner_hex === m.otc.buyer_key ? "buyer" : o.owner_hex === m.otc.seller_key ? "seller" : "unknown"
    };
  });
  return { ...marketResult(input, m, allocations, price, fees), cancelled: !matched };
}
function checkResultOTC(m, r) {
  const winners = r.allocations.filter((a) => a.fill), price = zats(r.clearing_price_zats, "otc price"), C = zats(m.C_zats, "C"), fee = zats(m.fee_zats, "fee");
  requireThat(winners.length === (r.cancelled ? 0 : 2), "otc parties filled");
  const buyer = winners.find((a) => a.side === "buyer"), seller = winners.find((a) => a.side === "seller");
  if (!r.cancelled) requireThat(buyer && seller && buyer.price_zats !== null && seller.price_zats !== null && BigInt(buyer.price_zats) >= BigInt(seller.price_zats) && price === (BigInt(buyer.price_zats) + BigInt(seller.price_zats)) / 2n, "otc midpoint/limits");
  else requireThat(price === 0n, "otc cancelled price");
  const fees = r.cancelled ? 0n : fee < price ? fee : price;
  requireThat(BigInt(r.conservation.fees_zats) === fees, "otc fees");
  for (const a of r.allocations) {
    requireThat(a.fill === 0 || a.fill === 1 && a.quantity === 1, "otc unit fill");
    requireThat(BigInt(a.refund_zats) === (a === buyer ? C - price : C) && BigInt(a.payment_zats) === (a === seller ? price - fees : 0n), "otc payout/refund");
  }
}
function obligationsOTC(result, settlement) {
  requireThat(!settlement?.delivery_defaults?.length, "otc has no delivery default");
  return obligationsModeB(result, settlement);
}

// clear/rfq.ts
var RFQ_LAYOUT = { ...LAYOUT_V0, version: 2 };
function clientRFQ(packet, signer) {
  return marketClient(packet, signer, "rfq", (m) => {
    const r = m.rfq;
    requireThat(r && Object.keys(r).sort().join(",") === "budget_zats,dealer_keys,delivery_deadline_height,delivery_signers,max_price_zats", "rfq fields");
    requireThat(!m.bond && !m.lots && !m.serials && m.supply === 1 && m.q_max === 1, "rfq single quote/lot");
    requireThat(Array.isArray(r.dealer_keys) && r.dealer_keys.length >= 2 && r.dealer_keys.every((k) => /^[0-9a-f]{64}$/.test(k)) && new Set(r.dealer_keys).size === r.dealer_keys.length, "rfq dealer keys");
    requireThat(Array.isArray(r.delivery_signers) && r.delivery_signers.length === 3 && r.delivery_signers.every((k) => /^[0-9a-f]{88}$/.test(k)) && new Set(r.delivery_signers).size === 3, "rfq delivery signers");
    requireThat(Number.isSafeInteger(r.delivery_deadline_height) && r.delivery_deadline_height > 0 && r.delivery_deadline_height <= 4294967295, "rfq delivery deadline");
    const max = zats(r.max_price_zats, "rfq max price");
    requireThat(max > 0n && max <= zats(m.B_max_zats, "cap") && max % zats(m.tick_zats, "tick") === 0n && zats(r.budget_zats, "rfq budget") >= max, "rfq budget/max price");
  });
}
function clearRFQ(input) {
  const { manifest: m } = clientRFQ(input.manifest, input.signer), orders = marketOrders(input, m, RFQ_LAYOUT);
  const sealed = sealedReserve(m, input.reserve_opening, zats(m.tick_zats, "tick"));
  const publicMax = zats(m.rfq.max_price_zats, "rfq max price"), max = sealed !== null && sealed < publicMax ? sealed : publicMax;
  for (const o of orders) if (!o.reason) {
    if (!m.rfq.dealer_keys.includes(o.owner_hex)) o.reason = "not_allowlisted";
    else if (o.quantity !== 1 || !o.price) o.reason = "over_cap";
    else if (o.price > max) o.reason = "above_max_price";
  }
  const quotes = orders.filter((o) => !o.reason).sort((a, b) => a.price === b.price ? a.leaf_index - b.leaf_index : a.price < b.price ? -1 : 1);
  const cancelled = quotes.length < 2, price = cancelled ? 0n : quotes[1].price;
  if (!cancelled) quotes[0].fill = 1;
  const C = zats(m.C_zats, "C"), fee = zats(m.fee_zats, "fee"), feeShare = cancelled ? 0n : fee < price ? fee : price;
  const allocations = orders.map((o) => ({
    leaf_index: o.leaf_index,
    price_zats: o.price.toString(),
    quantity: o.quantity,
    fill: o.fill,
    payment_zats: (o.fill ? price - feeShare : 0n).toString(),
    refund_zats: C.toString(),
    outcome: o.reason || (cancelled ? "cancelled" : o.fill ? "winner" : "unfilled")
  }));
  const result = marketResult(input, m, allocations, price, feeShare, price);
  result.conservation.treasury_zats = price.toString();
  return { ...result, cancelled, rfq_delivery: { deadline_height: m.rfq.delivery_deadline_height, signers: m.rfq.delivery_signers } };
}
function checkResultRFQ(m, r) {
  checkResultBuyback({ ...m, buyback: { budget_zats: m.rfq.budget_zats, max_price_zats: m.rfq.max_price_zats } }, r);
  requireThat(r.allocations.filter((a) => a.fill).length === (r.cancelled ? 0 : 1), "rfq winner count");
  requireThat(!r.cancelled || r.clearing_price_zats === "0" && r.allocations.every((a) => a.refund_zats === m.C_zats), "rfq cancellation");
}
function obligationsRFQ(result, settlement) {
  requireThat(!settlement?.defaults?.length, "rfq needs signed delivery default");
  const map = obligationsModeB(result), packets = settlement?.delivery_defaults ?? [];
  if (!packets.length) return map;
  const policy = result.rfq_delivery, winner = result.allocations.find((a) => a.fill);
  requireThat(policy && winner && !result.cancelled, "rfq default without winner");
  const seen = /* @__PURE__ */ new Set();
  let body = null;
  for (const p of packets) {
    requireThat(policy.signers.includes(p.signer) && !seen.has(p.signer), "rfq delivery default signer");
    const r = verifyRecord(p, p.signer);
    requireThat(Object.keys(r).sort().join(",") === "auction_id,deadline_height,leaf_index,observed_height,status" && r.auction_id === result.auction_id && r.leaf_index === winner.leaf_index && r.deadline_height === policy.deadline_height && Number.isSafeInteger(r.observed_height) && r.observed_height > r.deadline_height && r.status === "delivery_missed", "rfq delivery default binding/deadline");
    const bytes = jsonBytes(r);
    requireThat(!body || body.equals(bytes), "rfq delivery default disagreement");
    body = bytes;
    seen.add(p.signer);
  }
  requireThat(seen.size >= 2, "rfq delivery default quorum");
  const owed = map.get(`leaf:${winner.leaf_index}`);
  map.delete(`leaf:${winner.leaf_index}`);
  map.set("buyer", owed);
  return map;
}

// adapters/zilkroad.ts
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

// envelope/index.ts
import { createCipheriv, createDecipheriv, createHash as createHash2, createPrivateKey as createPrivateKey2, createPublicKey as createPublicKey2, diffieHellman, generateKeyPairSync, sign as sign2, verify as verify2 } from "node:crypto";

// node_modules/@noble/hashes/esm/cryptoNode.js
import * as nc from "node:crypto";
var crypto = nc && typeof nc === "object" && "webcrypto" in nc ? nc.webcrypto : nc && typeof nc === "object" && "randomBytes" in nc ? nc : void 0;

// node_modules/@noble/hashes/esm/utils.js
function isBytes(a) {
  return a instanceof Uint8Array || ArrayBuffer.isView(a) && a.constructor.name === "Uint8Array";
}
function anumber(n) {
  if (!Number.isSafeInteger(n) || n < 0)
    throw new Error("positive integer expected, got " + n);
}
function abytes(b, ...lengths) {
  if (!isBytes(b))
    throw new Error("Uint8Array expected");
  if (lengths.length > 0 && !lengths.includes(b.length))
    throw new Error("Uint8Array expected of length " + lengths + ", got length=" + b.length);
}
function aexists(instance, checkFinished = true) {
  if (instance.destroyed)
    throw new Error("Hash instance has been destroyed");
  if (checkFinished && instance.finished)
    throw new Error("Hash#digest() has already been called");
}
function aoutput(out, instance) {
  abytes(out);
  const min = instance.outputLen;
  if (out.length < min) {
    throw new Error("digestInto() expects output buffer of length at least " + min);
  }
}
function clean(...arrays) {
  for (let i = 0; i < arrays.length; i++) {
    arrays[i].fill(0);
  }
}
function createView(arr) {
  return new DataView(arr.buffer, arr.byteOffset, arr.byteLength);
}
function rotr(word, shift) {
  return word << 32 - shift | word >>> shift;
}
var hasHexBuiltin = /* @__PURE__ */ (() => (
  // @ts-ignore
  typeof Uint8Array.from([]).toHex === "function" && typeof Uint8Array.fromHex === "function"
))();
var hexes = /* @__PURE__ */ Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));
function bytesToHex(bytes) {
  abytes(bytes);
  if (hasHexBuiltin)
    return bytes.toHex();
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += hexes[bytes[i]];
  }
  return hex;
}
var asciis = { _0: 48, _9: 57, A: 65, F: 70, a: 97, f: 102 };
function asciiToBase16(ch) {
  if (ch >= asciis._0 && ch <= asciis._9)
    return ch - asciis._0;
  if (ch >= asciis.A && ch <= asciis.F)
    return ch - (asciis.A - 10);
  if (ch >= asciis.a && ch <= asciis.f)
    return ch - (asciis.a - 10);
  return;
}
function hexToBytes(hex) {
  if (typeof hex !== "string")
    throw new Error("hex string expected, got " + typeof hex);
  if (hasHexBuiltin)
    return Uint8Array.fromHex(hex);
  const hl = hex.length;
  const al = hl / 2;
  if (hl % 2)
    throw new Error("hex string expected, got unpadded hex of length " + hl);
  const array = new Uint8Array(al);
  for (let ai = 0, hi = 0; ai < al; ai++, hi += 2) {
    const n1 = asciiToBase16(hex.charCodeAt(hi));
    const n2 = asciiToBase16(hex.charCodeAt(hi + 1));
    if (n1 === void 0 || n2 === void 0) {
      const char = hex[hi] + hex[hi + 1];
      throw new Error('hex string expected, got non-hex character "' + char + '" at index ' + hi);
    }
    array[ai] = n1 * 16 + n2;
  }
  return array;
}
function utf8ToBytes(str) {
  if (typeof str !== "string")
    throw new Error("string expected");
  return new Uint8Array(new TextEncoder().encode(str));
}
function toBytes(data) {
  if (typeof data === "string")
    data = utf8ToBytes(data);
  abytes(data);
  return data;
}
function concatBytes(...arrays) {
  let sum = 0;
  for (let i = 0; i < arrays.length; i++) {
    const a = arrays[i];
    abytes(a);
    sum += a.length;
  }
  const res = new Uint8Array(sum);
  for (let i = 0, pad = 0; i < arrays.length; i++) {
    const a = arrays[i];
    res.set(a, pad);
    pad += a.length;
  }
  return res;
}
var Hash = class {
};
function createHasher(hashCons) {
  const hashC = (msg) => hashCons().update(toBytes(msg)).digest();
  const tmp = hashCons();
  hashC.outputLen = tmp.outputLen;
  hashC.blockLen = tmp.blockLen;
  hashC.create = () => hashCons();
  return hashC;
}
function randomBytes(bytesLength = 32) {
  if (crypto && typeof crypto.getRandomValues === "function") {
    return crypto.getRandomValues(new Uint8Array(bytesLength));
  }
  if (crypto && typeof crypto.randomBytes === "function") {
    return Uint8Array.from(crypto.randomBytes(bytesLength));
  }
  throw new Error("crypto.getRandomValues must be defined");
}

// node_modules/@noble/hashes/esm/_md.js
function setBigUint64(view, byteOffset, value, isLE) {
  if (typeof view.setBigUint64 === "function")
    return view.setBigUint64(byteOffset, value, isLE);
  const _32n = BigInt(32);
  const _u32_max = BigInt(4294967295);
  const wh = Number(value >> _32n & _u32_max);
  const wl = Number(value & _u32_max);
  const h = isLE ? 4 : 0;
  const l = isLE ? 0 : 4;
  view.setUint32(byteOffset + h, wh, isLE);
  view.setUint32(byteOffset + l, wl, isLE);
}
function Chi(a, b, c) {
  return a & b ^ ~a & c;
}
function Maj(a, b, c) {
  return a & b ^ a & c ^ b & c;
}
var HashMD = class extends Hash {
  constructor(blockLen, outputLen, padOffset, isLE) {
    super();
    this.finished = false;
    this.length = 0;
    this.pos = 0;
    this.destroyed = false;
    this.blockLen = blockLen;
    this.outputLen = outputLen;
    this.padOffset = padOffset;
    this.isLE = isLE;
    this.buffer = new Uint8Array(blockLen);
    this.view = createView(this.buffer);
  }
  update(data) {
    aexists(this);
    data = toBytes(data);
    abytes(data);
    const { view, buffer, blockLen } = this;
    const len = data.length;
    for (let pos = 0; pos < len; ) {
      const take = Math.min(blockLen - this.pos, len - pos);
      if (take === blockLen) {
        const dataView = createView(data);
        for (; blockLen <= len - pos; pos += blockLen)
          this.process(dataView, pos);
        continue;
      }
      buffer.set(data.subarray(pos, pos + take), this.pos);
      this.pos += take;
      pos += take;
      if (this.pos === blockLen) {
        this.process(view, 0);
        this.pos = 0;
      }
    }
    this.length += data.length;
    this.roundClean();
    return this;
  }
  digestInto(out) {
    aexists(this);
    aoutput(out, this);
    this.finished = true;
    const { buffer, view, blockLen, isLE } = this;
    let { pos } = this;
    buffer[pos++] = 128;
    clean(this.buffer.subarray(pos));
    if (this.padOffset > blockLen - pos) {
      this.process(view, 0);
      pos = 0;
    }
    for (let i = pos; i < blockLen; i++)
      buffer[i] = 0;
    setBigUint64(view, blockLen - 8, BigInt(this.length * 8), isLE);
    this.process(view, 0);
    const oview = createView(out);
    const len = this.outputLen;
    if (len % 4)
      throw new Error("_sha2: outputLen should be aligned to 32bit");
    const outLen = len / 4;
    const state = this.get();
    if (outLen > state.length)
      throw new Error("_sha2: outputLen bigger than state");
    for (let i = 0; i < outLen; i++)
      oview.setUint32(4 * i, state[i], isLE);
  }
  digest() {
    const { buffer, outputLen } = this;
    this.digestInto(buffer);
    const res = buffer.slice(0, outputLen);
    this.destroy();
    return res;
  }
  _cloneInto(to) {
    to || (to = new this.constructor());
    to.set(...this.get());
    const { blockLen, buffer, length, finished, destroyed, pos } = this;
    to.destroyed = destroyed;
    to.finished = finished;
    to.length = length;
    to.pos = pos;
    if (length % blockLen)
      to.buffer.set(buffer);
    return to;
  }
  clone() {
    return this._cloneInto();
  }
};
var SHA256_IV = /* @__PURE__ */ Uint32Array.from([
  1779033703,
  3144134277,
  1013904242,
  2773480762,
  1359893119,
  2600822924,
  528734635,
  1541459225
]);

// envelope/index.ts
var X_PUB = Buffer.from("302a300506032b656e032100", "hex");
var X_PRIV = Buffer.from("302e020100300506032b656e04220420", "hex");
var raw = (h, n) => {
  requireThat(typeof h === "string" && (n === 0 ? h.length % 2 === 0 : h.length === n * 2) && /^[0-9a-f]*$/.test(h), "key/signature hex");
  return Buffer.from(h, "hex");
};
var ENVELOPE_PT_BYTES = 512;
function ownerBinding(auctionIdHex, ciphertextHashHex, envelopeCtHex) {
  return Buffer.concat([Buffer.from("benzo-envelope-v1"), raw(auctionIdHex, 32), raw(ciphertextHashHex, 32), raw(envelopeCtHex, 0)]);
}
function verifyEnvelope(ownerPublicHex, auctionIdHex, ciphertextHashHex, envelopeCtHex, signatureHex) {
  const key = createPublicKey2({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), raw(ownerPublicHex, 32)]), type: "spki", format: "der" });
  return verify2(null, ownerBinding(auctionIdHex, ciphertextHashHex, envelopeCtHex), key, raw(signatureHex, 64));
}
function settlementCommitment(nonceHex, envelopeCtHex) {
  return createHash2("sha256").update(raw(nonceHex, 16)).update(raw(envelopeCtHex, 0)).digest("hex");
}
function statementBinding(body) {
  return Buffer.concat([Buffer.from("benzo-settlement-statement-v1"), jsonBytes(body)]);
}
function verifyStatement(ownerPublicHex, body, signatureHex) {
  const key = createPublicKey2({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), raw(ownerPublicHex, 32)]), type: "spki", format: "der" });
  return verify2(null, statementBinding(body), key, raw(signatureHex, 64));
}

// adapters/zilkroad.ts
function holderOwners(receipts, auctionId, collection, signer) {
  const serials = /* @__PURE__ */ new Set(), owners = /* @__PURE__ */ new Set();
  for (const packet of receipts) {
    const r = verifyRecord(packet, signer);
    requireThat(Object.keys(r).sort().join(",") === "auction_id,collection,owner_pubkey,serial" && r.auction_id === auctionId && r.collection === collection && /^[0-9a-f]{64}$/.test(r.owner_pubkey) && Number.isSafeInteger(r.serial) && r.serial >= 0, "holder receipt binding");
    requireThat(!serials.has(r.serial), "duplicate holder serial");
    serials.add(r.serial);
    owners.add(r.owner_pubkey);
  }
  return owners;
}
function marketplace(pub) {
  const file = path.join(pub.dir, "marketplace.json"), m = pub.manifest;
  const pinned = m.lot?.startsWith("zilkroad:") || m.lots?.some((l) => l.startsWith("5a494c4b")) || existsSync(file);
  if (!pinned) return null;
  requireThat(existsSync(file), "missing marketplace.json");
  const p = JSON.parse(readFileSync(file, "utf8"));
  requireThat(p && Object.keys(p).sort().join(",") === "adapter,collection,metadata_commitment,serial_range,version" && p.version === 1 && p.adapter === "zilkroad" && typeof p.collection === "string" && p.collection.length > 0 && p.collection.length <= 256 && /^[0-9a-f]{64}$/.test(p.metadata_commitment), "marketplace fields");
  const s = p.serial_range;
  requireThat(s && Object.keys(s).sort().join(",") === "count,first" && Number.isSafeInteger(s.first) && s.first >= 0 && Number.isSafeInteger(s.count) && s.count > 0 && Number.isSafeInteger(s.first + s.count - 1), "marketplace serial range");
  const h = hash(jsonBytes(p));
  requireThat(m.lots ? m.lots.every((lot, index) => lot === "5a494c4b" + hash(jsonBytes({ marketplace_hash: h, lot_index: index })).slice(0, 56)) : m.lot === `zilkroad:${h}`, "marketplace manifest commitment");
  if (m.serials) requireThat(m.serials.first === s.first && m.serials.count === s.count, "marketplace drop range");
  return p;
}
function checkSerialRange(pub, serials) {
  const p = marketplace(pub);
  if (p) for (const s of serials) requireThat(s >= p.serial_range.first && s < p.serial_range.first + p.serial_range.count, "marketplace serial outside range");
}
function claimBody(pub, ciphertextHash, receipt, statement) {
  const p = marketplace(pub);
  requireThat(p && pub.result && pub.frozen, "claim marketplace/result/frozen");
  checkSettlementStatement(pub, ciphertextHash, statement);
  requireThat(statement.fill > 0 && pub.state === "SETTLED" && !pub.settlement?.defaults?.includes(statement.leaf_index) && !["buyback", "rfq"].includes(pub.result.mode), "claim paid auction winner");
  const actual = pub.settlement?.receipts?.find((r) => r.party === `leaf:${statement.leaf_index}`) ?? (statement.refund_zats === "0" ? pub.settlement?.receipts?.find((r) => r.party === "seller") : void 0);
  requireThat(actual && jsonBytes(actual).equals(jsonBytes(receipt)) && /^[0-9a-f]{64}$/.test(receipt.txid) && receipt.auction_id === pub.manifest.auction_id, "claim private settlement receipt");
  const winners = pub.result.allocations.filter((a) => a.fill > 0).sort((a, b) => a.leaf_index - b.leaf_index);
  requireThat(winners.reduce((n, a) => n + BigInt(a.fill), 0n) <= BigInt(p.serial_range.count), "claim inventory capacity");
  const offset = winners.filter((a) => a.leaf_index < statement.leaf_index).reduce((n, a) => n + a.fill, 0);
  const serials = pub.result.serial_assignment?.find((a) => a.leaf_index === statement.leaf_index)?.serials ?? Array.from({ length: statement.fill }, (_, i) => p.serial_range.first + offset + i);
  requireThat(serials && serials.length === statement.fill, "claim assigned serials");
  checkSerialRange(pub, serials);
  return {
    version: 1,
    kind: "zilkroad_delivery_claim",
    auction_id: pub.manifest.auction_id,
    manifest_hash: pub.manifest_hash,
    result_hash: hash(pub.resultBytes),
    ciphertext_hash: ciphertextHash,
    leaf_index: statement.leaf_index,
    owner_pubkey: statement.owner_pubkey,
    collection: p.collection,
    metadata_commitment: p.metadata_commitment,
    serials,
    settlement_txid: receipt.txid,
    receipt_hash: hash(jsonBytes(receipt)),
    statement_hash: hash(jsonBytes(statement))
  };
}
function checkDeliveryClaim(pub, ct, receipt, statement, claim) {
  const { signature, ...body } = claim;
  requireThat(jsonBytes(body).equals(jsonBytes(claimBody(pub, ct, receipt, statement))), "delivery claim binding");
  requireThat(verifyStatement(body.owner_pubkey, body, signature), "delivery claim owner signature");
}
function checkDeliveryExceptions(pub) {
  marketplace(pub);
  const file = path.join(pub.dir, "delivery-exceptions.json");
  if (!existsSync(file)) return;
  const queue = JSON.parse(readFileSync(file, "utf8"));
  requireThat(Array.isArray(queue), "delivery exception queue");
  const seen = /* @__PURE__ */ new Set();
  for (const row of queue) {
    requireThat(row && Object.keys(row).sort().join(",") === "claim,receipt,signature,statement,status" && row.status === "paid_not_delivered", "delivery exception fields/status");
    const ct = row.claim.ciphertext_hash;
    requireThat(!seen.has(ct), "duplicate delivery exception");
    seen.add(ct);
    checkDeliveryClaim(pub, ct, row.receipt, row.statement, row.claim);
    requireThat(verifyStatement(row.claim.owner_pubkey, {
      auction_id: pub.manifest.auction_id,
      claim_hash: hash(jsonBytes(row.claim)),
      status: row.status
    }, row.signature), "delivery exception owner signature");
  }
}

// clear/launch.ts
var LAUNCH_LAYOUT = { ...LAYOUT_V0, version: 1, pad_at: 126 };
function clientLaunch(packet, signer) {
  return marketClient(packet, signer, "launch", (m) => {
    const l = m.launch;
    requireThat(l && Object.keys(l).every((k) => ["standard_lot_size", "minimum_raise_zats", "holder", "follow_on"].includes(k)), "launch fields");
    requireThat(Number.isSafeInteger(l.standard_lot_size) && l.standard_lot_size > 0 && m.supply % l.standard_lot_size === 0 && m.q_max % l.standard_lot_size === 0, "launch standard lot size");
    zats(l.minimum_raise_zats, "minimum raise");
    requireThat(!m.lots && !m.serials, "launch uses one lot");
    if (l.holder) requireThat(Object.keys(l.holder).sort().join(",") === "collection,receipt_signer,supply" && Number.isSafeInteger(l.holder.supply) && l.holder.supply > 0 && l.holder.supply <= m.supply && l.holder.supply % l.standard_lot_size === 0 && typeof l.holder.collection === "string" && l.holder.collection.length > 0 && /^[0-9a-f]{88}$/.test(l.holder.receipt_signer), "launch holder tranche");
    if (l.follow_on) {
      requireThat(!l.holder && Object.keys(l.follow_on).sort().join(",") === "previous_result_hash,price_zats" && m.series?.previous_result_hash === l.follow_on.previous_result_hash && /^[0-9a-f]{64}$/.test(l.follow_on.previous_result_hash), "launch follow-on linkage");
      requireThat(zats(l.follow_on.price_zats, "follow-on price") % zats(m.tick_zats, "tick") === 0n, "follow-on tick");
    }
  });
}
function deliveryBatch(m, result, orders, records) {
  const rows = [], seen = /* @__PURE__ */ new Set();
  requireThat(new Set(records.map((r) => r.leaf_index)).size === records.length, "duplicate launch delivery");
  const winners = result.allocations.filter((a) => a.fill);
  requireThat(records.length === winners.length, "launch delivery count");
  for (const a of winners) {
    const r = records.find((r2) => r2.leaf_index === a.leaf_index), owner = orders.find((o) => o.leaf_index === a.leaf_index).owner_hex;
    requireThat(r && r.destinations.length === a.fill / m.launch.standard_lot_size && verifyStatement(owner, { auction_id: m.auction_id, leaf_index: a.leaf_index, destinations: r.destinations }, r.signature), "launch delivery owner signature/count");
    for (const destination of r.destinations) {
      requireThat(typeof destination === "string" && destination.length > 0 && destination.length <= 256 && !seen.has(destination), "launch fresh destination");
      seen.add(destination);
      rows.push({ destination, amount: m.launch.standard_lot_size });
    }
  }
  return { version: 1, auction_id: m.auction_id, delivery: "project_on_token_chain", rows };
}
function clearLaunch(input) {
  const { manifest: m } = clientLaunch(input.manifest, input.signer), data = input.launch ?? {};
  const orders = marketOrders(input, m, LAUNCH_LAYOUT), lot = m.launch.standard_lot_size;
  const floor = effectiveReserve(m, sealedReserve(m, input.reserve_opening, zats(m.tick_zats, "tick")));
  const holders = m.launch.holder ? holderOwners(data.holder_receipts ?? [], m.auction_id, m.launch.holder.collection, m.launch.holder.receipt_signer) : /* @__PURE__ */ new Set();
  requireThat(m.launch.holder || !data.holder_receipts?.length, "holder receipts without tranche");
  for (const o of orders) {
    const pt = input.opened.find((x) => x.leaf_index === o.leaf_index)?.plaintext_hex;
    const tranche = pt ? Buffer.from(pt, "hex")[125] : 0;
    if (!o.reason && (o.quantity % lot !== 0 || tranche > 1 || tranche === 1 && (!m.launch.holder || !holders.has(o.owner_hex)))) o.reason = "invalid_tranche";
    if (!o.reason && o.price < floor) o.reason = "below_reserve";
  }
  const trancheOf = (i) => Buffer.from(input.opened.find((x) => x.leaf_index === i)?.plaintext_hex ?? "", "hex")[125] ?? 0;
  let price = 0n, left = m.supply;
  const holder = orders.filter((o) => !o.reason && trancheOf(o.leaf_index) === 1).sort((a, b) => a.leaf_index - b.leaf_index);
  let holderLeft = m.launch.holder?.supply ?? 0;
  for (const o of holder) {
    o.fill = Math.min(o.quantity, holderLeft);
    holderLeft -= o.fill;
    left -= o.fill;
  }
  const main = orders.filter((o) => !o.reason && trancheOf(o.leaf_index) === 0);
  if (m.launch.follow_on) {
    const previous = data.previous_result;
    requireThat(previous && hash(jsonBytes(previous)) === m.launch.follow_on.previous_result_hash && previous.mode === "launch" && !previous.cancelled && previous.clearing_price_zats === m.launch.follow_on.price_zats, "launch previous result/price");
    requireThat(Number.isSafeInteger(previous.launch_supply) && m.supply <= previous.launch_supply - previous.allocations.reduce((n, a) => n + a.fill, 0), "launch follow-on remaining supply");
    price = zats(m.launch.follow_on.price_zats, "follow-on price");
    requireThat(price >= floor, "follow-on below floor");
    const heights = /* @__PURE__ */ new Map();
    for (const p of data.mined_heights ?? []) {
      const r = verifyRecord(p, input.signer);
      requireThat(Object.keys(r).sort().join(",") === "auction_id,height,leaf_index,txid" && r.auction_id === m.auction_id && input.frozen.leaves[r.leaf_index]?.deposit.txid === r.txid && Number.isSafeInteger(r.height) && r.height > 0 && !heights.has(r.leaf_index), "launch mined-height binding");
      heights.set(r.leaf_index, r.height);
    }
    requireThat(main.every((o) => heights.has(o.leaf_index)), "launch follow-on needs mined heights");
    main.sort((a, b) => heights.get(a.leaf_index) - heights.get(b.leaf_index) || a.leaf_index - b.leaf_index);
    for (const o of main) {
      if (o.price < price) continue;
      o.fill = Math.min(o.quantity, left);
      left -= o.fill;
    }
  } else {
    requireThat(!data.previous_result && !data.mined_heights?.length, "follow-on data without tranche");
    main.sort((a, b) => a.price === b.price ? a.leaf_index - b.leaf_index : a.price > b.price ? -1 : 1);
    for (let start = 0; start < main.length && left > 0; ) {
      let end = start + 1;
      while (end < main.length && main[end].price === main[start].price) end++;
      const band = main.slice(start, end), demand = band.reduce((n, o) => n + BigInt(o.quantity / lot), 0n), room = left / lot;
      if (demand <= BigInt(room)) for (const o of band) o.fill = o.quantity;
      else {
        for (const o of band) o.fill = Number(BigInt(room) * BigInt(o.quantity / lot) / demand) * lot;
        let dust = left - band.reduce((n, o) => n + o.fill, 0);
        for (const o of band) if (dust >= lot && o.fill < o.quantity) {
          o.fill += lot;
          dust -= lot;
        }
      }
      left -= band.reduce((n, o) => n + o.fill, 0);
      price = band[0].price;
      start = end;
    }
  }
  const paid = (o) => (trancheOf(o.leaf_index) === 1 ? floor : price) * BigInt(o.fill);
  const cancelled = orders.reduce((n, o) => n + o.fill, 0) < m.clearing.minimum_fill || orders.reduce((n, o) => n + paid(o), 0n) < zats(m.launch.minimum_raise_zats, "minimum raise");
  if (cancelled) {
    for (const o of orders) o.fill = 0;
    price = 0n;
  }
  const C = zats(m.C_zats, "C"), fee = cancelled ? 0n : zats(m.fee_zats, "fee");
  const allocations = orders.map((o) => {
    const payment = paid(o);
    return { leaf_index: o.leaf_index, price_zats: o.price.toString(), quantity: o.quantity, fill: o.fill, payment_zats: payment.toString(), refund_zats: refundAfter(payment, fee, C).toString(), ...m.bond ? { balance_due_zats: balanceDue(payment, fee, C).toString() } : {}, outcome: cancelled ? "cancelled" : o.reason || (o.fill ? "winner" : "unfilled"), tranche: trancheOf(o.leaf_index) === 1 ? "holder" : "main" };
  });
  const result = { ...marketResult(input, m, allocations, price, fee * BigInt(orders.length)), cancelled, launch_supply: m.supply, holder_price_zats: floor.toString() };
  const batch = deliveryBatch(m, result, orders, data.delivery ?? []);
  return { ...result, allocation_file_hash: hash(jsonBytes(batch)) };
}
function checkResultLaunch(m, r) {
  const C = zats(m.C_zats, "C"), fee = r.cancelled ? 0n : zats(m.fee_zats, "fee");
  for (const a of r.allocations) {
    const price = a.tranche === "holder" ? zats(r.holder_price_zats, "holder price") : zats(r.clearing_price_zats, "price");
    requireThat(a.fill % m.launch.standard_lot_size === 0 && BigInt(a.payment_zats) === price * BigInt(a.fill), "launch lot/payment");
    requireThat(BigInt(a.refund_zats) === refundAfter(BigInt(a.payment_zats), fee, C), "launch refund");
    requireThat(BigInt(a.balance_due_zats ?? "0") === balanceDue(BigInt(a.payment_zats), fee, C), "launch balance");
  }
  requireThat(r.cancelled ? r.allocations.every((a) => a.fill === 0 && a.refund_zats === m.C_zats) : BigInt(r.conservation.payout_zats) >= zats(m.launch.minimum_raise_zats, "minimum raise"), "launch minimum raise");
}

// node_modules/@noble/hashes/esm/sha2.js
var SHA256_K = /* @__PURE__ */ Uint32Array.from([
  1116352408,
  1899447441,
  3049323471,
  3921009573,
  961987163,
  1508970993,
  2453635748,
  2870763221,
  3624381080,
  310598401,
  607225278,
  1426881987,
  1925078388,
  2162078206,
  2614888103,
  3248222580,
  3835390401,
  4022224774,
  264347078,
  604807628,
  770255983,
  1249150122,
  1555081692,
  1996064986,
  2554220882,
  2821834349,
  2952996808,
  3210313671,
  3336571891,
  3584528711,
  113926993,
  338241895,
  666307205,
  773529912,
  1294757372,
  1396182291,
  1695183700,
  1986661051,
  2177026350,
  2456956037,
  2730485921,
  2820302411,
  3259730800,
  3345764771,
  3516065817,
  3600352804,
  4094571909,
  275423344,
  430227734,
  506948616,
  659060556,
  883997877,
  958139571,
  1322822218,
  1537002063,
  1747873779,
  1955562222,
  2024104815,
  2227730452,
  2361852424,
  2428436474,
  2756734187,
  3204031479,
  3329325298
]);
var SHA256_W = /* @__PURE__ */ new Uint32Array(64);
var SHA256 = class extends HashMD {
  constructor(outputLen = 32) {
    super(64, outputLen, 8, false);
    this.A = SHA256_IV[0] | 0;
    this.B = SHA256_IV[1] | 0;
    this.C = SHA256_IV[2] | 0;
    this.D = SHA256_IV[3] | 0;
    this.E = SHA256_IV[4] | 0;
    this.F = SHA256_IV[5] | 0;
    this.G = SHA256_IV[6] | 0;
    this.H = SHA256_IV[7] | 0;
  }
  get() {
    const { A, B, C, D, E, F, G, H } = this;
    return [A, B, C, D, E, F, G, H];
  }
  // prettier-ignore
  set(A, B, C, D, E, F, G, H) {
    this.A = A | 0;
    this.B = B | 0;
    this.C = C | 0;
    this.D = D | 0;
    this.E = E | 0;
    this.F = F | 0;
    this.G = G | 0;
    this.H = H | 0;
  }
  process(view, offset) {
    for (let i = 0; i < 16; i++, offset += 4)
      SHA256_W[i] = view.getUint32(offset, false);
    for (let i = 16; i < 64; i++) {
      const W15 = SHA256_W[i - 15];
      const W2 = SHA256_W[i - 2];
      const s0 = rotr(W15, 7) ^ rotr(W15, 18) ^ W15 >>> 3;
      const s1 = rotr(W2, 17) ^ rotr(W2, 19) ^ W2 >>> 10;
      SHA256_W[i] = s1 + SHA256_W[i - 7] + s0 + SHA256_W[i - 16] | 0;
    }
    let { A, B, C, D, E, F, G, H } = this;
    for (let i = 0; i < 64; i++) {
      const sigma1 = rotr(E, 6) ^ rotr(E, 11) ^ rotr(E, 25);
      const T1 = H + sigma1 + Chi(E, F, G) + SHA256_K[i] + SHA256_W[i] | 0;
      const sigma0 = rotr(A, 2) ^ rotr(A, 13) ^ rotr(A, 22);
      const T2 = sigma0 + Maj(A, B, C) | 0;
      H = G;
      G = F;
      F = E;
      E = D + T1 | 0;
      D = C;
      C = B;
      B = A;
      A = T1 + T2 | 0;
    }
    A = A + this.A | 0;
    B = B + this.B | 0;
    C = C + this.C | 0;
    D = D + this.D | 0;
    E = E + this.E | 0;
    F = F + this.F | 0;
    G = G + this.G | 0;
    H = H + this.H | 0;
    this.set(A, B, C, D, E, F, G, H);
  }
  roundClean() {
    clean(SHA256_W);
  }
  destroy() {
    this.set(0, 0, 0, 0, 0, 0, 0, 0);
    clean(this.buffer);
  }
};
var sha256 = /* @__PURE__ */ createHasher(() => new SHA256());

// node_modules/@noble/curves/esm/utils.js
var _0n = /* @__PURE__ */ BigInt(0);
var _1n = /* @__PURE__ */ BigInt(1);
function _abool2(value, title = "") {
  if (typeof value !== "boolean") {
    const prefix = title && `"${title}"`;
    throw new Error(prefix + "expected boolean, got type=" + typeof value);
  }
  return value;
}
function _abytes2(value, length, title = "") {
  const bytes = isBytes(value);
  const len = value?.length;
  const needsLen = length !== void 0;
  if (!bytes || needsLen && len !== length) {
    const prefix = title && `"${title}" `;
    const ofLen = needsLen ? ` of length ${length}` : "";
    const got = bytes ? `length=${len}` : `type=${typeof value}`;
    throw new Error(prefix + "expected Uint8Array" + ofLen + ", got " + got);
  }
  return value;
}
function hexToNumber(hex) {
  if (typeof hex !== "string")
    throw new Error("hex string expected, got " + typeof hex);
  return hex === "" ? _0n : BigInt("0x" + hex);
}
function bytesToNumberBE(bytes) {
  return hexToNumber(bytesToHex(bytes));
}
function bytesToNumberLE(bytes) {
  abytes(bytes);
  return hexToNumber(bytesToHex(Uint8Array.from(bytes).reverse()));
}
function numberToBytesBE(n, len) {
  return hexToBytes(n.toString(16).padStart(len * 2, "0"));
}
function numberToBytesLE(n, len) {
  return numberToBytesBE(n, len).reverse();
}
function ensureBytes(title, hex, expectedLength) {
  let res;
  if (typeof hex === "string") {
    try {
      res = hexToBytes(hex);
    } catch (e) {
      throw new Error(title + " must be hex string or Uint8Array, cause: " + e);
    }
  } else if (isBytes(hex)) {
    res = Uint8Array.from(hex);
  } else {
    throw new Error(title + " must be hex string or Uint8Array");
  }
  const len = res.length;
  if (typeof expectedLength === "number" && len !== expectedLength)
    throw new Error(title + " of length " + expectedLength + " expected, got " + len);
  return res;
}
var isPosBig = (n) => typeof n === "bigint" && _0n <= n;
function inRange(n, min, max) {
  return isPosBig(n) && isPosBig(min) && isPosBig(max) && min <= n && n < max;
}
function bitLen(n) {
  let len;
  for (len = 0; n > _0n; n >>= _1n, len += 1)
    ;
  return len;
}
function bitGet(n, pos) {
  return n >> BigInt(pos) & _1n;
}
var bitMask = (n) => (_1n << BigInt(n)) - _1n;
function isHash(val) {
  return typeof val === "function" && Number.isSafeInteger(val.outputLen);
}
function _validateObject(object, fields, optFields = {}) {
  if (!object || typeof object !== "object")
    throw new Error("expected valid options object");
  function checkField(fieldName, expectedType, isOpt) {
    const val = object[fieldName];
    if (isOpt && val === void 0)
      return;
    const current = typeof val;
    if (current !== expectedType || val === null)
      throw new Error(`param "${fieldName}" is invalid: expected ${expectedType}, got ${current}`);
  }
  Object.entries(fields).forEach(([k, v]) => checkField(k, v, false));
  Object.entries(optFields).forEach(([k, v]) => checkField(k, v, true));
}
var notImplemented = () => {
  throw new Error("not implemented");
};
function memoized(fn) {
  const map = /* @__PURE__ */ new WeakMap();
  return (arg, ...args) => {
    const val = map.get(arg);
    if (val !== void 0)
      return val;
    const computed = fn(arg, ...args);
    map.set(arg, computed);
    return computed;
  };
}

// node_modules/@noble/curves/esm/abstract/modular.js
var _0n2 = BigInt(0);
var _1n2 = BigInt(1);
var _2n = /* @__PURE__ */ BigInt(2);
var _3n = /* @__PURE__ */ BigInt(3);
var _4n = /* @__PURE__ */ BigInt(4);
var _5n = /* @__PURE__ */ BigInt(5);
var _7n = /* @__PURE__ */ BigInt(7);
var _8n = /* @__PURE__ */ BigInt(8);
var _9n = /* @__PURE__ */ BigInt(9);
var _16n = /* @__PURE__ */ BigInt(16);
function mod(a, b) {
  const result = a % b;
  return result >= _0n2 ? result : b + result;
}
function invert(number, modulo) {
  if (number === _0n2)
    throw new Error("invert: expected non-zero number");
  if (modulo <= _0n2)
    throw new Error("invert: expected positive modulus, got " + modulo);
  let a = mod(number, modulo);
  let b = modulo;
  let x = _0n2, y = _1n2, u = _1n2, v = _0n2;
  while (a !== _0n2) {
    const q = b / a;
    const r = b % a;
    const m = x - u * q;
    const n = y - v * q;
    b = a, a = r, x = u, y = v, u = m, v = n;
  }
  const gcd = b;
  if (gcd !== _1n2)
    throw new Error("invert: does not exist");
  return mod(x, modulo);
}
function assertIsSquare(Fp3, root, n) {
  if (!Fp3.eql(Fp3.sqr(root), n))
    throw new Error("Cannot find square root");
}
function sqrt3mod4(Fp3, n) {
  const p1div4 = (Fp3.ORDER + _1n2) / _4n;
  const root = Fp3.pow(n, p1div4);
  assertIsSquare(Fp3, root, n);
  return root;
}
function sqrt5mod8(Fp3, n) {
  const p5div8 = (Fp3.ORDER - _5n) / _8n;
  const n2 = Fp3.mul(n, _2n);
  const v = Fp3.pow(n2, p5div8);
  const nv = Fp3.mul(n, v);
  const i = Fp3.mul(Fp3.mul(nv, _2n), v);
  const root = Fp3.mul(nv, Fp3.sub(i, Fp3.ONE));
  assertIsSquare(Fp3, root, n);
  return root;
}
function sqrt9mod16(P) {
  const Fp_ = Field(P);
  const tn = tonelliShanks(P);
  const c1 = tn(Fp_, Fp_.neg(Fp_.ONE));
  const c2 = tn(Fp_, c1);
  const c3 = tn(Fp_, Fp_.neg(c1));
  const c4 = (P + _7n) / _16n;
  return (Fp3, n) => {
    let tv1 = Fp3.pow(n, c4);
    let tv2 = Fp3.mul(tv1, c1);
    const tv3 = Fp3.mul(tv1, c2);
    const tv4 = Fp3.mul(tv1, c3);
    const e1 = Fp3.eql(Fp3.sqr(tv2), n);
    const e2 = Fp3.eql(Fp3.sqr(tv3), n);
    tv1 = Fp3.cmov(tv1, tv2, e1);
    tv2 = Fp3.cmov(tv4, tv3, e2);
    const e3 = Fp3.eql(Fp3.sqr(tv2), n);
    const root = Fp3.cmov(tv1, tv2, e3);
    assertIsSquare(Fp3, root, n);
    return root;
  };
}
function tonelliShanks(P) {
  if (P < _3n)
    throw new Error("sqrt is not defined for small field");
  let Q = P - _1n2;
  let S = 0;
  while (Q % _2n === _0n2) {
    Q /= _2n;
    S++;
  }
  let Z = _2n;
  const _Fp = Field(P);
  while (FpLegendre(_Fp, Z) === 1) {
    if (Z++ > 1e3)
      throw new Error("Cannot find square root: probably non-prime P");
  }
  if (S === 1)
    return sqrt3mod4;
  let cc = _Fp.pow(Z, Q);
  const Q1div2 = (Q + _1n2) / _2n;
  return function tonelliSlow(Fp3, n) {
    if (Fp3.is0(n))
      return n;
    if (FpLegendre(Fp3, n) !== 1)
      throw new Error("Cannot find square root");
    let M = S;
    let c = Fp3.mul(Fp3.ONE, cc);
    let t = Fp3.pow(n, Q);
    let R = Fp3.pow(n, Q1div2);
    while (!Fp3.eql(t, Fp3.ONE)) {
      if (Fp3.is0(t))
        return Fp3.ZERO;
      let i = 1;
      let t_tmp = Fp3.sqr(t);
      while (!Fp3.eql(t_tmp, Fp3.ONE)) {
        i++;
        t_tmp = Fp3.sqr(t_tmp);
        if (i === M)
          throw new Error("Cannot find square root");
      }
      const exponent = _1n2 << BigInt(M - i - 1);
      const b = Fp3.pow(c, exponent);
      M = i;
      c = Fp3.sqr(b);
      t = Fp3.mul(t, c);
      R = Fp3.mul(R, b);
    }
    return R;
  };
}
function FpSqrt(P) {
  if (P % _4n === _3n)
    return sqrt3mod4;
  if (P % _8n === _5n)
    return sqrt5mod8;
  if (P % _16n === _9n)
    return sqrt9mod16(P);
  return tonelliShanks(P);
}
var FIELD_FIELDS = [
  "create",
  "isValid",
  "is0",
  "neg",
  "inv",
  "sqrt",
  "sqr",
  "eql",
  "add",
  "sub",
  "mul",
  "pow",
  "div",
  "addN",
  "subN",
  "mulN",
  "sqrN"
];
function validateField(field) {
  const initial = {
    ORDER: "bigint",
    MASK: "bigint",
    BYTES: "number",
    BITS: "number"
  };
  const opts = FIELD_FIELDS.reduce((map, val) => {
    map[val] = "function";
    return map;
  }, initial);
  _validateObject(field, opts);
  return field;
}
function FpPow(Fp3, num, power) {
  if (power < _0n2)
    throw new Error("invalid exponent, negatives unsupported");
  if (power === _0n2)
    return Fp3.ONE;
  if (power === _1n2)
    return num;
  let p = Fp3.ONE;
  let d = num;
  while (power > _0n2) {
    if (power & _1n2)
      p = Fp3.mul(p, d);
    d = Fp3.sqr(d);
    power >>= _1n2;
  }
  return p;
}
function FpInvertBatch(Fp3, nums, passZero = false) {
  const inverted = new Array(nums.length).fill(passZero ? Fp3.ZERO : void 0);
  const multipliedAcc = nums.reduce((acc, num, i) => {
    if (Fp3.is0(num))
      return acc;
    inverted[i] = acc;
    return Fp3.mul(acc, num);
  }, Fp3.ONE);
  const invertedAcc = Fp3.inv(multipliedAcc);
  nums.reduceRight((acc, num, i) => {
    if (Fp3.is0(num))
      return acc;
    inverted[i] = Fp3.mul(acc, inverted[i]);
    return Fp3.mul(acc, num);
  }, invertedAcc);
  return inverted;
}
function FpLegendre(Fp3, n) {
  const p1mod2 = (Fp3.ORDER - _1n2) / _2n;
  const powered = Fp3.pow(n, p1mod2);
  const yes = Fp3.eql(powered, Fp3.ONE);
  const zero = Fp3.eql(powered, Fp3.ZERO);
  const no = Fp3.eql(powered, Fp3.neg(Fp3.ONE));
  if (!yes && !zero && !no)
    throw new Error("invalid Legendre symbol result");
  return yes ? 1 : zero ? 0 : -1;
}
function nLength(n, nBitLength) {
  if (nBitLength !== void 0)
    anumber(nBitLength);
  const _nBitLength = nBitLength !== void 0 ? nBitLength : n.toString(2).length;
  const nByteLength = Math.ceil(_nBitLength / 8);
  return { nBitLength: _nBitLength, nByteLength };
}
function Field(ORDER, bitLenOrOpts, isLE = false, opts = {}) {
  if (ORDER <= _0n2)
    throw new Error("invalid field: expected ORDER > 0, got " + ORDER);
  let _nbitLength = void 0;
  let _sqrt = void 0;
  let modFromBytes = false;
  let allowedLengths = void 0;
  if (typeof bitLenOrOpts === "object" && bitLenOrOpts != null) {
    if (opts.sqrt || isLE)
      throw new Error("cannot specify opts in two arguments");
    const _opts = bitLenOrOpts;
    if (_opts.BITS)
      _nbitLength = _opts.BITS;
    if (_opts.sqrt)
      _sqrt = _opts.sqrt;
    if (typeof _opts.isLE === "boolean")
      isLE = _opts.isLE;
    if (typeof _opts.modFromBytes === "boolean")
      modFromBytes = _opts.modFromBytes;
    allowedLengths = _opts.allowedLengths;
  } else {
    if (typeof bitLenOrOpts === "number")
      _nbitLength = bitLenOrOpts;
    if (opts.sqrt)
      _sqrt = opts.sqrt;
  }
  const { nBitLength: BITS, nByteLength: BYTES } = nLength(ORDER, _nbitLength);
  if (BYTES > 2048)
    throw new Error("invalid field: expected ORDER of <= 2048 bytes");
  let sqrtP;
  const f = Object.freeze({
    ORDER,
    isLE,
    BITS,
    BYTES,
    MASK: bitMask(BITS),
    ZERO: _0n2,
    ONE: _1n2,
    allowedLengths,
    create: (num) => mod(num, ORDER),
    isValid: (num) => {
      if (typeof num !== "bigint")
        throw new Error("invalid field element: expected bigint, got " + typeof num);
      return _0n2 <= num && num < ORDER;
    },
    is0: (num) => num === _0n2,
    // is valid and invertible
    isValidNot0: (num) => !f.is0(num) && f.isValid(num),
    isOdd: (num) => (num & _1n2) === _1n2,
    neg: (num) => mod(-num, ORDER),
    eql: (lhs, rhs) => lhs === rhs,
    sqr: (num) => mod(num * num, ORDER),
    add: (lhs, rhs) => mod(lhs + rhs, ORDER),
    sub: (lhs, rhs) => mod(lhs - rhs, ORDER),
    mul: (lhs, rhs) => mod(lhs * rhs, ORDER),
    pow: (num, power) => FpPow(f, num, power),
    div: (lhs, rhs) => mod(lhs * invert(rhs, ORDER), ORDER),
    // Same as above, but doesn't normalize
    sqrN: (num) => num * num,
    addN: (lhs, rhs) => lhs + rhs,
    subN: (lhs, rhs) => lhs - rhs,
    mulN: (lhs, rhs) => lhs * rhs,
    inv: (num) => invert(num, ORDER),
    sqrt: _sqrt || ((n) => {
      if (!sqrtP)
        sqrtP = FpSqrt(ORDER);
      return sqrtP(f, n);
    }),
    toBytes: (num) => isLE ? numberToBytesLE(num, BYTES) : numberToBytesBE(num, BYTES),
    fromBytes: (bytes, skipValidation = true) => {
      if (allowedLengths) {
        if (!allowedLengths.includes(bytes.length) || bytes.length > BYTES) {
          throw new Error("Field.fromBytes: expected " + allowedLengths + " bytes, got " + bytes.length);
        }
        const padded = new Uint8Array(BYTES);
        padded.set(bytes, isLE ? 0 : padded.length - bytes.length);
        bytes = padded;
      }
      if (bytes.length !== BYTES)
        throw new Error("Field.fromBytes: expected " + BYTES + " bytes, got " + bytes.length);
      let scalar = isLE ? bytesToNumberLE(bytes) : bytesToNumberBE(bytes);
      if (modFromBytes)
        scalar = mod(scalar, ORDER);
      if (!skipValidation) {
        if (!f.isValid(scalar))
          throw new Error("invalid field element: outside of range 0..ORDER");
      }
      return scalar;
    },
    // TODO: we don't need it here, move out to separate fn
    invertBatch: (lst) => FpInvertBatch(f, lst),
    // We can't move this out because Fp6, Fp12 implement it
    // and it's unclear what to return in there.
    cmov: (a, b, c) => c ? b : a
  });
  return Object.freeze(f);
}
function getFieldBytesLength(fieldOrder) {
  if (typeof fieldOrder !== "bigint")
    throw new Error("field order must be bigint");
  const bitLength = fieldOrder.toString(2).length;
  return Math.ceil(bitLength / 8);
}
function getMinHashLength(fieldOrder) {
  const length = getFieldBytesLength(fieldOrder);
  return length + Math.ceil(length / 2);
}
function mapHashToField(key, fieldOrder, isLE = false) {
  const len = key.length;
  const fieldLen = getFieldBytesLength(fieldOrder);
  const minLen = getMinHashLength(fieldOrder);
  if (len < 16 || len < minLen || len > 1024)
    throw new Error("expected " + minLen + "-1024 bytes of input, got " + len);
  const num = isLE ? bytesToNumberLE(key) : bytesToNumberBE(key);
  const reduced = mod(num, fieldOrder - _1n2) + _1n2;
  return isLE ? numberToBytesLE(reduced, fieldLen) : numberToBytesBE(reduced, fieldLen);
}

// node_modules/@noble/curves/esm/abstract/curve.js
var _0n3 = BigInt(0);
var _1n3 = BigInt(1);
function negateCt(condition, item) {
  const neg = item.negate();
  return condition ? neg : item;
}
function normalizeZ(c, points) {
  const invertedZs = FpInvertBatch(c.Fp, points.map((p) => p.Z));
  return points.map((p, i) => c.fromAffine(p.toAffine(invertedZs[i])));
}
function validateW(W, bits) {
  if (!Number.isSafeInteger(W) || W <= 0 || W > bits)
    throw new Error("invalid window size, expected [1.." + bits + "], got W=" + W);
}
function calcWOpts(W, scalarBits) {
  validateW(W, scalarBits);
  const windows = Math.ceil(scalarBits / W) + 1;
  const windowSize = 2 ** (W - 1);
  const maxNumber = 2 ** W;
  const mask = bitMask(W);
  const shiftBy = BigInt(W);
  return { windows, windowSize, mask, maxNumber, shiftBy };
}
function calcOffsets(n, window2, wOpts) {
  const { windowSize, mask, maxNumber, shiftBy } = wOpts;
  let wbits = Number(n & mask);
  let nextN = n >> shiftBy;
  if (wbits > windowSize) {
    wbits -= maxNumber;
    nextN += _1n3;
  }
  const offsetStart = window2 * windowSize;
  const offset = offsetStart + Math.abs(wbits) - 1;
  const isZero = wbits === 0;
  const isNeg = wbits < 0;
  const isNegF = window2 % 2 !== 0;
  const offsetF = offsetStart;
  return { nextN, offset, isZero, isNeg, isNegF, offsetF };
}
function validateMSMPoints(points, c) {
  if (!Array.isArray(points))
    throw new Error("array expected");
  points.forEach((p, i) => {
    if (!(p instanceof c))
      throw new Error("invalid point at index " + i);
  });
}
function validateMSMScalars(scalars, field) {
  if (!Array.isArray(scalars))
    throw new Error("array of scalars expected");
  scalars.forEach((s, i) => {
    if (!field.isValid(s))
      throw new Error("invalid scalar at index " + i);
  });
}
var pointPrecomputes = /* @__PURE__ */ new WeakMap();
var pointWindowSizes = /* @__PURE__ */ new WeakMap();
function getW(P) {
  return pointWindowSizes.get(P) || 1;
}
function assert0(n) {
  if (n !== _0n3)
    throw new Error("invalid wNAF");
}
var wNAF = class {
  // Parametrized with a given Point class (not individual point)
  constructor(Point, bits) {
    this.BASE = Point.BASE;
    this.ZERO = Point.ZERO;
    this.Fn = Point.Fn;
    this.bits = bits;
  }
  // non-const time multiplication ladder
  _unsafeLadder(elm, n, p = this.ZERO) {
    let d = elm;
    while (n > _0n3) {
      if (n & _1n3)
        p = p.add(d);
      d = d.double();
      n >>= _1n3;
    }
    return p;
  }
  /**
   * Creates a wNAF precomputation window. Used for caching.
   * Default window size is set by `utils.precompute()` and is equal to 8.
   * Number of precomputed points depends on the curve size:
   * 2^(𝑊−1) * (Math.ceil(𝑛 / 𝑊) + 1), where:
   * - 𝑊 is the window size
   * - 𝑛 is the bitlength of the curve order.
   * For a 256-bit curve and window size 8, the number of precomputed points is 128 * 33 = 4224.
   * @param point Point instance
   * @param W window size
   * @returns precomputed point tables flattened to a single array
   */
  precomputeWindow(point, W) {
    const { windows, windowSize } = calcWOpts(W, this.bits);
    const points = [];
    let p = point;
    let base = p;
    for (let window2 = 0; window2 < windows; window2++) {
      base = p;
      points.push(base);
      for (let i = 1; i < windowSize; i++) {
        base = base.add(p);
        points.push(base);
      }
      p = base.double();
    }
    return points;
  }
  /**
   * Implements ec multiplication using precomputed tables and w-ary non-adjacent form.
   * More compact implementation:
   * https://github.com/paulmillr/noble-secp256k1/blob/47cb1669b6e506ad66b35fe7d76132ae97465da2/index.ts#L502-L541
   * @returns real and fake (for const-time) points
   */
  wNAF(W, precomputes, n) {
    if (!this.Fn.isValid(n))
      throw new Error("invalid scalar");
    let p = this.ZERO;
    let f = this.BASE;
    const wo = calcWOpts(W, this.bits);
    for (let window2 = 0; window2 < wo.windows; window2++) {
      const { nextN, offset, isZero, isNeg, isNegF, offsetF } = calcOffsets(n, window2, wo);
      n = nextN;
      if (isZero) {
        f = f.add(negateCt(isNegF, precomputes[offsetF]));
      } else {
        p = p.add(negateCt(isNeg, precomputes[offset]));
      }
    }
    assert0(n);
    return { p, f };
  }
  /**
   * Implements ec unsafe (non const-time) multiplication using precomputed tables and w-ary non-adjacent form.
   * @param acc accumulator point to add result of multiplication
   * @returns point
   */
  wNAFUnsafe(W, precomputes, n, acc = this.ZERO) {
    const wo = calcWOpts(W, this.bits);
    for (let window2 = 0; window2 < wo.windows; window2++) {
      if (n === _0n3)
        break;
      const { nextN, offset, isZero, isNeg } = calcOffsets(n, window2, wo);
      n = nextN;
      if (isZero) {
        continue;
      } else {
        const item = precomputes[offset];
        acc = acc.add(isNeg ? item.negate() : item);
      }
    }
    assert0(n);
    return acc;
  }
  getPrecomputes(W, point, transform) {
    let comp = pointPrecomputes.get(point);
    if (!comp) {
      comp = this.precomputeWindow(point, W);
      if (W !== 1) {
        if (typeof transform === "function")
          comp = transform(comp);
        pointPrecomputes.set(point, comp);
      }
    }
    return comp;
  }
  cached(point, scalar, transform) {
    const W = getW(point);
    return this.wNAF(W, this.getPrecomputes(W, point, transform), scalar);
  }
  unsafe(point, scalar, transform, prev) {
    const W = getW(point);
    if (W === 1)
      return this._unsafeLadder(point, scalar, prev);
    return this.wNAFUnsafe(W, this.getPrecomputes(W, point, transform), scalar, prev);
  }
  // We calculate precomputes for elliptic curve point multiplication
  // using windowed method. This specifies window size and
  // stores precomputed values. Usually only base point would be precomputed.
  createCache(P, W) {
    validateW(W, this.bits);
    pointWindowSizes.set(P, W);
    pointPrecomputes.delete(P);
  }
  hasCache(elm) {
    return getW(elm) !== 1;
  }
};
function mulEndoUnsafe(Point, point, k1, k2) {
  let acc = point;
  let p1 = Point.ZERO;
  let p2 = Point.ZERO;
  while (k1 > _0n3 || k2 > _0n3) {
    if (k1 & _1n3)
      p1 = p1.add(acc);
    if (k2 & _1n3)
      p2 = p2.add(acc);
    acc = acc.double();
    k1 >>= _1n3;
    k2 >>= _1n3;
  }
  return { p1, p2 };
}
function pippenger(c, fieldN, points, scalars) {
  validateMSMPoints(points, c);
  validateMSMScalars(scalars, fieldN);
  const plength = points.length;
  const slength = scalars.length;
  if (plength !== slength)
    throw new Error("arrays of points and scalars must have equal length");
  const zero = c.ZERO;
  const wbits = bitLen(BigInt(plength));
  let windowSize = 1;
  if (wbits > 12)
    windowSize = wbits - 3;
  else if (wbits > 4)
    windowSize = wbits - 2;
  else if (wbits > 0)
    windowSize = 2;
  const MASK = bitMask(windowSize);
  const buckets = new Array(Number(MASK) + 1).fill(zero);
  const lastBits = Math.floor((fieldN.BITS - 1) / windowSize) * windowSize;
  let sum = zero;
  for (let i = lastBits; i >= 0; i -= windowSize) {
    buckets.fill(zero);
    for (let j = 0; j < slength; j++) {
      const scalar = scalars[j];
      const wbits2 = Number(scalar >> BigInt(i) & MASK);
      buckets[wbits2] = buckets[wbits2].add(points[j]);
    }
    let resI = zero;
    for (let j = buckets.length - 1, sumI = zero; j > 0; j--) {
      sumI = sumI.add(buckets[j]);
      resI = resI.add(sumI);
    }
    sum = sum.add(resI);
    if (i !== 0)
      for (let j = 0; j < windowSize; j++)
        sum = sum.double();
  }
  return sum;
}
function createField(order, field, isLE) {
  if (field) {
    if (field.ORDER !== order)
      throw new Error("Field.ORDER must match order: Fp == p, Fn == n");
    validateField(field);
    return field;
  } else {
    return Field(order, { isLE });
  }
}
function _createCurveFields(type, CURVE, curveOpts = {}, FpFnLE) {
  if (FpFnLE === void 0)
    FpFnLE = type === "edwards";
  if (!CURVE || typeof CURVE !== "object")
    throw new Error(`expected valid ${type} CURVE object`);
  for (const p of ["p", "n", "h"]) {
    const val = CURVE[p];
    if (!(typeof val === "bigint" && val > _0n3))
      throw new Error(`CURVE.${p} must be positive bigint`);
  }
  const Fp3 = createField(CURVE.p, curveOpts.Fp, FpFnLE);
  const Fn = createField(CURVE.n, curveOpts.Fn, FpFnLE);
  const _b = type === "weierstrass" ? "b" : "d";
  const params = ["Gx", "Gy", "a", _b];
  for (const p of params) {
    if (!Fp3.isValid(CURVE[p]))
      throw new Error(`CURVE.${p} must be valid field element of CURVE.Fp`);
  }
  CURVE = Object.freeze(Object.assign({}, CURVE));
  return { CURVE, Fp: Fp3, Fn };
}

// node_modules/@noble/curves/esm/abstract/hash-to-curve.js
var os2ip = bytesToNumberBE;
function i2osp(value, length) {
  anum(value);
  anum(length);
  if (value < 0 || value >= 1 << 8 * length)
    throw new Error("invalid I2OSP input: " + value);
  const res = Array.from({ length }).fill(0);
  for (let i = length - 1; i >= 0; i--) {
    res[i] = value & 255;
    value >>>= 8;
  }
  return new Uint8Array(res);
}
function strxor(a, b) {
  const arr = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) {
    arr[i] = a[i] ^ b[i];
  }
  return arr;
}
function anum(item) {
  if (!Number.isSafeInteger(item))
    throw new Error("number expected");
}
function normDST(DST) {
  if (!isBytes(DST) && typeof DST !== "string")
    throw new Error("DST must be Uint8Array or string");
  return typeof DST === "string" ? utf8ToBytes(DST) : DST;
}
function expand_message_xmd(msg, DST, lenInBytes, H) {
  abytes(msg);
  anum(lenInBytes);
  DST = normDST(DST);
  if (DST.length > 255)
    DST = H(concatBytes(utf8ToBytes("H2C-OVERSIZE-DST-"), DST));
  const { outputLen: b_in_bytes, blockLen: r_in_bytes } = H;
  const ell = Math.ceil(lenInBytes / b_in_bytes);
  if (lenInBytes > 65535 || ell > 255)
    throw new Error("expand_message_xmd: invalid lenInBytes");
  const DST_prime = concatBytes(DST, i2osp(DST.length, 1));
  const Z_pad = i2osp(0, r_in_bytes);
  const l_i_b_str = i2osp(lenInBytes, 2);
  const b = new Array(ell);
  const b_0 = H(concatBytes(Z_pad, msg, l_i_b_str, i2osp(0, 1), DST_prime));
  b[0] = H(concatBytes(b_0, i2osp(1, 1), DST_prime));
  for (let i = 1; i <= ell; i++) {
    const args = [strxor(b_0, b[i - 1]), i2osp(i + 1, 1), DST_prime];
    b[i] = H(concatBytes(...args));
  }
  const pseudo_random_bytes = concatBytes(...b);
  return pseudo_random_bytes.slice(0, lenInBytes);
}
function expand_message_xof(msg, DST, lenInBytes, k, H) {
  abytes(msg);
  anum(lenInBytes);
  DST = normDST(DST);
  if (DST.length > 255) {
    const dkLen = Math.ceil(2 * k / 8);
    DST = H.create({ dkLen }).update(utf8ToBytes("H2C-OVERSIZE-DST-")).update(DST).digest();
  }
  if (lenInBytes > 65535 || DST.length > 255)
    throw new Error("expand_message_xof: invalid lenInBytes");
  return H.create({ dkLen: lenInBytes }).update(msg).update(i2osp(lenInBytes, 2)).update(DST).update(i2osp(DST.length, 1)).digest();
}
function hash_to_field(msg, count, options) {
  _validateObject(options, {
    p: "bigint",
    m: "number",
    k: "number",
    hash: "function"
  });
  const { p, k, m, hash: hash2, expand, DST } = options;
  if (!isHash(options.hash))
    throw new Error("expected valid hash");
  abytes(msg);
  anum(count);
  const log2p = p.toString(2).length;
  const L = Math.ceil((log2p + k) / 8);
  const len_in_bytes = count * m * L;
  let prb;
  if (expand === "xmd") {
    prb = expand_message_xmd(msg, DST, len_in_bytes, hash2);
  } else if (expand === "xof") {
    prb = expand_message_xof(msg, DST, len_in_bytes, k, hash2);
  } else if (expand === "_internal_pass") {
    prb = msg;
  } else {
    throw new Error('expand must be "xmd" or "xof"');
  }
  const u = new Array(count);
  for (let i = 0; i < count; i++) {
    const e = new Array(m);
    for (let j = 0; j < m; j++) {
      const elm_offset = L * (j + i * m);
      const tv = prb.subarray(elm_offset, elm_offset + L);
      e[j] = mod(os2ip(tv), p);
    }
    u[i] = e;
  }
  return u;
}
function isogenyMap(field, map) {
  const coeff = map.map((i) => Array.from(i).reverse());
  return (x, y) => {
    const [xn, xd, yn, yd] = coeff.map((val) => val.reduce((acc, i) => field.add(field.mul(acc, x), i)));
    const [xd_inv, yd_inv] = FpInvertBatch(field, [xd, yd], true);
    x = field.mul(xn, xd_inv);
    y = field.mul(y, field.mul(yn, yd_inv));
    return { x, y };
  };
}
var _DST_scalar = utf8ToBytes("HashToScalar-");
function createHasher2(Point, mapToCurve, defaults) {
  if (typeof mapToCurve !== "function")
    throw new Error("mapToCurve() must be defined");
  function map(num) {
    return Point.fromAffine(mapToCurve(num));
  }
  function clear2(initial) {
    const P = initial.clearCofactor();
    if (P.equals(Point.ZERO))
      return Point.ZERO;
    P.assertValidity();
    return P;
  }
  return {
    defaults,
    hashToCurve(msg, options) {
      const opts = Object.assign({}, defaults, options);
      const u = hash_to_field(msg, 2, opts);
      const u0 = map(u[0]);
      const u1 = map(u[1]);
      return clear2(u0.add(u1));
    },
    encodeToCurve(msg, options) {
      const optsDst = defaults.encodeDST ? { DST: defaults.encodeDST } : {};
      const opts = Object.assign({}, defaults, optsDst, options);
      const u = hash_to_field(msg, 1, opts);
      const u0 = map(u[0]);
      return clear2(u0);
    },
    /** See {@link H2CHasher} */
    mapToCurve(scalars) {
      if (!Array.isArray(scalars))
        throw new Error("expected array of bigints");
      for (const i of scalars)
        if (typeof i !== "bigint")
          throw new Error("expected array of bigints");
      return clear2(map(scalars));
    },
    // hash_to_scalar can produce 0: https://www.rfc-editor.org/errata/eid8393
    // RFC 9380, draft-irtf-cfrg-bbs-signatures-08
    hashToScalar(msg, options) {
      const N = Point.Fn.ORDER;
      const opts = Object.assign({}, defaults, { p: N, m: 1, DST: _DST_scalar }, options);
      return hash_to_field(msg, 1, opts)[0][0];
    }
  };
}

// node_modules/@noble/curves/esm/abstract/weierstrass.js
var divNearest = (num, den) => (num + (num >= 0 ? den : -den) / _2n2) / den;
function _splitEndoScalar(k, basis, n) {
  const [[a1, b1], [a2, b2]] = basis;
  const c1 = divNearest(b2 * k, n);
  const c2 = divNearest(-b1 * k, n);
  let k1 = k - c1 * a1 - c2 * a2;
  let k2 = -c1 * b1 - c2 * b2;
  const k1neg = k1 < _0n4;
  const k2neg = k2 < _0n4;
  if (k1neg)
    k1 = -k1;
  if (k2neg)
    k2 = -k2;
  const MAX_NUM = bitMask(Math.ceil(bitLen(n) / 2)) + _1n4;
  if (k1 < _0n4 || k1 >= MAX_NUM || k2 < _0n4 || k2 >= MAX_NUM) {
    throw new Error("splitScalar (endomorphism): failed, k=" + k);
  }
  return { k1neg, k1, k2neg, k2 };
}
var _0n4 = BigInt(0);
var _1n4 = BigInt(1);
var _2n2 = BigInt(2);
var _3n2 = BigInt(3);
var _4n2 = BigInt(4);
function _normFnElement(Fn, key) {
  const { BYTES: expected } = Fn;
  let num;
  if (typeof key === "bigint") {
    num = key;
  } else {
    let bytes = ensureBytes("private key", key);
    try {
      num = Fn.fromBytes(bytes);
    } catch (error) {
      throw new Error(`invalid private key: expected ui8a of size ${expected}, got ${typeof key}`);
    }
  }
  if (!Fn.isValidNot0(num))
    throw new Error("invalid private key: out of range [1..N-1]");
  return num;
}
function weierstrassN(params, extraOpts = {}) {
  const validated = _createCurveFields("weierstrass", params, extraOpts);
  const { Fp: Fp3, Fn } = validated;
  let CURVE = validated.CURVE;
  const { h: cofactor, n: CURVE_ORDER } = CURVE;
  _validateObject(extraOpts, {}, {
    allowInfinityPoint: "boolean",
    clearCofactor: "function",
    isTorsionFree: "function",
    fromBytes: "function",
    toBytes: "function",
    endo: "object",
    wrapPrivateKey: "boolean"
  });
  const { endo } = extraOpts;
  if (endo) {
    if (!Fp3.is0(CURVE.a) || typeof endo.beta !== "bigint" || !Array.isArray(endo.basises)) {
      throw new Error('invalid endo: expected "beta": bigint and "basises": array');
    }
  }
  const lengths = getWLengths(Fp3, Fn);
  function assertCompressionIsSupported() {
    if (!Fp3.isOdd)
      throw new Error("compression is not supported: Field does not have .isOdd()");
  }
  function pointToBytes(_c, point, isCompressed) {
    const { x, y } = point.toAffine();
    const bx = Fp3.toBytes(x);
    _abool2(isCompressed, "isCompressed");
    if (isCompressed) {
      assertCompressionIsSupported();
      const hasEvenY = !Fp3.isOdd(y);
      return concatBytes(pprefix(hasEvenY), bx);
    } else {
      return concatBytes(Uint8Array.of(4), bx, Fp3.toBytes(y));
    }
  }
  function pointFromBytes(bytes) {
    _abytes2(bytes, void 0, "Point");
    const { publicKey: comp, publicKeyUncompressed: uncomp } = lengths;
    const length = bytes.length;
    const head = bytes[0];
    const tail = bytes.subarray(1);
    if (length === comp && (head === 2 || head === 3)) {
      const x = Fp3.fromBytes(tail);
      if (!Fp3.isValid(x))
        throw new Error("bad point: is not on curve, wrong x");
      const y2 = weierstrassEquation(x);
      let y;
      try {
        y = Fp3.sqrt(y2);
      } catch (sqrtError) {
        const err = sqrtError instanceof Error ? ": " + sqrtError.message : "";
        throw new Error("bad point: is not on curve, sqrt error" + err);
      }
      assertCompressionIsSupported();
      const isYOdd = Fp3.isOdd(y);
      const isHeadOdd = (head & 1) === 1;
      if (isHeadOdd !== isYOdd)
        y = Fp3.neg(y);
      return { x, y };
    } else if (length === uncomp && head === 4) {
      const L = Fp3.BYTES;
      const x = Fp3.fromBytes(tail.subarray(0, L));
      const y = Fp3.fromBytes(tail.subarray(L, L * 2));
      if (!isValidXY(x, y))
        throw new Error("bad point: is not on curve");
      return { x, y };
    } else {
      throw new Error(`bad point: got length ${length}, expected compressed=${comp} or uncompressed=${uncomp}`);
    }
  }
  const encodePoint = extraOpts.toBytes || pointToBytes;
  const decodePoint = extraOpts.fromBytes || pointFromBytes;
  function weierstrassEquation(x) {
    const x2 = Fp3.sqr(x);
    const x3 = Fp3.mul(x2, x);
    return Fp3.add(Fp3.add(x3, Fp3.mul(x, CURVE.a)), CURVE.b);
  }
  function isValidXY(x, y) {
    const left = Fp3.sqr(y);
    const right = weierstrassEquation(x);
    return Fp3.eql(left, right);
  }
  if (!isValidXY(CURVE.Gx, CURVE.Gy))
    throw new Error("bad curve params: generator point");
  const _4a3 = Fp3.mul(Fp3.pow(CURVE.a, _3n2), _4n2);
  const _27b2 = Fp3.mul(Fp3.sqr(CURVE.b), BigInt(27));
  if (Fp3.is0(Fp3.add(_4a3, _27b2)))
    throw new Error("bad curve params: a or b");
  function acoord(title, n, banZero = false) {
    if (!Fp3.isValid(n) || banZero && Fp3.is0(n))
      throw new Error(`bad point coordinate ${title}`);
    return n;
  }
  function aprjpoint(other) {
    if (!(other instanceof Point))
      throw new Error("ProjectivePoint expected");
  }
  function splitEndoScalarN(k) {
    if (!endo || !endo.basises)
      throw new Error("no endo");
    return _splitEndoScalar(k, endo.basises, Fn.ORDER);
  }
  const toAffineMemo = memoized((p, iz) => {
    const { X, Y, Z } = p;
    if (Fp3.eql(Z, Fp3.ONE))
      return { x: X, y: Y };
    const is0 = p.is0();
    if (iz == null)
      iz = is0 ? Fp3.ONE : Fp3.inv(Z);
    const x = Fp3.mul(X, iz);
    const y = Fp3.mul(Y, iz);
    const zz = Fp3.mul(Z, iz);
    if (is0)
      return { x: Fp3.ZERO, y: Fp3.ZERO };
    if (!Fp3.eql(zz, Fp3.ONE))
      throw new Error("invZ was invalid");
    return { x, y };
  });
  const assertValidMemo = memoized((p) => {
    if (p.is0()) {
      if (extraOpts.allowInfinityPoint && !Fp3.is0(p.Y))
        return;
      throw new Error("bad point: ZERO");
    }
    const { x, y } = p.toAffine();
    if (!Fp3.isValid(x) || !Fp3.isValid(y))
      throw new Error("bad point: x or y not field elements");
    if (!isValidXY(x, y))
      throw new Error("bad point: equation left != right");
    if (!p.isTorsionFree())
      throw new Error("bad point: not in prime-order subgroup");
    return true;
  });
  function finishEndo(endoBeta, k1p, k2p, k1neg, k2neg) {
    k2p = new Point(Fp3.mul(k2p.X, endoBeta), k2p.Y, k2p.Z);
    k1p = negateCt(k1neg, k1p);
    k2p = negateCt(k2neg, k2p);
    return k1p.add(k2p);
  }
  class Point {
    /** Does NOT validate if the point is valid. Use `.assertValidity()`. */
    constructor(X, Y, Z) {
      this.X = acoord("x", X);
      this.Y = acoord("y", Y, true);
      this.Z = acoord("z", Z);
      Object.freeze(this);
    }
    static CURVE() {
      return CURVE;
    }
    /** Does NOT validate if the point is valid. Use `.assertValidity()`. */
    static fromAffine(p) {
      const { x, y } = p || {};
      if (!p || !Fp3.isValid(x) || !Fp3.isValid(y))
        throw new Error("invalid affine point");
      if (p instanceof Point)
        throw new Error("projective point not allowed");
      if (Fp3.is0(x) && Fp3.is0(y))
        return Point.ZERO;
      return new Point(x, y, Fp3.ONE);
    }
    static fromBytes(bytes) {
      const P = Point.fromAffine(decodePoint(_abytes2(bytes, void 0, "point")));
      P.assertValidity();
      return P;
    }
    static fromHex(hex) {
      return Point.fromBytes(ensureBytes("pointHex", hex));
    }
    get x() {
      return this.toAffine().x;
    }
    get y() {
      return this.toAffine().y;
    }
    /**
     *
     * @param windowSize
     * @param isLazy true will defer table computation until the first multiplication
     * @returns
     */
    precompute(windowSize = 8, isLazy = true) {
      wnaf.createCache(this, windowSize);
      if (!isLazy)
        this.multiply(_3n2);
      return this;
    }
    // TODO: return `this`
    /** A point on curve is valid if it conforms to equation. */
    assertValidity() {
      assertValidMemo(this);
    }
    hasEvenY() {
      const { y } = this.toAffine();
      if (!Fp3.isOdd)
        throw new Error("Field doesn't support isOdd");
      return !Fp3.isOdd(y);
    }
    /** Compare one point to another. */
    equals(other) {
      aprjpoint(other);
      const { X: X1, Y: Y1, Z: Z1 } = this;
      const { X: X2, Y: Y2, Z: Z2 } = other;
      const U1 = Fp3.eql(Fp3.mul(X1, Z2), Fp3.mul(X2, Z1));
      const U2 = Fp3.eql(Fp3.mul(Y1, Z2), Fp3.mul(Y2, Z1));
      return U1 && U2;
    }
    /** Flips point to one corresponding to (x, -y) in Affine coordinates. */
    negate() {
      return new Point(this.X, Fp3.neg(this.Y), this.Z);
    }
    // Renes-Costello-Batina exception-free doubling formula.
    // There is 30% faster Jacobian formula, but it is not complete.
    // https://eprint.iacr.org/2015/1060, algorithm 3
    // Cost: 8M + 3S + 3*a + 2*b3 + 15add.
    double() {
      const { a, b } = CURVE;
      const b3 = Fp3.mul(b, _3n2);
      const { X: X1, Y: Y1, Z: Z1 } = this;
      let X3 = Fp3.ZERO, Y3 = Fp3.ZERO, Z3 = Fp3.ZERO;
      let t0 = Fp3.mul(X1, X1);
      let t1 = Fp3.mul(Y1, Y1);
      let t2 = Fp3.mul(Z1, Z1);
      let t3 = Fp3.mul(X1, Y1);
      t3 = Fp3.add(t3, t3);
      Z3 = Fp3.mul(X1, Z1);
      Z3 = Fp3.add(Z3, Z3);
      X3 = Fp3.mul(a, Z3);
      Y3 = Fp3.mul(b3, t2);
      Y3 = Fp3.add(X3, Y3);
      X3 = Fp3.sub(t1, Y3);
      Y3 = Fp3.add(t1, Y3);
      Y3 = Fp3.mul(X3, Y3);
      X3 = Fp3.mul(t3, X3);
      Z3 = Fp3.mul(b3, Z3);
      t2 = Fp3.mul(a, t2);
      t3 = Fp3.sub(t0, t2);
      t3 = Fp3.mul(a, t3);
      t3 = Fp3.add(t3, Z3);
      Z3 = Fp3.add(t0, t0);
      t0 = Fp3.add(Z3, t0);
      t0 = Fp3.add(t0, t2);
      t0 = Fp3.mul(t0, t3);
      Y3 = Fp3.add(Y3, t0);
      t2 = Fp3.mul(Y1, Z1);
      t2 = Fp3.add(t2, t2);
      t0 = Fp3.mul(t2, t3);
      X3 = Fp3.sub(X3, t0);
      Z3 = Fp3.mul(t2, t1);
      Z3 = Fp3.add(Z3, Z3);
      Z3 = Fp3.add(Z3, Z3);
      return new Point(X3, Y3, Z3);
    }
    // Renes-Costello-Batina exception-free addition formula.
    // There is 30% faster Jacobian formula, but it is not complete.
    // https://eprint.iacr.org/2015/1060, algorithm 1
    // Cost: 12M + 0S + 3*a + 3*b3 + 23add.
    add(other) {
      aprjpoint(other);
      const { X: X1, Y: Y1, Z: Z1 } = this;
      const { X: X2, Y: Y2, Z: Z2 } = other;
      let X3 = Fp3.ZERO, Y3 = Fp3.ZERO, Z3 = Fp3.ZERO;
      const a = CURVE.a;
      const b3 = Fp3.mul(CURVE.b, _3n2);
      let t0 = Fp3.mul(X1, X2);
      let t1 = Fp3.mul(Y1, Y2);
      let t2 = Fp3.mul(Z1, Z2);
      let t3 = Fp3.add(X1, Y1);
      let t4 = Fp3.add(X2, Y2);
      t3 = Fp3.mul(t3, t4);
      t4 = Fp3.add(t0, t1);
      t3 = Fp3.sub(t3, t4);
      t4 = Fp3.add(X1, Z1);
      let t5 = Fp3.add(X2, Z2);
      t4 = Fp3.mul(t4, t5);
      t5 = Fp3.add(t0, t2);
      t4 = Fp3.sub(t4, t5);
      t5 = Fp3.add(Y1, Z1);
      X3 = Fp3.add(Y2, Z2);
      t5 = Fp3.mul(t5, X3);
      X3 = Fp3.add(t1, t2);
      t5 = Fp3.sub(t5, X3);
      Z3 = Fp3.mul(a, t4);
      X3 = Fp3.mul(b3, t2);
      Z3 = Fp3.add(X3, Z3);
      X3 = Fp3.sub(t1, Z3);
      Z3 = Fp3.add(t1, Z3);
      Y3 = Fp3.mul(X3, Z3);
      t1 = Fp3.add(t0, t0);
      t1 = Fp3.add(t1, t0);
      t2 = Fp3.mul(a, t2);
      t4 = Fp3.mul(b3, t4);
      t1 = Fp3.add(t1, t2);
      t2 = Fp3.sub(t0, t2);
      t2 = Fp3.mul(a, t2);
      t4 = Fp3.add(t4, t2);
      t0 = Fp3.mul(t1, t4);
      Y3 = Fp3.add(Y3, t0);
      t0 = Fp3.mul(t5, t4);
      X3 = Fp3.mul(t3, X3);
      X3 = Fp3.sub(X3, t0);
      t0 = Fp3.mul(t3, t1);
      Z3 = Fp3.mul(t5, Z3);
      Z3 = Fp3.add(Z3, t0);
      return new Point(X3, Y3, Z3);
    }
    subtract(other) {
      return this.add(other.negate());
    }
    is0() {
      return this.equals(Point.ZERO);
    }
    /**
     * Constant time multiplication.
     * Uses wNAF method. Windowed method may be 10% faster,
     * but takes 2x longer to generate and consumes 2x memory.
     * Uses precomputes when available.
     * Uses endomorphism for Koblitz curves.
     * @param scalar by which the point would be multiplied
     * @returns New point
     */
    multiply(scalar) {
      const { endo: endo2 } = extraOpts;
      if (!Fn.isValidNot0(scalar))
        throw new Error("invalid scalar: out of range");
      let point, fake;
      const mul = (n) => wnaf.cached(this, n, (p) => normalizeZ(Point, p));
      if (endo2) {
        const { k1neg, k1, k2neg, k2 } = splitEndoScalarN(scalar);
        const { p: k1p, f: k1f } = mul(k1);
        const { p: k2p, f: k2f } = mul(k2);
        fake = k1f.add(k2f);
        point = finishEndo(endo2.beta, k1p, k2p, k1neg, k2neg);
      } else {
        const { p, f } = mul(scalar);
        point = p;
        fake = f;
      }
      return normalizeZ(Point, [point, fake])[0];
    }
    /**
     * Non-constant-time multiplication. Uses double-and-add algorithm.
     * It's faster, but should only be used when you don't care about
     * an exposed secret key e.g. sig verification, which works over *public* keys.
     */
    multiplyUnsafe(sc) {
      const { endo: endo2 } = extraOpts;
      const p = this;
      if (!Fn.isValid(sc))
        throw new Error("invalid scalar: out of range");
      if (sc === _0n4 || p.is0())
        return Point.ZERO;
      if (sc === _1n4)
        return p;
      if (wnaf.hasCache(this))
        return this.multiply(sc);
      if (endo2) {
        const { k1neg, k1, k2neg, k2 } = splitEndoScalarN(sc);
        const { p1, p2 } = mulEndoUnsafe(Point, p, k1, k2);
        return finishEndo(endo2.beta, p1, p2, k1neg, k2neg);
      } else {
        return wnaf.unsafe(p, sc);
      }
    }
    multiplyAndAddUnsafe(Q, a, b) {
      const sum = this.multiplyUnsafe(a).add(Q.multiplyUnsafe(b));
      return sum.is0() ? void 0 : sum;
    }
    /**
     * Converts Projective point to affine (x, y) coordinates.
     * @param invertedZ Z^-1 (inverted zero) - optional, precomputation is useful for invertBatch
     */
    toAffine(invertedZ) {
      return toAffineMemo(this, invertedZ);
    }
    /**
     * Checks whether Point is free of torsion elements (is in prime subgroup).
     * Always torsion-free for cofactor=1 curves.
     */
    isTorsionFree() {
      const { isTorsionFree } = extraOpts;
      if (cofactor === _1n4)
        return true;
      if (isTorsionFree)
        return isTorsionFree(Point, this);
      return wnaf.unsafe(this, CURVE_ORDER).is0();
    }
    clearCofactor() {
      const { clearCofactor } = extraOpts;
      if (cofactor === _1n4)
        return this;
      if (clearCofactor)
        return clearCofactor(Point, this);
      return this.multiplyUnsafe(cofactor);
    }
    isSmallOrder() {
      return this.multiplyUnsafe(cofactor).is0();
    }
    toBytes(isCompressed = true) {
      _abool2(isCompressed, "isCompressed");
      this.assertValidity();
      return encodePoint(Point, this, isCompressed);
    }
    toHex(isCompressed = true) {
      return bytesToHex(this.toBytes(isCompressed));
    }
    toString() {
      return `<Point ${this.is0() ? "ZERO" : this.toHex()}>`;
    }
    // TODO: remove
    get px() {
      return this.X;
    }
    get py() {
      return this.X;
    }
    get pz() {
      return this.Z;
    }
    toRawBytes(isCompressed = true) {
      return this.toBytes(isCompressed);
    }
    _setWindowSize(windowSize) {
      this.precompute(windowSize);
    }
    static normalizeZ(points) {
      return normalizeZ(Point, points);
    }
    static msm(points, scalars) {
      return pippenger(Point, Fn, points, scalars);
    }
    static fromPrivateKey(privateKey) {
      return Point.BASE.multiply(_normFnElement(Fn, privateKey));
    }
  }
  Point.BASE = new Point(CURVE.Gx, CURVE.Gy, Fp3.ONE);
  Point.ZERO = new Point(Fp3.ZERO, Fp3.ONE, Fp3.ZERO);
  Point.Fp = Fp3;
  Point.Fn = Fn;
  const bits = Fn.BITS;
  const wnaf = new wNAF(Point, extraOpts.endo ? Math.ceil(bits / 2) : bits);
  Point.BASE.precompute(8);
  return Point;
}
function pprefix(hasEvenY) {
  return Uint8Array.of(hasEvenY ? 2 : 3);
}
function SWUFpSqrtRatio(Fp3, Z) {
  const q = Fp3.ORDER;
  let l = _0n4;
  for (let o = q - _1n4; o % _2n2 === _0n4; o /= _2n2)
    l += _1n4;
  const c1 = l;
  const _2n_pow_c1_1 = _2n2 << c1 - _1n4 - _1n4;
  const _2n_pow_c1 = _2n_pow_c1_1 * _2n2;
  const c2 = (q - _1n4) / _2n_pow_c1;
  const c3 = (c2 - _1n4) / _2n2;
  const c4 = _2n_pow_c1 - _1n4;
  const c5 = _2n_pow_c1_1;
  const c6 = Fp3.pow(Z, c2);
  const c7 = Fp3.pow(Z, (c2 + _1n4) / _2n2);
  let sqrtRatio = (u, v) => {
    let tv1 = c6;
    let tv2 = Fp3.pow(v, c4);
    let tv3 = Fp3.sqr(tv2);
    tv3 = Fp3.mul(tv3, v);
    let tv5 = Fp3.mul(u, tv3);
    tv5 = Fp3.pow(tv5, c3);
    tv5 = Fp3.mul(tv5, tv2);
    tv2 = Fp3.mul(tv5, v);
    tv3 = Fp3.mul(tv5, u);
    let tv4 = Fp3.mul(tv3, tv2);
    tv5 = Fp3.pow(tv4, c5);
    let isQR = Fp3.eql(tv5, Fp3.ONE);
    tv2 = Fp3.mul(tv3, c7);
    tv5 = Fp3.mul(tv4, tv1);
    tv3 = Fp3.cmov(tv2, tv3, isQR);
    tv4 = Fp3.cmov(tv5, tv4, isQR);
    for (let i = c1; i > _1n4; i--) {
      let tv52 = i - _2n2;
      tv52 = _2n2 << tv52 - _1n4;
      let tvv5 = Fp3.pow(tv4, tv52);
      const e1 = Fp3.eql(tvv5, Fp3.ONE);
      tv2 = Fp3.mul(tv3, tv1);
      tv1 = Fp3.mul(tv1, tv1);
      tvv5 = Fp3.mul(tv4, tv1);
      tv3 = Fp3.cmov(tv2, tv3, e1);
      tv4 = Fp3.cmov(tvv5, tv4, e1);
    }
    return { isValid: isQR, value: tv3 };
  };
  if (Fp3.ORDER % _4n2 === _3n2) {
    const c12 = (Fp3.ORDER - _3n2) / _4n2;
    const c22 = Fp3.sqrt(Fp3.neg(Z));
    sqrtRatio = (u, v) => {
      let tv1 = Fp3.sqr(v);
      const tv2 = Fp3.mul(u, v);
      tv1 = Fp3.mul(tv1, tv2);
      let y1 = Fp3.pow(tv1, c12);
      y1 = Fp3.mul(y1, tv2);
      const y2 = Fp3.mul(y1, c22);
      const tv3 = Fp3.mul(Fp3.sqr(y1), v);
      const isQR = Fp3.eql(tv3, u);
      let y = Fp3.cmov(y2, y1, isQR);
      return { isValid: isQR, value: y };
    };
  }
  return sqrtRatio;
}
function mapToCurveSimpleSWU(Fp3, opts) {
  validateField(Fp3);
  const { A, B, Z } = opts;
  if (!Fp3.isValid(A) || !Fp3.isValid(B) || !Fp3.isValid(Z))
    throw new Error("mapToCurveSimpleSWU: invalid opts");
  const sqrtRatio = SWUFpSqrtRatio(Fp3, Z);
  if (!Fp3.isOdd)
    throw new Error("Field does not have .isOdd()");
  return (u) => {
    let tv1, tv2, tv3, tv4, tv5, tv6, x, y;
    tv1 = Fp3.sqr(u);
    tv1 = Fp3.mul(tv1, Z);
    tv2 = Fp3.sqr(tv1);
    tv2 = Fp3.add(tv2, tv1);
    tv3 = Fp3.add(tv2, Fp3.ONE);
    tv3 = Fp3.mul(tv3, B);
    tv4 = Fp3.cmov(Z, Fp3.neg(tv2), !Fp3.eql(tv2, Fp3.ZERO));
    tv4 = Fp3.mul(tv4, A);
    tv2 = Fp3.sqr(tv3);
    tv6 = Fp3.sqr(tv4);
    tv5 = Fp3.mul(tv6, A);
    tv2 = Fp3.add(tv2, tv5);
    tv2 = Fp3.mul(tv2, tv3);
    tv6 = Fp3.mul(tv6, tv4);
    tv5 = Fp3.mul(tv6, B);
    tv2 = Fp3.add(tv2, tv5);
    x = Fp3.mul(tv1, tv3);
    const { isValid, value } = sqrtRatio(tv2, tv6);
    y = Fp3.mul(tv1, u);
    y = Fp3.mul(y, value);
    x = Fp3.cmov(x, tv3, isValid);
    y = Fp3.cmov(y, value, isValid);
    const e1 = Fp3.isOdd(u) === Fp3.isOdd(y);
    y = Fp3.cmov(Fp3.neg(y), y, e1);
    const tv4_inv = FpInvertBatch(Fp3, [tv4], true)[0];
    x = Fp3.mul(x, tv4_inv);
    return { x, y };
  };
}
function getWLengths(Fp3, Fn) {
  return {
    secretKey: Fn.BYTES,
    publicKey: 1 + Fp3.BYTES,
    publicKeyUncompressed: 1 + 2 * Fp3.BYTES,
    publicKeyHasPrefix: true,
    signature: 2 * Fn.BYTES
  };
}
function weierstrassPoints(c) {
  const { CURVE, curveOpts } = _weierstrass_legacy_opts_to_new(c);
  const Point = weierstrassN(CURVE, curveOpts);
  return _weierstrass_new_output_to_legacy(c, Point);
}
function _weierstrass_legacy_opts_to_new(c) {
  const CURVE = {
    a: c.a,
    b: c.b,
    p: c.Fp.ORDER,
    n: c.n,
    h: c.h,
    Gx: c.Gx,
    Gy: c.Gy
  };
  const Fp3 = c.Fp;
  let allowedLengths = c.allowedPrivateKeyLengths ? Array.from(new Set(c.allowedPrivateKeyLengths.map((l) => Math.ceil(l / 2)))) : void 0;
  const Fn = Field(CURVE.n, {
    BITS: c.nBitLength,
    allowedLengths,
    modFromBytes: c.wrapPrivateKey
  });
  const curveOpts = {
    Fp: Fp3,
    Fn,
    allowInfinityPoint: c.allowInfinityPoint,
    endo: c.endo,
    isTorsionFree: c.isTorsionFree,
    clearCofactor: c.clearCofactor,
    fromBytes: c.fromBytes,
    toBytes: c.toBytes
  };
  return { CURVE, curveOpts };
}
function _legacyHelperEquat(Fp3, a, b) {
  function weierstrassEquation(x) {
    const x2 = Fp3.sqr(x);
    const x3 = Fp3.mul(x2, x);
    return Fp3.add(Fp3.add(x3, Fp3.mul(x, a)), b);
  }
  return weierstrassEquation;
}
function _weierstrass_new_output_to_legacy(c, Point) {
  const { Fp: Fp3, Fn } = Point;
  function isWithinCurveOrder(num) {
    return inRange(num, _1n4, Fn.ORDER);
  }
  const weierstrassEquation = _legacyHelperEquat(Fp3, c.a, c.b);
  return Object.assign({}, {
    CURVE: c,
    Point,
    ProjectivePoint: Point,
    normPrivateKeyToScalar: (key) => _normFnElement(Fn, key),
    weierstrassEquation,
    isWithinCurveOrder
  });
}

// node_modules/@noble/curves/esm/abstract/bls.js
var _0n5 = BigInt(0);
var _1n5 = BigInt(1);
var _2n3 = BigInt(2);
var _3n3 = BigInt(3);
function NAfDecomposition(a) {
  const res = [];
  for (; a > _1n5; a >>= _1n5) {
    if ((a & _1n5) === _0n5)
      res.unshift(0);
    else if ((a & _3n3) === _3n3) {
      res.unshift(-1);
      a += _1n5;
    } else
      res.unshift(1);
  }
  return res;
}
function aNonEmpty(arr) {
  if (!Array.isArray(arr) || arr.length === 0)
    throw new Error("expected non-empty array");
}
function createBlsPairing(fields, G1, G2, params) {
  const { Fp2: Fp22, Fp12: Fp122 } = fields;
  const { twistType, ateLoopSize, xNegative, postPrecompute } = params;
  let lineFunction;
  if (twistType === "multiplicative") {
    lineFunction = (c0, c1, c2, f, Px, Py) => Fp122.mul014(f, c0, Fp22.mul(c1, Px), Fp22.mul(c2, Py));
  } else if (twistType === "divisive") {
    lineFunction = (c0, c1, c2, f, Px, Py) => Fp122.mul034(f, Fp22.mul(c2, Py), Fp22.mul(c1, Px), c0);
  } else
    throw new Error("bls: unknown twist type");
  const Fp2div2 = Fp22.div(Fp22.ONE, Fp22.mul(Fp22.ONE, _2n3));
  function pointDouble(ell, Rx, Ry, Rz) {
    const t0 = Fp22.sqr(Ry);
    const t1 = Fp22.sqr(Rz);
    const t2 = Fp22.mulByB(Fp22.mul(t1, _3n3));
    const t3 = Fp22.mul(t2, _3n3);
    const t4 = Fp22.sub(Fp22.sub(Fp22.sqr(Fp22.add(Ry, Rz)), t1), t0);
    const c0 = Fp22.sub(t2, t0);
    const c1 = Fp22.mul(Fp22.sqr(Rx), _3n3);
    const c2 = Fp22.neg(t4);
    ell.push([c0, c1, c2]);
    Rx = Fp22.mul(Fp22.mul(Fp22.mul(Fp22.sub(t0, t3), Rx), Ry), Fp2div2);
    Ry = Fp22.sub(Fp22.sqr(Fp22.mul(Fp22.add(t0, t3), Fp2div2)), Fp22.mul(Fp22.sqr(t2), _3n3));
    Rz = Fp22.mul(t0, t4);
    return { Rx, Ry, Rz };
  }
  function pointAdd(ell, Rx, Ry, Rz, Qx, Qy) {
    const t0 = Fp22.sub(Ry, Fp22.mul(Qy, Rz));
    const t1 = Fp22.sub(Rx, Fp22.mul(Qx, Rz));
    const c0 = Fp22.sub(Fp22.mul(t0, Qx), Fp22.mul(t1, Qy));
    const c1 = Fp22.neg(t0);
    const c2 = t1;
    ell.push([c0, c1, c2]);
    const t2 = Fp22.sqr(t1);
    const t3 = Fp22.mul(t2, t1);
    const t4 = Fp22.mul(t2, Rx);
    const t5 = Fp22.add(Fp22.sub(t3, Fp22.mul(t4, _2n3)), Fp22.mul(Fp22.sqr(t0), Rz));
    Rx = Fp22.mul(t1, t5);
    Ry = Fp22.sub(Fp22.mul(Fp22.sub(t4, t5), t0), Fp22.mul(t3, Ry));
    Rz = Fp22.mul(Rz, t3);
    return { Rx, Ry, Rz };
  }
  const ATE_NAF = NAfDecomposition(ateLoopSize);
  const calcPairingPrecomputes = memoized((point) => {
    const p = point;
    const { x, y } = p.toAffine();
    const Qx = x, Qy = y, negQy = Fp22.neg(y);
    let Rx = Qx, Ry = Qy, Rz = Fp22.ONE;
    const ell = [];
    for (const bit of ATE_NAF) {
      const cur = [];
      ({ Rx, Ry, Rz } = pointDouble(cur, Rx, Ry, Rz));
      if (bit)
        ({ Rx, Ry, Rz } = pointAdd(cur, Rx, Ry, Rz, Qx, bit === -1 ? negQy : Qy));
      ell.push(cur);
    }
    if (postPrecompute) {
      const last = ell[ell.length - 1];
      postPrecompute(Rx, Ry, Rz, Qx, Qy, pointAdd.bind(null, last));
    }
    return ell;
  });
  function millerLoopBatch(pairs, withFinalExponent = false) {
    let f12 = Fp122.ONE;
    if (pairs.length) {
      const ellLen = pairs[0][0].length;
      for (let i = 0; i < ellLen; i++) {
        f12 = Fp122.sqr(f12);
        for (const [ell, Px, Py] of pairs) {
          for (const [c0, c1, c2] of ell[i])
            f12 = lineFunction(c0, c1, c2, f12, Px, Py);
        }
      }
    }
    if (xNegative)
      f12 = Fp122.conjugate(f12);
    return withFinalExponent ? Fp122.finalExponentiate(f12) : f12;
  }
  function pairingBatch(pairs, withFinalExponent = true) {
    const res = [];
    normalizeZ(G1, pairs.map(({ g1 }) => g1));
    normalizeZ(G2, pairs.map(({ g2 }) => g2));
    for (const { g1, g2 } of pairs) {
      if (g1.is0() || g2.is0())
        throw new Error("pairing is not available for ZERO point");
      g1.assertValidity();
      g2.assertValidity();
      const Qa = g1.toAffine();
      res.push([calcPairingPrecomputes(g2), Qa.x, Qa.y]);
    }
    return millerLoopBatch(res, withFinalExponent);
  }
  function pairing(Q, P, withFinalExponent = true) {
    return pairingBatch([{ g1: Q, g2: P }], withFinalExponent);
  }
  return {
    Fp12: Fp122,
    // NOTE: we re-export Fp12 here because pairing results are Fp12!
    millerLoopBatch,
    pairing,
    pairingBatch,
    calcPairingPrecomputes
  };
}
function createBlsSig(blsPairing, PubCurve, SigCurve, SignatureCoder, isSigG1) {
  const { Fp12: Fp122, pairingBatch } = blsPairing;
  function normPub(point) {
    return point instanceof PubCurve.Point ? point : PubCurve.Point.fromHex(point);
  }
  function normSig(point) {
    return point instanceof SigCurve.Point ? point : SigCurve.Point.fromHex(point);
  }
  function amsg(m) {
    if (!(m instanceof SigCurve.Point))
      throw new Error(`expected valid message hashed to ${!isSigG1 ? "G2" : "G1"} curve`);
    return m;
  }
  const pair = !isSigG1 ? (a, b) => ({ g1: a, g2: b }) : (a, b) => ({ g1: b, g2: a });
  return {
    // P = pk x G
    getPublicKey(secretKey) {
      const sec = _normFnElement(PubCurve.Point.Fn, secretKey);
      return PubCurve.Point.BASE.multiply(sec);
    },
    // S = pk x H(m)
    sign(message, secretKey, unusedArg) {
      if (unusedArg != null)
        throw new Error("sign() expects 2 arguments");
      const sec = _normFnElement(PubCurve.Point.Fn, secretKey);
      amsg(message).assertValidity();
      return message.multiply(sec);
    },
    // Checks if pairing of public key & hash is equal to pairing of generator & signature.
    // e(P, H(m)) == e(G, S)
    // e(S, G) == e(H(m), P)
    verify(signature, message, publicKey, unusedArg) {
      if (unusedArg != null)
        throw new Error("verify() expects 3 arguments");
      signature = normSig(signature);
      publicKey = normPub(publicKey);
      const P = publicKey.negate();
      const G = PubCurve.Point.BASE;
      const Hm = amsg(message);
      const S = signature;
      const exp = pairingBatch([pair(P, Hm), pair(G, S)]);
      return Fp122.eql(exp, Fp122.ONE);
    },
    // https://ethresear.ch/t/fast-verification-of-multiple-bls-signatures/5407
    // e(G, S) = e(G, SUM(n)(Si)) = MUL(n)(e(G, Si))
    // TODO: maybe `{message: G2Hex, publicKey: G1Hex}[]` instead?
    verifyBatch(signature, messages, publicKeys) {
      aNonEmpty(messages);
      if (publicKeys.length !== messages.length)
        throw new Error("amount of public keys and messages should be equal");
      const sig = normSig(signature);
      const nMessages = messages;
      const nPublicKeys = publicKeys.map(normPub);
      const messagePubKeyMap = /* @__PURE__ */ new Map();
      for (let i = 0; i < nPublicKeys.length; i++) {
        const pub = nPublicKeys[i];
        const msg = nMessages[i];
        let keys2 = messagePubKeyMap.get(msg);
        if (keys2 === void 0) {
          keys2 = [];
          messagePubKeyMap.set(msg, keys2);
        }
        keys2.push(pub);
      }
      const paired = [];
      const G = PubCurve.Point.BASE;
      try {
        for (const [msg, keys2] of messagePubKeyMap) {
          const groupPublicKey = keys2.reduce((acc, msg2) => acc.add(msg2));
          paired.push(pair(groupPublicKey, msg));
        }
        paired.push(pair(G.negate(), sig));
        return Fp122.eql(pairingBatch(paired), Fp122.ONE);
      } catch {
        return false;
      }
    },
    // Adds a bunch of public key points together.
    // pk1 + pk2 + pk3 = pkA
    aggregatePublicKeys(publicKeys) {
      aNonEmpty(publicKeys);
      publicKeys = publicKeys.map((pub) => normPub(pub));
      const agg = publicKeys.reduce((sum, p) => sum.add(p), PubCurve.Point.ZERO);
      agg.assertValidity();
      return agg;
    },
    // Adds a bunch of signature points together.
    // pk1 + pk2 + pk3 = pkA
    aggregateSignatures(signatures) {
      aNonEmpty(signatures);
      signatures = signatures.map((sig) => normSig(sig));
      const agg = signatures.reduce((sum, s) => sum.add(s), SigCurve.Point.ZERO);
      agg.assertValidity();
      return agg;
    },
    hash(messageBytes, DST) {
      abytes(messageBytes);
      const opts = DST ? { DST } : void 0;
      return SigCurve.hashToCurve(messageBytes, opts);
    },
    Signature: SignatureCoder
  };
}
function bls(CURVE) {
  const { Fp: Fp3, Fr, Fp2: Fp22, Fp6: Fp62, Fp12: Fp122 } = CURVE.fields;
  const G1_ = weierstrassPoints(CURVE.G1);
  const G1 = Object.assign(G1_, createHasher2(G1_.Point, CURVE.G1.mapToCurve, {
    ...CURVE.htfDefaults,
    ...CURVE.G1.htfDefaults
  }));
  const G2_ = weierstrassPoints(CURVE.G2);
  const G2 = Object.assign(G2_, createHasher2(G2_.Point, CURVE.G2.mapToCurve, {
    ...CURVE.htfDefaults,
    ...CURVE.G2.htfDefaults
  }));
  const pairingRes = createBlsPairing(CURVE.fields, G1.Point, G2.Point, {
    ...CURVE.params,
    postPrecompute: CURVE.postPrecompute
  });
  const { millerLoopBatch, pairing, pairingBatch, calcPairingPrecomputes } = pairingRes;
  const longSignatures = createBlsSig(pairingRes, G1, G2, CURVE.G2.Signature, false);
  const shortSignatures = createBlsSig(pairingRes, G2, G1, CURVE.G1.ShortSignature, true);
  const rand = CURVE.randomBytes || randomBytes;
  const randomSecretKey = () => {
    const length = getMinHashLength(Fr.ORDER);
    return mapHashToField(rand(length), Fr.ORDER);
  };
  const utils = {
    randomSecretKey,
    randomPrivateKey: randomSecretKey,
    calcPairingPrecomputes
  };
  const { ShortSignature } = CURVE.G1;
  const { Signature } = CURVE.G2;
  function normP1Hash(point, htfOpts) {
    return point instanceof G1.Point ? point : shortSignatures.hash(ensureBytes("point", point), htfOpts?.DST);
  }
  function normP2Hash(point, htfOpts) {
    return point instanceof G2.Point ? point : longSignatures.hash(ensureBytes("point", point), htfOpts?.DST);
  }
  function getPublicKey(privateKey) {
    return longSignatures.getPublicKey(privateKey).toBytes(true);
  }
  function getPublicKeyForShortSignatures(privateKey) {
    return shortSignatures.getPublicKey(privateKey).toBytes(true);
  }
  function sign4(message, privateKey, htfOpts) {
    const Hm = normP2Hash(message, htfOpts);
    const S = longSignatures.sign(Hm, privateKey);
    return message instanceof G2.Point ? S : Signature.toBytes(S);
  }
  function signShortSignature(message, privateKey, htfOpts) {
    const Hm = normP1Hash(message, htfOpts);
    const S = shortSignatures.sign(Hm, privateKey);
    return message instanceof G1.Point ? S : ShortSignature.toBytes(S);
  }
  function verify4(signature, message, publicKey, htfOpts) {
    const Hm = normP2Hash(message, htfOpts);
    return longSignatures.verify(signature, Hm, publicKey);
  }
  function verifyShortSignature(signature, message, publicKey, htfOpts) {
    const Hm = normP1Hash(message, htfOpts);
    return shortSignatures.verify(signature, Hm, publicKey);
  }
  function aggregatePublicKeys(publicKeys) {
    const agg = longSignatures.aggregatePublicKeys(publicKeys);
    return publicKeys[0] instanceof G1.Point ? agg : agg.toBytes(true);
  }
  function aggregateSignatures(signatures) {
    const agg = longSignatures.aggregateSignatures(signatures);
    return signatures[0] instanceof G2.Point ? agg : Signature.toBytes(agg);
  }
  function aggregateShortSignatures(signatures) {
    const agg = shortSignatures.aggregateSignatures(signatures);
    return signatures[0] instanceof G1.Point ? agg : ShortSignature.toBytes(agg);
  }
  function verifyBatch(signature, messages, publicKeys, htfOpts) {
    const Hm = messages.map((m) => normP2Hash(m, htfOpts));
    return longSignatures.verifyBatch(signature, Hm, publicKeys);
  }
  G1.Point.BASE.precompute(4);
  return {
    longSignatures,
    shortSignatures,
    millerLoopBatch,
    pairing,
    pairingBatch,
    verifyBatch,
    fields: {
      Fr,
      Fp: Fp3,
      Fp2: Fp22,
      Fp6: Fp62,
      Fp12: Fp122
    },
    params: {
      ateLoopSize: CURVE.params.ateLoopSize,
      twistType: CURVE.params.twistType,
      // deprecated
      r: CURVE.params.r,
      G1b: CURVE.G1.b,
      G2b: CURVE.G2.b
    },
    utils,
    // deprecated
    getPublicKey,
    getPublicKeyForShortSignatures,
    sign: sign4,
    signShortSignature,
    verify: verify4,
    verifyShortSignature,
    aggregatePublicKeys,
    aggregateSignatures,
    aggregateShortSignatures,
    G1,
    G2,
    Signature,
    ShortSignature
  };
}

// node_modules/@noble/curves/esm/abstract/tower.js
var _0n6 = BigInt(0);
var _1n6 = BigInt(1);
var _2n4 = BigInt(2);
var _3n4 = BigInt(3);
function calcFrobeniusCoefficients(Fp3, nonResidue, modulus, degree, num = 1, divisor) {
  const _divisor = BigInt(divisor === void 0 ? degree : divisor);
  const towerModulus = modulus ** BigInt(degree);
  const res = [];
  for (let i = 0; i < num; i++) {
    const a = BigInt(i + 1);
    const powers = [];
    for (let j = 0, qPower = _1n6; j < degree; j++) {
      const power = (a * qPower - a) / _divisor % towerModulus;
      powers.push(Fp3.pow(nonResidue, power));
      qPower *= modulus;
    }
    res.push(powers);
  }
  return res;
}
function psiFrobenius(Fp3, Fp22, base) {
  const PSI_X = Fp22.pow(base, (Fp3.ORDER - _1n6) / _3n4);
  const PSI_Y = Fp22.pow(base, (Fp3.ORDER - _1n6) / _2n4);
  function psi(x, y) {
    const x2 = Fp22.mul(Fp22.frobeniusMap(x, 1), PSI_X);
    const y2 = Fp22.mul(Fp22.frobeniusMap(y, 1), PSI_Y);
    return [x2, y2];
  }
  const PSI2_X = Fp22.pow(base, (Fp3.ORDER ** _2n4 - _1n6) / _3n4);
  const PSI2_Y = Fp22.pow(base, (Fp3.ORDER ** _2n4 - _1n6) / _2n4);
  if (!Fp22.eql(PSI2_Y, Fp22.neg(Fp22.ONE)))
    throw new Error("psiFrobenius: PSI2_Y!==-1");
  function psi2(x, y) {
    return [Fp22.mul(x, PSI2_X), Fp22.neg(y)];
  }
  const mapAffine = (fn) => (c, P) => {
    const affine = P.toAffine();
    const p = fn(affine.x, affine.y);
    return c.fromAffine({ x: p[0], y: p[1] });
  };
  const G2psi3 = mapAffine(psi);
  const G2psi22 = mapAffine(psi2);
  return { psi, psi2, G2psi: G2psi3, G2psi2: G2psi22, PSI_X, PSI_Y, PSI2_X, PSI2_Y };
}
var Fp2fromBigTuple = (Fp3, tuple) => {
  if (tuple.length !== 2)
    throw new Error("invalid tuple");
  const fps = tuple.map((n) => Fp3.create(n));
  return { c0: fps[0], c1: fps[1] };
};
var _Field2 = class {
  constructor(Fp3, opts = {}) {
    this.MASK = _1n6;
    const ORDER = Fp3.ORDER;
    const FP2_ORDER = ORDER * ORDER;
    this.Fp = Fp3;
    this.ORDER = FP2_ORDER;
    this.BITS = bitLen(FP2_ORDER);
    this.BYTES = Math.ceil(bitLen(FP2_ORDER) / 8);
    this.isLE = Fp3.isLE;
    this.ZERO = { c0: Fp3.ZERO, c1: Fp3.ZERO };
    this.ONE = { c0: Fp3.ONE, c1: Fp3.ZERO };
    this.Fp_NONRESIDUE = Fp3.create(opts.NONRESIDUE || BigInt(-1));
    this.Fp_div2 = Fp3.div(Fp3.ONE, _2n4);
    this.NONRESIDUE = Fp2fromBigTuple(Fp3, opts.FP2_NONRESIDUE);
    this.FROBENIUS_COEFFICIENTS = calcFrobeniusCoefficients(Fp3, this.Fp_NONRESIDUE, Fp3.ORDER, 2)[0];
    this.mulByB = opts.Fp2mulByB;
    Object.seal(this);
  }
  fromBigTuple(tuple) {
    return Fp2fromBigTuple(this.Fp, tuple);
  }
  create(num) {
    return num;
  }
  isValid({ c0, c1 }) {
    function isValidC(num, ORDER) {
      return typeof num === "bigint" && _0n6 <= num && num < ORDER;
    }
    return isValidC(c0, this.ORDER) && isValidC(c1, this.ORDER);
  }
  is0({ c0, c1 }) {
    return this.Fp.is0(c0) && this.Fp.is0(c1);
  }
  isValidNot0(num) {
    return !this.is0(num) && this.isValid(num);
  }
  eql({ c0, c1 }, { c0: r0, c1: r1 }) {
    return this.Fp.eql(c0, r0) && this.Fp.eql(c1, r1);
  }
  neg({ c0, c1 }) {
    return { c0: this.Fp.neg(c0), c1: this.Fp.neg(c1) };
  }
  pow(num, power) {
    return FpPow(this, num, power);
  }
  invertBatch(nums) {
    return FpInvertBatch(this, nums);
  }
  // Normalized
  add(f1, f2) {
    const { c0, c1 } = f1;
    const { c0: r0, c1: r1 } = f2;
    return {
      c0: this.Fp.add(c0, r0),
      c1: this.Fp.add(c1, r1)
    };
  }
  sub({ c0, c1 }, { c0: r0, c1: r1 }) {
    return {
      c0: this.Fp.sub(c0, r0),
      c1: this.Fp.sub(c1, r1)
    };
  }
  mul({ c0, c1 }, rhs) {
    const { Fp: Fp3 } = this;
    if (typeof rhs === "bigint")
      return { c0: Fp3.mul(c0, rhs), c1: Fp3.mul(c1, rhs) };
    const { c0: r0, c1: r1 } = rhs;
    let t1 = Fp3.mul(c0, r0);
    let t2 = Fp3.mul(c1, r1);
    const o0 = Fp3.sub(t1, t2);
    const o1 = Fp3.sub(Fp3.mul(Fp3.add(c0, c1), Fp3.add(r0, r1)), Fp3.add(t1, t2));
    return { c0: o0, c1: o1 };
  }
  sqr({ c0, c1 }) {
    const { Fp: Fp3 } = this;
    const a = Fp3.add(c0, c1);
    const b = Fp3.sub(c0, c1);
    const c = Fp3.add(c0, c0);
    return { c0: Fp3.mul(a, b), c1: Fp3.mul(c, c1) };
  }
  // NonNormalized stuff
  addN(a, b) {
    return this.add(a, b);
  }
  subN(a, b) {
    return this.sub(a, b);
  }
  mulN(a, b) {
    return this.mul(a, b);
  }
  sqrN(a) {
    return this.sqr(a);
  }
  // Why inversion for bigint inside Fp instead of Fp2? it is even used in that context?
  div(lhs, rhs) {
    const { Fp: Fp3 } = this;
    return this.mul(lhs, typeof rhs === "bigint" ? Fp3.inv(Fp3.create(rhs)) : this.inv(rhs));
  }
  inv({ c0: a, c1: b }) {
    const { Fp: Fp3 } = this;
    const factor = Fp3.inv(Fp3.create(a * a + b * b));
    return { c0: Fp3.mul(factor, Fp3.create(a)), c1: Fp3.mul(factor, Fp3.create(-b)) };
  }
  sqrt(num) {
    const { Fp: Fp3 } = this;
    const Fp22 = this;
    const { c0, c1 } = num;
    if (Fp3.is0(c1)) {
      if (FpLegendre(Fp3, c0) === 1)
        return Fp22.create({ c0: Fp3.sqrt(c0), c1: Fp3.ZERO });
      else
        return Fp22.create({ c0: Fp3.ZERO, c1: Fp3.sqrt(Fp3.div(c0, this.Fp_NONRESIDUE)) });
    }
    const a = Fp3.sqrt(Fp3.sub(Fp3.sqr(c0), Fp3.mul(Fp3.sqr(c1), this.Fp_NONRESIDUE)));
    let d = Fp3.mul(Fp3.add(a, c0), this.Fp_div2);
    const legendre = FpLegendre(Fp3, d);
    if (legendre === -1)
      d = Fp3.sub(d, a);
    const a0 = Fp3.sqrt(d);
    const candidateSqrt = Fp22.create({ c0: a0, c1: Fp3.div(Fp3.mul(c1, this.Fp_div2), a0) });
    if (!Fp22.eql(Fp22.sqr(candidateSqrt), num))
      throw new Error("Cannot find square root");
    const x1 = candidateSqrt;
    const x2 = Fp22.neg(x1);
    const { re: re1, im: im1 } = Fp22.reim(x1);
    const { re: re2, im: im2 } = Fp22.reim(x2);
    if (im1 > im2 || im1 === im2 && re1 > re2)
      return x1;
    return x2;
  }
  // Same as sgn0_m_eq_2 in RFC 9380
  isOdd(x) {
    const { re: x0, im: x1 } = this.reim(x);
    const sign_0 = x0 % _2n4;
    const zero_0 = x0 === _0n6;
    const sign_1 = x1 % _2n4;
    return BigInt(sign_0 || zero_0 && sign_1) == _1n6;
  }
  // Bytes util
  fromBytes(b) {
    const { Fp: Fp3 } = this;
    if (b.length !== this.BYTES)
      throw new Error("fromBytes invalid length=" + b.length);
    return { c0: Fp3.fromBytes(b.subarray(0, Fp3.BYTES)), c1: Fp3.fromBytes(b.subarray(Fp3.BYTES)) };
  }
  toBytes({ c0, c1 }) {
    return concatBytes(this.Fp.toBytes(c0), this.Fp.toBytes(c1));
  }
  cmov({ c0, c1 }, { c0: r0, c1: r1 }, c) {
    return {
      c0: this.Fp.cmov(c0, r0, c),
      c1: this.Fp.cmov(c1, r1, c)
    };
  }
  reim({ c0, c1 }) {
    return { re: c0, im: c1 };
  }
  Fp4Square(a, b) {
    const Fp22 = this;
    const a2 = Fp22.sqr(a);
    const b2 = Fp22.sqr(b);
    return {
      first: Fp22.add(Fp22.mulByNonresidue(b2), a2),
      // b² * Nonresidue + a²
      second: Fp22.sub(Fp22.sub(Fp22.sqr(Fp22.add(a, b)), a2), b2)
      // (a + b)² - a² - b²
    };
  }
  // multiply by u + 1
  mulByNonresidue({ c0, c1 }) {
    return this.mul({ c0, c1 }, this.NONRESIDUE);
  }
  frobeniusMap({ c0, c1 }, power) {
    return {
      c0,
      c1: this.Fp.mul(c1, this.FROBENIUS_COEFFICIENTS[power % 2])
    };
  }
};
var _Field6 = class {
  constructor(Fp22) {
    this.MASK = _1n6;
    this.Fp2 = Fp22;
    this.ORDER = Fp22.ORDER;
    this.BITS = 3 * Fp22.BITS;
    this.BYTES = 3 * Fp22.BYTES;
    this.isLE = Fp22.isLE;
    this.ZERO = { c0: Fp22.ZERO, c1: Fp22.ZERO, c2: Fp22.ZERO };
    this.ONE = { c0: Fp22.ONE, c1: Fp22.ZERO, c2: Fp22.ZERO };
    const { Fp: Fp3 } = Fp22;
    const frob = calcFrobeniusCoefficients(Fp22, Fp22.NONRESIDUE, Fp3.ORDER, 6, 2, 3);
    this.FROBENIUS_COEFFICIENTS_1 = frob[0];
    this.FROBENIUS_COEFFICIENTS_2 = frob[1];
    Object.seal(this);
  }
  add({ c0, c1, c2 }, { c0: r0, c1: r1, c2: r2 }) {
    const { Fp2: Fp22 } = this;
    return {
      c0: Fp22.add(c0, r0),
      c1: Fp22.add(c1, r1),
      c2: Fp22.add(c2, r2)
    };
  }
  sub({ c0, c1, c2 }, { c0: r0, c1: r1, c2: r2 }) {
    const { Fp2: Fp22 } = this;
    return {
      c0: Fp22.sub(c0, r0),
      c1: Fp22.sub(c1, r1),
      c2: Fp22.sub(c2, r2)
    };
  }
  mul({ c0, c1, c2 }, rhs) {
    const { Fp2: Fp22 } = this;
    if (typeof rhs === "bigint") {
      return {
        c0: Fp22.mul(c0, rhs),
        c1: Fp22.mul(c1, rhs),
        c2: Fp22.mul(c2, rhs)
      };
    }
    const { c0: r0, c1: r1, c2: r2 } = rhs;
    const t0 = Fp22.mul(c0, r0);
    const t1 = Fp22.mul(c1, r1);
    const t2 = Fp22.mul(c2, r2);
    return {
      // t0 + (c1 + c2) * (r1 * r2) - (T1 + T2) * (u + 1)
      c0: Fp22.add(t0, Fp22.mulByNonresidue(Fp22.sub(Fp22.mul(Fp22.add(c1, c2), Fp22.add(r1, r2)), Fp22.add(t1, t2)))),
      // (c0 + c1) * (r0 + r1) - (T0 + T1) + T2 * (u + 1)
      c1: Fp22.add(Fp22.sub(Fp22.mul(Fp22.add(c0, c1), Fp22.add(r0, r1)), Fp22.add(t0, t1)), Fp22.mulByNonresidue(t2)),
      // T1 + (c0 + c2) * (r0 + r2) - T0 + T2
      c2: Fp22.sub(Fp22.add(t1, Fp22.mul(Fp22.add(c0, c2), Fp22.add(r0, r2))), Fp22.add(t0, t2))
    };
  }
  sqr({ c0, c1, c2 }) {
    const { Fp2: Fp22 } = this;
    let t0 = Fp22.sqr(c0);
    let t1 = Fp22.mul(Fp22.mul(c0, c1), _2n4);
    let t3 = Fp22.mul(Fp22.mul(c1, c2), _2n4);
    let t4 = Fp22.sqr(c2);
    return {
      c0: Fp22.add(Fp22.mulByNonresidue(t3), t0),
      // T3 * (u + 1) + T0
      c1: Fp22.add(Fp22.mulByNonresidue(t4), t1),
      // T4 * (u + 1) + T1
      // T1 + (c0 - c1 + c2)² + T3 - T0 - T4
      c2: Fp22.sub(Fp22.sub(Fp22.add(Fp22.add(t1, Fp22.sqr(Fp22.add(Fp22.sub(c0, c1), c2))), t3), t0), t4)
    };
  }
  addN(a, b) {
    return this.add(a, b);
  }
  subN(a, b) {
    return this.sub(a, b);
  }
  mulN(a, b) {
    return this.mul(a, b);
  }
  sqrN(a) {
    return this.sqr(a);
  }
  create(num) {
    return num;
  }
  isValid({ c0, c1, c2 }) {
    const { Fp2: Fp22 } = this;
    return Fp22.isValid(c0) && Fp22.isValid(c1) && Fp22.isValid(c2);
  }
  is0({ c0, c1, c2 }) {
    const { Fp2: Fp22 } = this;
    return Fp22.is0(c0) && Fp22.is0(c1) && Fp22.is0(c2);
  }
  isValidNot0(num) {
    return !this.is0(num) && this.isValid(num);
  }
  neg({ c0, c1, c2 }) {
    const { Fp2: Fp22 } = this;
    return { c0: Fp22.neg(c0), c1: Fp22.neg(c1), c2: Fp22.neg(c2) };
  }
  eql({ c0, c1, c2 }, { c0: r0, c1: r1, c2: r2 }) {
    const { Fp2: Fp22 } = this;
    return Fp22.eql(c0, r0) && Fp22.eql(c1, r1) && Fp22.eql(c2, r2);
  }
  sqrt(_) {
    return notImplemented();
  }
  // Do we need division by bigint at all? Should be done via order:
  div(lhs, rhs) {
    const { Fp2: Fp22 } = this;
    const { Fp: Fp3 } = Fp22;
    return this.mul(lhs, typeof rhs === "bigint" ? Fp3.inv(Fp3.create(rhs)) : this.inv(rhs));
  }
  pow(num, power) {
    return FpPow(this, num, power);
  }
  invertBatch(nums) {
    return FpInvertBatch(this, nums);
  }
  inv({ c0, c1, c2 }) {
    const { Fp2: Fp22 } = this;
    let t0 = Fp22.sub(Fp22.sqr(c0), Fp22.mulByNonresidue(Fp22.mul(c2, c1)));
    let t1 = Fp22.sub(Fp22.mulByNonresidue(Fp22.sqr(c2)), Fp22.mul(c0, c1));
    let t2 = Fp22.sub(Fp22.sqr(c1), Fp22.mul(c0, c2));
    let t4 = Fp22.inv(Fp22.add(Fp22.mulByNonresidue(Fp22.add(Fp22.mul(c2, t1), Fp22.mul(c1, t2))), Fp22.mul(c0, t0)));
    return { c0: Fp22.mul(t4, t0), c1: Fp22.mul(t4, t1), c2: Fp22.mul(t4, t2) };
  }
  // Bytes utils
  fromBytes(b) {
    const { Fp2: Fp22 } = this;
    if (b.length !== this.BYTES)
      throw new Error("fromBytes invalid length=" + b.length);
    const B2 = Fp22.BYTES;
    return {
      c0: Fp22.fromBytes(b.subarray(0, B2)),
      c1: Fp22.fromBytes(b.subarray(B2, B2 * 2)),
      c2: Fp22.fromBytes(b.subarray(2 * B2))
    };
  }
  toBytes({ c0, c1, c2 }) {
    const { Fp2: Fp22 } = this;
    return concatBytes(Fp22.toBytes(c0), Fp22.toBytes(c1), Fp22.toBytes(c2));
  }
  cmov({ c0, c1, c2 }, { c0: r0, c1: r1, c2: r2 }, c) {
    const { Fp2: Fp22 } = this;
    return {
      c0: Fp22.cmov(c0, r0, c),
      c1: Fp22.cmov(c1, r1, c),
      c2: Fp22.cmov(c2, r2, c)
    };
  }
  fromBigSix(t) {
    const { Fp2: Fp22 } = this;
    if (!Array.isArray(t) || t.length !== 6)
      throw new Error("invalid Fp6 usage");
    return {
      c0: Fp22.fromBigTuple(t.slice(0, 2)),
      c1: Fp22.fromBigTuple(t.slice(2, 4)),
      c2: Fp22.fromBigTuple(t.slice(4, 6))
    };
  }
  frobeniusMap({ c0, c1, c2 }, power) {
    const { Fp2: Fp22 } = this;
    return {
      c0: Fp22.frobeniusMap(c0, power),
      c1: Fp22.mul(Fp22.frobeniusMap(c1, power), this.FROBENIUS_COEFFICIENTS_1[power % 6]),
      c2: Fp22.mul(Fp22.frobeniusMap(c2, power), this.FROBENIUS_COEFFICIENTS_2[power % 6])
    };
  }
  mulByFp2({ c0, c1, c2 }, rhs) {
    const { Fp2: Fp22 } = this;
    return {
      c0: Fp22.mul(c0, rhs),
      c1: Fp22.mul(c1, rhs),
      c2: Fp22.mul(c2, rhs)
    };
  }
  mulByNonresidue({ c0, c1, c2 }) {
    const { Fp2: Fp22 } = this;
    return { c0: Fp22.mulByNonresidue(c2), c1: c0, c2: c1 };
  }
  // Sparse multiplication
  mul1({ c0, c1, c2 }, b1) {
    const { Fp2: Fp22 } = this;
    return {
      c0: Fp22.mulByNonresidue(Fp22.mul(c2, b1)),
      c1: Fp22.mul(c0, b1),
      c2: Fp22.mul(c1, b1)
    };
  }
  // Sparse multiplication
  mul01({ c0, c1, c2 }, b0, b1) {
    const { Fp2: Fp22 } = this;
    let t0 = Fp22.mul(c0, b0);
    let t1 = Fp22.mul(c1, b1);
    return {
      // ((c1 + c2) * b1 - T1) * (u + 1) + T0
      c0: Fp22.add(Fp22.mulByNonresidue(Fp22.sub(Fp22.mul(Fp22.add(c1, c2), b1), t1)), t0),
      // (b0 + b1) * (c0 + c1) - T0 - T1
      c1: Fp22.sub(Fp22.sub(Fp22.mul(Fp22.add(b0, b1), Fp22.add(c0, c1)), t0), t1),
      // (c0 + c2) * b0 - T0 + T1
      c2: Fp22.add(Fp22.sub(Fp22.mul(Fp22.add(c0, c2), b0), t0), t1)
    };
  }
};
var _Field12 = class {
  constructor(Fp62, opts) {
    this.MASK = _1n6;
    const { Fp2: Fp22 } = Fp62;
    const { Fp: Fp3 } = Fp22;
    this.Fp6 = Fp62;
    this.ORDER = Fp22.ORDER;
    this.BITS = 2 * Fp62.BITS;
    this.BYTES = 2 * Fp62.BYTES;
    this.isLE = Fp62.isLE;
    this.ZERO = { c0: Fp62.ZERO, c1: Fp62.ZERO };
    this.ONE = { c0: Fp62.ONE, c1: Fp62.ZERO };
    this.FROBENIUS_COEFFICIENTS = calcFrobeniusCoefficients(Fp22, Fp22.NONRESIDUE, Fp3.ORDER, 12, 1, 6)[0];
    this.X_LEN = opts.X_LEN;
    this.finalExponentiate = opts.Fp12finalExponentiate;
  }
  create(num) {
    return num;
  }
  isValid({ c0, c1 }) {
    const { Fp6: Fp62 } = this;
    return Fp62.isValid(c0) && Fp62.isValid(c1);
  }
  is0({ c0, c1 }) {
    const { Fp6: Fp62 } = this;
    return Fp62.is0(c0) && Fp62.is0(c1);
  }
  isValidNot0(num) {
    return !this.is0(num) && this.isValid(num);
  }
  neg({ c0, c1 }) {
    const { Fp6: Fp62 } = this;
    return { c0: Fp62.neg(c0), c1: Fp62.neg(c1) };
  }
  eql({ c0, c1 }, { c0: r0, c1: r1 }) {
    const { Fp6: Fp62 } = this;
    return Fp62.eql(c0, r0) && Fp62.eql(c1, r1);
  }
  sqrt(_) {
    notImplemented();
  }
  inv({ c0, c1 }) {
    const { Fp6: Fp62 } = this;
    let t = Fp62.inv(Fp62.sub(Fp62.sqr(c0), Fp62.mulByNonresidue(Fp62.sqr(c1))));
    return { c0: Fp62.mul(c0, t), c1: Fp62.neg(Fp62.mul(c1, t)) };
  }
  div(lhs, rhs) {
    const { Fp6: Fp62 } = this;
    const { Fp2: Fp22 } = Fp62;
    const { Fp: Fp3 } = Fp22;
    return this.mul(lhs, typeof rhs === "bigint" ? Fp3.inv(Fp3.create(rhs)) : this.inv(rhs));
  }
  pow(num, power) {
    return FpPow(this, num, power);
  }
  invertBatch(nums) {
    return FpInvertBatch(this, nums);
  }
  // Normalized
  add({ c0, c1 }, { c0: r0, c1: r1 }) {
    const { Fp6: Fp62 } = this;
    return {
      c0: Fp62.add(c0, r0),
      c1: Fp62.add(c1, r1)
    };
  }
  sub({ c0, c1 }, { c0: r0, c1: r1 }) {
    const { Fp6: Fp62 } = this;
    return {
      c0: Fp62.sub(c0, r0),
      c1: Fp62.sub(c1, r1)
    };
  }
  mul({ c0, c1 }, rhs) {
    const { Fp6: Fp62 } = this;
    if (typeof rhs === "bigint")
      return { c0: Fp62.mul(c0, rhs), c1: Fp62.mul(c1, rhs) };
    let { c0: r0, c1: r1 } = rhs;
    let t1 = Fp62.mul(c0, r0);
    let t2 = Fp62.mul(c1, r1);
    return {
      c0: Fp62.add(t1, Fp62.mulByNonresidue(t2)),
      // T1 + T2 * v
      // (c0 + c1) * (r0 + r1) - (T1 + T2)
      c1: Fp62.sub(Fp62.mul(Fp62.add(c0, c1), Fp62.add(r0, r1)), Fp62.add(t1, t2))
    };
  }
  sqr({ c0, c1 }) {
    const { Fp6: Fp62 } = this;
    let ab = Fp62.mul(c0, c1);
    return {
      // (c1 * v + c0) * (c0 + c1) - AB - AB * v
      c0: Fp62.sub(Fp62.sub(Fp62.mul(Fp62.add(Fp62.mulByNonresidue(c1), c0), Fp62.add(c0, c1)), ab), Fp62.mulByNonresidue(ab)),
      c1: Fp62.add(ab, ab)
    };
  }
  // NonNormalized stuff
  addN(a, b) {
    return this.add(a, b);
  }
  subN(a, b) {
    return this.sub(a, b);
  }
  mulN(a, b) {
    return this.mul(a, b);
  }
  sqrN(a) {
    return this.sqr(a);
  }
  // Bytes utils
  fromBytes(b) {
    const { Fp6: Fp62 } = this;
    if (b.length !== this.BYTES)
      throw new Error("fromBytes invalid length=" + b.length);
    return {
      c0: Fp62.fromBytes(b.subarray(0, Fp62.BYTES)),
      c1: Fp62.fromBytes(b.subarray(Fp62.BYTES))
    };
  }
  toBytes({ c0, c1 }) {
    const { Fp6: Fp62 } = this;
    return concatBytes(Fp62.toBytes(c0), Fp62.toBytes(c1));
  }
  cmov({ c0, c1 }, { c0: r0, c1: r1 }, c) {
    const { Fp6: Fp62 } = this;
    return {
      c0: Fp62.cmov(c0, r0, c),
      c1: Fp62.cmov(c1, r1, c)
    };
  }
  // Utils
  // toString() {
  //   return '' + 'Fp12(' + this.c0 + this.c1 + '* w');
  // },
  // fromTuple(c: [Fp6, Fp6]) {
  //   return new Fp12(...c);
  // }
  fromBigTwelve(t) {
    const { Fp6: Fp62 } = this;
    return {
      c0: Fp62.fromBigSix(t.slice(0, 6)),
      c1: Fp62.fromBigSix(t.slice(6, 12))
    };
  }
  // Raises to q**i -th power
  frobeniusMap(lhs, power) {
    const { Fp6: Fp62 } = this;
    const { Fp2: Fp22 } = Fp62;
    const { c0, c1, c2 } = Fp62.frobeniusMap(lhs.c1, power);
    const coeff = this.FROBENIUS_COEFFICIENTS[power % 12];
    return {
      c0: Fp62.frobeniusMap(lhs.c0, power),
      c1: Fp62.create({
        c0: Fp22.mul(c0, coeff),
        c1: Fp22.mul(c1, coeff),
        c2: Fp22.mul(c2, coeff)
      })
    };
  }
  mulByFp2({ c0, c1 }, rhs) {
    const { Fp6: Fp62 } = this;
    return {
      c0: Fp62.mulByFp2(c0, rhs),
      c1: Fp62.mulByFp2(c1, rhs)
    };
  }
  conjugate({ c0, c1 }) {
    return { c0, c1: this.Fp6.neg(c1) };
  }
  // Sparse multiplication
  mul014({ c0, c1 }, o0, o1, o4) {
    const { Fp6: Fp62 } = this;
    const { Fp2: Fp22 } = Fp62;
    let t0 = Fp62.mul01(c0, o0, o1);
    let t1 = Fp62.mul1(c1, o4);
    return {
      c0: Fp62.add(Fp62.mulByNonresidue(t1), t0),
      // T1 * v + T0
      // (c1 + c0) * [o0, o1+o4] - T0 - T1
      c1: Fp62.sub(Fp62.sub(Fp62.mul01(Fp62.add(c1, c0), o0, Fp22.add(o1, o4)), t0), t1)
    };
  }
  mul034({ c0, c1 }, o0, o3, o4) {
    const { Fp6: Fp62 } = this;
    const { Fp2: Fp22 } = Fp62;
    const a = Fp62.create({
      c0: Fp22.mul(c0.c0, o0),
      c1: Fp22.mul(c0.c1, o0),
      c2: Fp22.mul(c0.c2, o0)
    });
    const b = Fp62.mul01(c1, o3, o4);
    const e = Fp62.mul01(Fp62.add(c0, c1), Fp22.add(o0, o3), o4);
    return {
      c0: Fp62.add(Fp62.mulByNonresidue(b), a),
      c1: Fp62.sub(e, Fp62.add(a, b))
    };
  }
  // A cyclotomic group is a subgroup of Fp^n defined by
  //   GΦₙ(p) = {α ∈ Fpⁿ : α^Φₙ(p) = 1}
  // The result of any pairing is in a cyclotomic subgroup
  // https://eprint.iacr.org/2009/565.pdf
  // https://eprint.iacr.org/2010/354.pdf
  _cyclotomicSquare({ c0, c1 }) {
    const { Fp6: Fp62 } = this;
    const { Fp2: Fp22 } = Fp62;
    const { c0: c0c0, c1: c0c1, c2: c0c2 } = c0;
    const { c0: c1c0, c1: c1c1, c2: c1c2 } = c1;
    const { first: t3, second: t4 } = Fp22.Fp4Square(c0c0, c1c1);
    const { first: t5, second: t6 } = Fp22.Fp4Square(c1c0, c0c2);
    const { first: t7, second: t8 } = Fp22.Fp4Square(c0c1, c1c2);
    const t9 = Fp22.mulByNonresidue(t8);
    return {
      c0: Fp62.create({
        c0: Fp22.add(Fp22.mul(Fp22.sub(t3, c0c0), _2n4), t3),
        // 2 * (T3 - c0c0)  + T3
        c1: Fp22.add(Fp22.mul(Fp22.sub(t5, c0c1), _2n4), t5),
        // 2 * (T5 - c0c1)  + T5
        c2: Fp22.add(Fp22.mul(Fp22.sub(t7, c0c2), _2n4), t7)
      }),
      // 2 * (T7 - c0c2)  + T7
      c1: Fp62.create({
        c0: Fp22.add(Fp22.mul(Fp22.add(t9, c1c0), _2n4), t9),
        // 2 * (T9 + c1c0) + T9
        c1: Fp22.add(Fp22.mul(Fp22.add(t4, c1c1), _2n4), t4),
        // 2 * (T4 + c1c1) + T4
        c2: Fp22.add(Fp22.mul(Fp22.add(t6, c1c2), _2n4), t6)
      })
    };
  }
  // https://eprint.iacr.org/2009/565.pdf
  _cyclotomicExp(num, n) {
    let z = this.ONE;
    for (let i = this.X_LEN - 1; i >= 0; i--) {
      z = this._cyclotomicSquare(z);
      if (bitGet(n, i))
        z = this.mul(z, num);
    }
    return z;
  }
};
function tower12(opts) {
  const Fp3 = Field(opts.ORDER);
  const Fp22 = new _Field2(Fp3, opts);
  const Fp62 = new _Field6(Fp22);
  const Fp122 = new _Field12(Fp62, opts);
  return { Fp: Fp3, Fp2: Fp22, Fp6: Fp62, Fp12: Fp122 };
}

// node_modules/@noble/curves/esm/bls12-381.js
var _0n7 = BigInt(0);
var _1n7 = BigInt(1);
var _2n5 = BigInt(2);
var _3n5 = BigInt(3);
var _4n3 = BigInt(4);
var BLS_X = BigInt("0xd201000000010000");
var BLS_X_LEN = bitLen(BLS_X);
var bls12_381_CURVE_G1 = {
  p: BigInt("0x1a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffaaab"),
  n: BigInt("0x73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001"),
  h: BigInt("0x396c8c005555e1568c00aaab0000aaab"),
  a: _0n7,
  b: _4n3,
  Gx: BigInt("0x17f1d3a73197d7942695638c4fa9ac0fc3688c4f9774b905a14e3a3f171bac586c55e83ff97a1aeffb3af00adb22c6bb"),
  Gy: BigInt("0x08b3f481e3aaa0f1a09e30ed741d8ae4fcf5e095d5d00af600db18cb2c04b3edd03cc744a2888ae40caa232946c5e7e1")
};
var bls12_381_Fr = Field(bls12_381_CURVE_G1.n, {
  modFromBytes: true,
  isLE: true
});
var { Fp, Fp2, Fp6, Fp12 } = tower12({
  ORDER: bls12_381_CURVE_G1.p,
  X_LEN: BLS_X_LEN,
  // Finite extension field over irreducible polynominal.
  // Fp(u) / (u² - β) where β = -1
  FP2_NONRESIDUE: [_1n7, _1n7],
  Fp2mulByB: ({ c0, c1 }) => {
    const t0 = Fp.mul(c0, _4n3);
    const t1 = Fp.mul(c1, _4n3);
    return { c0: Fp.sub(t0, t1), c1: Fp.add(t0, t1) };
  },
  Fp12finalExponentiate: (num) => {
    const x = BLS_X;
    const t0 = Fp12.div(Fp12.frobeniusMap(num, 6), num);
    const t1 = Fp12.mul(Fp12.frobeniusMap(t0, 2), t0);
    const t2 = Fp12.conjugate(Fp12._cyclotomicExp(t1, x));
    const t3 = Fp12.mul(Fp12.conjugate(Fp12._cyclotomicSquare(t1)), t2);
    const t4 = Fp12.conjugate(Fp12._cyclotomicExp(t3, x));
    const t5 = Fp12.conjugate(Fp12._cyclotomicExp(t4, x));
    const t6 = Fp12.mul(Fp12.conjugate(Fp12._cyclotomicExp(t5, x)), Fp12._cyclotomicSquare(t2));
    const t7 = Fp12.conjugate(Fp12._cyclotomicExp(t6, x));
    const t2_t5_pow_q2 = Fp12.frobeniusMap(Fp12.mul(t2, t5), 2);
    const t4_t1_pow_q3 = Fp12.frobeniusMap(Fp12.mul(t4, t1), 3);
    const t6_t1c_pow_q1 = Fp12.frobeniusMap(Fp12.mul(t6, Fp12.conjugate(t1)), 1);
    const t7_t3c_t1 = Fp12.mul(Fp12.mul(t7, Fp12.conjugate(t3)), t1);
    return Fp12.mul(Fp12.mul(Fp12.mul(t2_t5_pow_q2, t4_t1_pow_q3), t6_t1c_pow_q1), t7_t3c_t1);
  }
});
var { G2psi, G2psi2 } = psiFrobenius(Fp, Fp2, Fp2.div(Fp2.ONE, Fp2.NONRESIDUE));
var htfDefaults = Object.freeze({
  DST: "BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_NUL_",
  encodeDST: "BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_NUL_",
  p: Fp.ORDER,
  m: 2,
  k: 128,
  expand: "xmd",
  hash: sha256
});
var bls12_381_CURVE_G2 = {
  p: Fp2.ORDER,
  n: bls12_381_CURVE_G1.n,
  h: BigInt("0x5d543a95414e7f1091d50792876a202cd91de4547085abaa68a205b2e5a7ddfa628f1cb4d9e82ef21537e293a6691ae1616ec6e786f0c70cf1c38e31c7238e5"),
  a: Fp2.ZERO,
  b: Fp2.fromBigTuple([_4n3, _4n3]),
  Gx: Fp2.fromBigTuple([
    BigInt("0x024aa2b2f08f0a91260805272dc51051c6e47ad4fa403b02b4510b647ae3d1770bac0326a805bbefd48056c8c121bdb8"),
    BigInt("0x13e02b6052719f607dacd3a088274f65596bd0d09920b61ab5da61bbdc7f5049334cf11213945d57e5ac7d055d042b7e")
  ]),
  Gy: Fp2.fromBigTuple([
    BigInt("0x0ce5d527727d6e118cc9cdc6da2e351aadfd9baa8cbdd3a76d429a695160d12c923ac9cc3baca289e193548608b82801"),
    BigInt("0x0606c4a02ea734cc32acd2b02bc28b99cb3e287e85a763af267492ab572e99ab3f370d275cec1da1aaa9075ff05f79be")
  ])
};
var COMPZERO = setMask(Fp.toBytes(_0n7), { infinity: true, compressed: true });
function parseMask(bytes) {
  bytes = bytes.slice();
  const mask = bytes[0] & 224;
  const compressed = !!(mask >> 7 & 1);
  const infinity = !!(mask >> 6 & 1);
  const sort = !!(mask >> 5 & 1);
  bytes[0] &= 31;
  return { compressed, infinity, sort, value: bytes };
}
function setMask(bytes, mask) {
  if (bytes[0] & 224)
    throw new Error("setMask: non-empty mask");
  if (mask.compressed)
    bytes[0] |= 128;
  if (mask.infinity)
    bytes[0] |= 64;
  if (mask.sort)
    bytes[0] |= 32;
  return bytes;
}
function pointG1ToBytes(_c, point, isComp) {
  const { BYTES: L, ORDER: P } = Fp;
  const is0 = point.is0();
  const { x, y } = point.toAffine();
  if (isComp) {
    if (is0)
      return COMPZERO.slice();
    const sort = Boolean(y * _2n5 / P);
    return setMask(numberToBytesBE(x, L), { compressed: true, sort });
  } else {
    if (is0) {
      return concatBytes(Uint8Array.of(64), new Uint8Array(2 * L - 1));
    } else {
      return concatBytes(numberToBytesBE(x, L), numberToBytesBE(y, L));
    }
  }
}
function signatureG1ToBytes(point) {
  point.assertValidity();
  const { BYTES: L, ORDER: P } = Fp;
  const { x, y } = point.toAffine();
  if (point.is0())
    return COMPZERO.slice();
  const sort = Boolean(y * _2n5 / P);
  return setMask(numberToBytesBE(x, L), { compressed: true, sort });
}
function pointG1FromBytes(bytes) {
  const { compressed, infinity, sort, value } = parseMask(bytes);
  const { BYTES: L, ORDER: P } = Fp;
  if (value.length === 48 && compressed) {
    const compressedValue = bytesToNumberBE(value);
    const x = Fp.create(compressedValue & bitMask(Fp.BITS));
    if (infinity) {
      if (x !== _0n7)
        throw new Error("invalid G1 point: non-empty, at infinity, with compression");
      return { x: _0n7, y: _0n7 };
    }
    const right = Fp.add(Fp.pow(x, _3n5), Fp.create(bls12_381_CURVE_G1.b));
    let y = Fp.sqrt(right);
    if (!y)
      throw new Error("invalid G1 point: compressed point");
    if (y * _2n5 / P !== BigInt(sort))
      y = Fp.neg(y);
    return { x: Fp.create(x), y: Fp.create(y) };
  } else if (value.length === 96 && !compressed) {
    const x = bytesToNumberBE(value.subarray(0, L));
    const y = bytesToNumberBE(value.subarray(L));
    if (infinity) {
      if (x !== _0n7 || y !== _0n7)
        throw new Error("G1: non-empty point at infinity");
      return bls12_381.G1.Point.ZERO.toAffine();
    }
    return { x: Fp.create(x), y: Fp.create(y) };
  } else {
    throw new Error("invalid G1 point: expected 48/96 bytes");
  }
}
function signatureG1FromBytes(hex) {
  const { infinity, sort, value } = parseMask(ensureBytes("signatureHex", hex, 48));
  const P = Fp.ORDER;
  const Point = bls12_381.G1.Point;
  const compressedValue = bytesToNumberBE(value);
  if (infinity)
    return Point.ZERO;
  const x = Fp.create(compressedValue & bitMask(Fp.BITS));
  const right = Fp.add(Fp.pow(x, _3n5), Fp.create(bls12_381_CURVE_G1.b));
  let y = Fp.sqrt(right);
  if (!y)
    throw new Error("invalid G1 point: compressed");
  const aflag = BigInt(sort);
  if (y * _2n5 / P !== aflag)
    y = Fp.neg(y);
  const point = Point.fromAffine({ x, y });
  point.assertValidity();
  return point;
}
function pointG2ToBytes(_c, point, isComp) {
  const { BYTES: L, ORDER: P } = Fp;
  const is0 = point.is0();
  const { x, y } = point.toAffine();
  if (isComp) {
    if (is0)
      return concatBytes(COMPZERO, numberToBytesBE(_0n7, L));
    const flag = Boolean(y.c1 === _0n7 ? y.c0 * _2n5 / P : y.c1 * _2n5 / P);
    return concatBytes(setMask(numberToBytesBE(x.c1, L), { compressed: true, sort: flag }), numberToBytesBE(x.c0, L));
  } else {
    if (is0)
      return concatBytes(Uint8Array.of(64), new Uint8Array(4 * L - 1));
    const { re: x0, im: x1 } = Fp2.reim(x);
    const { re: y0, im: y1 } = Fp2.reim(y);
    return concatBytes(numberToBytesBE(x1, L), numberToBytesBE(x0, L), numberToBytesBE(y1, L), numberToBytesBE(y0, L));
  }
}
function signatureG2ToBytes(point) {
  point.assertValidity();
  const { BYTES: L } = Fp;
  if (point.is0())
    return concatBytes(COMPZERO, numberToBytesBE(_0n7, L));
  const { x, y } = point.toAffine();
  const { re: x0, im: x1 } = Fp2.reim(x);
  const { re: y0, im: y1 } = Fp2.reim(y);
  const tmp = y1 > _0n7 ? y1 * _2n5 : y0 * _2n5;
  const sort = Boolean(tmp / Fp.ORDER & _1n7);
  const z2 = x0;
  return concatBytes(setMask(numberToBytesBE(x1, L), { sort, compressed: true }), numberToBytesBE(z2, L));
}
function pointG2FromBytes(bytes) {
  const { BYTES: L, ORDER: P } = Fp;
  const { compressed, infinity, sort, value } = parseMask(bytes);
  if (!compressed && !infinity && sort || // 00100000
  !compressed && infinity && sort || // 01100000
  sort && infinity && compressed) {
    throw new Error("invalid encoding flag: " + (bytes[0] & 224));
  }
  const slc = (b, from, to) => bytesToNumberBE(b.slice(from, to));
  if (value.length === 96 && compressed) {
    if (infinity) {
      if (value.reduce((p, c) => p !== 0 ? c + 1 : c, 0) > 0) {
        throw new Error("invalid G2 point: compressed");
      }
      return { x: Fp2.ZERO, y: Fp2.ZERO };
    }
    const x_1 = slc(value, 0, L);
    const x_0 = slc(value, L, 2 * L);
    const x = Fp2.create({ c0: Fp.create(x_0), c1: Fp.create(x_1) });
    const right = Fp2.add(Fp2.pow(x, _3n5), bls12_381_CURVE_G2.b);
    let y = Fp2.sqrt(right);
    const Y_bit = y.c1 === _0n7 ? y.c0 * _2n5 / P : y.c1 * _2n5 / P ? _1n7 : _0n7;
    y = sort && Y_bit > 0 ? y : Fp2.neg(y);
    return { x, y };
  } else if (value.length === 192 && !compressed) {
    if (infinity) {
      if (value.reduce((p, c) => p !== 0 ? c + 1 : c, 0) > 0) {
        throw new Error("invalid G2 point: uncompressed");
      }
      return { x: Fp2.ZERO, y: Fp2.ZERO };
    }
    const x1 = slc(value, 0 * L, 1 * L);
    const x0 = slc(value, 1 * L, 2 * L);
    const y1 = slc(value, 2 * L, 3 * L);
    const y0 = slc(value, 3 * L, 4 * L);
    return { x: Fp2.fromBigTuple([x0, x1]), y: Fp2.fromBigTuple([y0, y1]) };
  } else {
    throw new Error("invalid G2 point: expected 96/192 bytes");
  }
}
function signatureG2FromBytes(hex) {
  const { ORDER: P } = Fp;
  const { infinity, sort, value } = parseMask(ensureBytes("signatureHex", hex));
  const Point = bls12_381.G2.Point;
  const half = value.length / 2;
  if (half !== 48 && half !== 96)
    throw new Error("invalid compressed signature length, expected 96/192 bytes");
  const z1 = bytesToNumberBE(value.slice(0, half));
  const z2 = bytesToNumberBE(value.slice(half));
  if (infinity)
    return Point.ZERO;
  const x1 = Fp.create(z1 & bitMask(Fp.BITS));
  const x2 = Fp.create(z2);
  const x = Fp2.create({ c0: x2, c1: x1 });
  const y2 = Fp2.add(Fp2.pow(x, _3n5), bls12_381_CURVE_G2.b);
  let y = Fp2.sqrt(y2);
  if (!y)
    throw new Error("Failed to find a square root");
  const { re: y0, im: y1 } = Fp2.reim(y);
  const aflag1 = BigInt(sort);
  const isGreater = y1 > _0n7 && y1 * _2n5 / P !== aflag1;
  const is0 = y1 === _0n7 && y0 * _2n5 / P !== aflag1;
  if (isGreater || is0)
    y = Fp2.neg(y);
  const point = Point.fromAffine({ x, y });
  point.assertValidity();
  return point;
}
var bls12_381 = bls({
  // Fields
  fields: {
    Fp,
    Fp2,
    Fp6,
    Fp12,
    Fr: bls12_381_Fr
  },
  // G1: y² = x³ + 4
  G1: {
    ...bls12_381_CURVE_G1,
    Fp,
    htfDefaults: { ...htfDefaults, m: 1, DST: "BLS_SIG_BLS12381G1_XMD:SHA-256_SSWU_RO_NUL_" },
    wrapPrivateKey: true,
    allowInfinityPoint: true,
    // Checks is the point resides in prime-order subgroup.
    // point.isTorsionFree() should return true for valid points
    // It returns false for shitty points.
    // https://eprint.iacr.org/2021/1130.pdf
    isTorsionFree: (c, point) => {
      const beta = BigInt("0x5f19672fdf76ce51ba69c6076a0f77eaddb3a93be6f89688de17d813620a00022e01fffffffefffe");
      const phi = new c(Fp.mul(point.X, beta), point.Y, point.Z);
      const xP = point.multiplyUnsafe(BLS_X).negate();
      const u2P = xP.multiplyUnsafe(BLS_X);
      return u2P.equals(phi);
    },
    // Clear cofactor of G1
    // https://eprint.iacr.org/2019/403
    clearCofactor: (_c, point) => {
      return point.multiplyUnsafe(BLS_X).add(point);
    },
    mapToCurve: mapToG1,
    fromBytes: pointG1FromBytes,
    toBytes: pointG1ToBytes,
    ShortSignature: {
      fromBytes(bytes) {
        abytes(bytes);
        return signatureG1FromBytes(bytes);
      },
      fromHex(hex) {
        return signatureG1FromBytes(hex);
      },
      toBytes(point) {
        return signatureG1ToBytes(point);
      },
      toRawBytes(point) {
        return signatureG1ToBytes(point);
      },
      toHex(point) {
        return bytesToHex(signatureG1ToBytes(point));
      }
    }
  },
  G2: {
    ...bls12_381_CURVE_G2,
    Fp: Fp2,
    // https://datatracker.ietf.org/doc/html/rfc9380#name-clearing-the-cofactor
    // https://datatracker.ietf.org/doc/html/rfc9380#name-cofactor-clearing-for-bls12
    hEff: BigInt("0xbc69f08f2ee75b3584c6a0ea91b352888e2a8e9145ad7689986ff031508ffe1329c2f178731db956d82bf015d1212b02ec0ec69d7477c1ae954cbc06689f6a359894c0adebbf6b4e8020005aaa95551"),
    htfDefaults: { ...htfDefaults },
    wrapPrivateKey: true,
    allowInfinityPoint: true,
    mapToCurve: mapToG2,
    // Checks is the point resides in prime-order subgroup.
    // point.isTorsionFree() should return true for valid points
    // It returns false for shitty points.
    // https://eprint.iacr.org/2021/1130.pdf
    // Older version: https://eprint.iacr.org/2019/814.pdf
    isTorsionFree: (c, P) => {
      return P.multiplyUnsafe(BLS_X).negate().equals(G2psi(c, P));
    },
    // Maps the point into the prime-order subgroup G2.
    // clear_cofactor_bls12381_g2 from RFC 9380.
    // https://eprint.iacr.org/2017/419.pdf
    // prettier-ignore
    clearCofactor: (c, P) => {
      const x = BLS_X;
      let t1 = P.multiplyUnsafe(x).negate();
      let t2 = G2psi(c, P);
      let t3 = P.double();
      t3 = G2psi2(c, t3);
      t3 = t3.subtract(t2);
      t2 = t1.add(t2);
      t2 = t2.multiplyUnsafe(x).negate();
      t3 = t3.add(t2);
      t3 = t3.subtract(t1);
      const Q = t3.subtract(P);
      return Q;
    },
    fromBytes: pointG2FromBytes,
    toBytes: pointG2ToBytes,
    Signature: {
      fromBytes(bytes) {
        abytes(bytes);
        return signatureG2FromBytes(bytes);
      },
      fromHex(hex) {
        return signatureG2FromBytes(hex);
      },
      toBytes(point) {
        return signatureG2ToBytes(point);
      },
      toRawBytes(point) {
        return signatureG2ToBytes(point);
      },
      toHex(point) {
        return bytesToHex(signatureG2ToBytes(point));
      }
    }
  },
  params: {
    ateLoopSize: BLS_X,
    // The BLS parameter x for BLS12-381
    r: bls12_381_CURVE_G1.n,
    // order; z⁴ − z² + 1; CURVE.n from other curves
    xNegative: true,
    twistType: "multiplicative"
  },
  htfDefaults,
  hash: sha256
});
var isogenyMapG2 = isogenyMap(Fp2, [
  // xNum
  [
    [
      "0x5c759507e8e333ebb5b7a9a47d7ed8532c52d39fd3a042a88b58423c50ae15d5c2638e343d9c71c6238aaaaaaaa97d6",
      "0x5c759507e8e333ebb5b7a9a47d7ed8532c52d39fd3a042a88b58423c50ae15d5c2638e343d9c71c6238aaaaaaaa97d6"
    ],
    [
      "0x0",
      "0x11560bf17baa99bc32126fced787c88f984f87adf7ae0c7f9a208c6b4f20a4181472aaa9cb8d555526a9ffffffffc71a"
    ],
    [
      "0x11560bf17baa99bc32126fced787c88f984f87adf7ae0c7f9a208c6b4f20a4181472aaa9cb8d555526a9ffffffffc71e",
      "0x8ab05f8bdd54cde190937e76bc3e447cc27c3d6fbd7063fcd104635a790520c0a395554e5c6aaaa9354ffffffffe38d"
    ],
    [
      "0x171d6541fa38ccfaed6dea691f5fb614cb14b4e7f4e810aa22d6108f142b85757098e38d0f671c7188e2aaaaaaaa5ed1",
      "0x0"
    ]
  ],
  // xDen
  [
    [
      "0x0",
      "0x1a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffaa63"
    ],
    [
      "0xc",
      "0x1a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffaa9f"
    ],
    ["0x1", "0x0"]
    // LAST 1
  ],
  // yNum
  [
    [
      "0x1530477c7ab4113b59a4c18b076d11930f7da5d4a07f649bf54439d87d27e500fc8c25ebf8c92f6812cfc71c71c6d706",
      "0x1530477c7ab4113b59a4c18b076d11930f7da5d4a07f649bf54439d87d27e500fc8c25ebf8c92f6812cfc71c71c6d706"
    ],
    [
      "0x0",
      "0x5c759507e8e333ebb5b7a9a47d7ed8532c52d39fd3a042a88b58423c50ae15d5c2638e343d9c71c6238aaaaaaaa97be"
    ],
    [
      "0x11560bf17baa99bc32126fced787c88f984f87adf7ae0c7f9a208c6b4f20a4181472aaa9cb8d555526a9ffffffffc71c",
      "0x8ab05f8bdd54cde190937e76bc3e447cc27c3d6fbd7063fcd104635a790520c0a395554e5c6aaaa9354ffffffffe38f"
    ],
    [
      "0x124c9ad43b6cf79bfbf7043de3811ad0761b0f37a1e26286b0e977c69aa274524e79097a56dc4bd9e1b371c71c718b10",
      "0x0"
    ]
  ],
  // yDen
  [
    [
      "0x1a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffa8fb",
      "0x1a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffa8fb"
    ],
    [
      "0x0",
      "0x1a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffa9d3"
    ],
    [
      "0x12",
      "0x1a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffaa99"
    ],
    ["0x1", "0x0"]
    // LAST 1
  ]
].map((i) => i.map((pair) => Fp2.fromBigTuple(pair.map(BigInt)))));
var isogenyMapG1 = isogenyMap(Fp, [
  // xNum
  [
    "0x11a05f2b1e833340b809101dd99815856b303e88a2d7005ff2627b56cdb4e2c85610c2d5f2e62d6eaeac1662734649b7",
    "0x17294ed3e943ab2f0588bab22147a81c7c17e75b2f6a8417f565e33c70d1e86b4838f2a6f318c356e834eef1b3cb83bb",
    "0xd54005db97678ec1d1048c5d10a9a1bce032473295983e56878e501ec68e25c958c3e3d2a09729fe0179f9dac9edcb0",
    "0x1778e7166fcc6db74e0609d307e55412d7f5e4656a8dbf25f1b33289f1b330835336e25ce3107193c5b388641d9b6861",
    "0xe99726a3199f4436642b4b3e4118e5499db995a1257fb3f086eeb65982fac18985a286f301e77c451154ce9ac8895d9",
    "0x1630c3250d7313ff01d1201bf7a74ab5db3cb17dd952799b9ed3ab9097e68f90a0870d2dcae73d19cd13c1c66f652983",
    "0xd6ed6553fe44d296a3726c38ae652bfb11586264f0f8ce19008e218f9c86b2a8da25128c1052ecaddd7f225a139ed84",
    "0x17b81e7701abdbe2e8743884d1117e53356de5ab275b4db1a682c62ef0f2753339b7c8f8c8f475af9ccb5618e3f0c88e",
    "0x80d3cf1f9a78fc47b90b33563be990dc43b756ce79f5574a2c596c928c5d1de4fa295f296b74e956d71986a8497e317",
    "0x169b1f8e1bcfa7c42e0c37515d138f22dd2ecb803a0c5c99676314baf4bb1b7fa3190b2edc0327797f241067be390c9e",
    "0x10321da079ce07e272d8ec09d2565b0dfa7dccdde6787f96d50af36003b14866f69b771f8c285decca67df3f1605fb7b",
    "0x6e08c248e260e70bd1e962381edee3d31d79d7e22c837bc23c0bf1bc24c6b68c24b1b80b64d391fa9c8ba2e8ba2d229"
  ],
  // xDen
  [
    "0x8ca8d548cff19ae18b2e62f4bd3fa6f01d5ef4ba35b48ba9c9588617fc8ac62b558d681be343df8993cf9fa40d21b1c",
    "0x12561a5deb559c4348b4711298e536367041e8ca0cf0800c0126c2588c48bf5713daa8846cb026e9e5c8276ec82b3bff",
    "0xb2962fe57a3225e8137e629bff2991f6f89416f5a718cd1fca64e00b11aceacd6a3d0967c94fedcfcc239ba5cb83e19",
    "0x3425581a58ae2fec83aafef7c40eb545b08243f16b1655154cca8abc28d6fd04976d5243eecf5c4130de8938dc62cd8",
    "0x13a8e162022914a80a6f1d5f43e7a07dffdfc759a12062bb8d6b44e833b306da9bd29ba81f35781d539d395b3532a21e",
    "0xe7355f8e4e667b955390f7f0506c6e9395735e9ce9cad4d0a43bcef24b8982f7400d24bc4228f11c02df9a29f6304a5",
    "0x772caacf16936190f3e0c63e0596721570f5799af53a1894e2e073062aede9cea73b3538f0de06cec2574496ee84a3a",
    "0x14a7ac2a9d64a8b230b3f5b074cf01996e7f63c21bca68a81996e1cdf9822c580fa5b9489d11e2d311f7d99bbdcc5a5e",
    "0xa10ecf6ada54f825e920b3dafc7a3cce07f8d1d7161366b74100da67f39883503826692abba43704776ec3a79a1d641",
    "0x95fc13ab9e92ad4476d6e3eb3a56680f682b4ee96f7d03776df533978f31c1593174e4b4b7865002d6384d168ecdd0a",
    "0x000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001"
    // LAST 1
  ],
  // yNum
  [
    "0x90d97c81ba24ee0259d1f094980dcfa11ad138e48a869522b52af6c956543d3cd0c7aee9b3ba3c2be9845719707bb33",
    "0x134996a104ee5811d51036d776fb46831223e96c254f383d0f906343eb67ad34d6c56711962fa8bfe097e75a2e41c696",
    "0xcc786baa966e66f4a384c86a3b49942552e2d658a31ce2c344be4b91400da7d26d521628b00523b8dfe240c72de1f6",
    "0x1f86376e8981c217898751ad8746757d42aa7b90eeb791c09e4a3ec03251cf9de405aba9ec61deca6355c77b0e5f4cb",
    "0x8cc03fdefe0ff135caf4fe2a21529c4195536fbe3ce50b879833fd221351adc2ee7f8dc099040a841b6daecf2e8fedb",
    "0x16603fca40634b6a2211e11db8f0a6a074a7d0d4afadb7bd76505c3d3ad5544e203f6326c95a807299b23ab13633a5f0",
    "0x4ab0b9bcfac1bbcb2c977d027796b3ce75bb8ca2be184cb5231413c4d634f3747a87ac2460f415ec961f8855fe9d6f2",
    "0x987c8d5333ab86fde9926bd2ca6c674170a05bfe3bdd81ffd038da6c26c842642f64550fedfe935a15e4ca31870fb29",
    "0x9fc4018bd96684be88c9e221e4da1bb8f3abd16679dc26c1e8b6e6a1f20cabe69d65201c78607a360370e577bdba587",
    "0xe1bba7a1186bdb5223abde7ada14a23c42a0ca7915af6fe06985e7ed1e4d43b9b3f7055dd4eba6f2bafaaebca731c30",
    "0x19713e47937cd1be0dfd0b8f1d43fb93cd2fcbcb6caf493fd1183e416389e61031bf3a5cce3fbafce813711ad011c132",
    "0x18b46a908f36f6deb918c143fed2edcc523559b8aaf0c2462e6bfe7f911f643249d9cdf41b44d606ce07c8a4d0074d8e",
    "0xb182cac101b9399d155096004f53f447aa7b12a3426b08ec02710e807b4633f06c851c1919211f20d4c04f00b971ef8",
    "0x245a394ad1eca9b72fc00ae7be315dc757b3b080d4c158013e6632d3c40659cc6cf90ad1c232a6442d9d3f5db980133",
    "0x5c129645e44cf1102a159f748c4a3fc5e673d81d7e86568d9ab0f5d396a7ce46ba1049b6579afb7866b1e715475224b",
    "0x15e6be4e990f03ce4ea50b3b42df2eb5cb181d8f84965a3957add4fa95af01b2b665027efec01c7704b456be69c8b604"
  ],
  // yDen
  [
    "0x16112c4c3a9c98b252181140fad0eae9601a6de578980be6eec3232b5be72e7a07f3688ef60c206d01479253b03663c1",
    "0x1962d75c2381201e1a0cbd6c43c348b885c84ff731c4d59ca4a10356f453e01f78a4260763529e3532f6102c2e49a03d",
    "0x58df3306640da276faaae7d6e8eb15778c4855551ae7f310c35a5dd279cd2eca6757cd636f96f891e2538b53dbf67f2",
    "0x16b7d288798e5395f20d23bf89edb4d1d115c5dbddbcd30e123da489e726af41727364f2c28297ada8d26d98445f5416",
    "0xbe0e079545f43e4b00cc912f8228ddcc6d19c9f0f69bbb0542eda0fc9dec916a20b15dc0fd2ededda39142311a5001d",
    "0x8d9e5297186db2d9fb266eaac783182b70152c65550d881c5ecd87b6f0f5a6449f38db9dfa9cce202c6477faaf9b7ac",
    "0x166007c08a99db2fc3ba8734ace9824b5eecfdfa8d0cf8ef5dd365bc400a0051d5fa9c01a58b1fb93d1a1399126a775c",
    "0x16a3ef08be3ea7ea03bcddfabba6ff6ee5a4375efa1f4fd7feb34fd206357132b920f5b00801dee460ee415a15812ed9",
    "0x1866c8ed336c61231a1be54fd1d74cc4f9fb0ce4c6af5920abc5750c4bf39b4852cfe2f7bb9248836b233d9d55535d4a",
    "0x167a55cda70a6e1cea820597d94a84903216f763e13d87bb5308592e7ea7d4fbc7385ea3d529b35e346ef48bb8913f55",
    "0x4d2f259eea405bd48f010a01ad2911d9c6dd039bb61a6290e591b36e636a5c871a5c29f4f83060400f8b49cba8f6aa8",
    "0xaccbb67481d033ff5852c1e48c50c477f94ff8aefce42d28c0f9a88cea7913516f968986f7ebbea9684b529e2561092",
    "0xad6b9514c767fe3c3613144b45f1496543346d98adf02267d5ceef9a00d9b8693000763e3b90ac11e99b138573345cc",
    "0x2660400eb2e4f3b628bdd0d53cd76f2bf565b94e72927c1cb748df27942480e420517bd8714cc80d1fadc1326ed06f7",
    "0xe0fa1d816ddc03e6b24255e0d7819c171c40f65e273b853324efcd6356caa205ca2f570f13497804415473a1d634b8f",
    "0x000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001"
    // LAST 1
  ]
].map((i) => i.map((j) => BigInt(j))));
var G1_SWU = mapToCurveSimpleSWU(Fp, {
  A: Fp.create(BigInt("0x144698a3b8e9433d693a02c96d4982b0ea985383ee66a8d8e8981aefd881ac98936f8da0e0f97f5cf428082d584c1d")),
  B: Fp.create(BigInt("0x12e2908d11688030018b12e8753eee3b2016c1f0f24f4070a0b9c14fcef35ef55a23215a316ceaa5d1cc48e98e172be0")),
  Z: Fp.create(BigInt(11))
});
var G2_SWU = mapToCurveSimpleSWU(Fp2, {
  A: Fp2.create({ c0: Fp.create(_0n7), c1: Fp.create(BigInt(240)) }),
  // A' = 240 * I
  B: Fp2.create({ c0: Fp.create(BigInt(1012)), c1: Fp.create(BigInt(1012)) }),
  // B' = 1012 * (1 + I)
  Z: Fp2.create({ c0: Fp.create(BigInt(-2)), c1: Fp.create(BigInt(-1)) })
  // Z: -(2 + I)
});
function mapToG1(scalars) {
  const { x, y } = G1_SWU(Fp.create(scalars[0]));
  return isogenyMapG1(x, y);
}
function mapToG2(scalars) {
  const { x, y } = G2_SWU(Fp2.fromBigTuple(scalars));
  return isogenyMapG2(x, y);
}

// clear/serials.ts
import { createHash as createHash3 } from "node:crypto";
function assignSerials(winners, serials, beaconSignatureHex) {
  requireThat(Number.isSafeInteger(serials.first) && serials.first >= 0 && Number.isSafeInteger(serials.count) && serials.count > 0 && serials.count <= 4294967295 && Number.isSafeInteger(serials.first + serials.count - 1), "serial range");
  requireThat(/^[0-9a-f]{96}$/.test(beaconSignatureHex), "serial beacon signature");
  requireThat(winners.every((w) => Number.isSafeInteger(w.leaf_index) && w.leaf_index >= 0 && Number.isSafeInteger(w.units) && w.units > 0) && new Set(winners.map((w) => w.leaf_index)).size === winners.length, "serial winners");
  requireThat(winners.reduce((n, w) => n + BigInt(w.units), 0n) <= BigInt(serials.count), "serial units exceed count");
  const pool = Array.from({ length: serials.count }, (_, i) => serials.first + i);
  const signature = Buffer.from(beaconSignatureHex, "hex");
  for (let i = pool.length - 1; i > 0; i--) {
    const index = Buffer.alloc(4);
    index.writeUInt32BE(i);
    const digest = createHash3("sha256").update("benzo-serials-v1").update(signature).update(index).digest();
    const j = Number(digest.readBigUInt64BE(0) % BigInt(i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  let offset = 0;
  return [...winners].sort((a, b) => a.leaf_index - b.leaf_index).map((w) => {
    const assigned = pool.slice(offset, offset + w.units);
    offset += w.units;
    return { leaf_index: w.leaf_index, serials: assigned };
  });
}
function attachSerials(result, m, beacon) {
  if (!m.serials) {
    requireThat(!beacon, "serial beacon without manifest serials");
    return result;
  }
  const round = m.drand.R + m.serials.seed_round_offset;
  requireThat(beacon && beacon.round === round, "serial beacon round");
  const roundBytes = Buffer.alloc(8);
  roundBytes.writeBigUInt64BE(BigInt(round));
  requireThat(/^[0-9a-f]{96}$/.test(beacon.signature) && bls12_381.verifyShortSignature(
    beacon.signature,
    createHash3("sha256").update(roundBytes).digest(),
    QUICKNET.public_key,
    { DST: "BLS_SIG_BLS12381G1_XMD:SHA-256_SSWU_RO_NUL_" }
  ), "serial beacon BLS signature");
  return { ...result, serial_beacon_round: round, serial_assignment: assignSerials(
    result.allocations.filter((a) => a.fill > 0).map((a) => ({ leaf_index: a.leaf_index, units: a.fill })),
    m.serials,
    beacon.signature
  ) };
}

// clear/registry.ts
var registry = {
  uniform: { layout: LAYOUT_V0, client, clear: (input) => attachSerials(clear(input), client(input.manifest, input.signer).manifest, input.serial_beacon), checkResult: (m, r) => checkResultModeA(m, r), obligations: obligationsModeA },
  vickrey: { layout: LAYOUT_V0, client, clear, checkResult: (m, r) => checkResultModeA(m, r), obligations: obligationsModeA },
  otc: { layout: OTC_LAYOUT, client: clientOTC, clear: clearOTC, checkResult: (m, r) => checkResultOTC(m, r), obligations: obligationsOTC },
  rfq: { layout: RFQ_LAYOUT, client: clientRFQ, clear: clearRFQ, checkResult: (m, r) => checkResultRFQ(m, r), obligations: obligationsRFQ },
  launch: { layout: LAUNCH_LAYOUT, client: clientLaunch, clear: clearLaunch, checkResult: (m, r) => checkResultLaunch(m, r), obligations: obligationsModeA },
  buyback: {
    layout: LAYOUT_V0,
    client: clientBuyback,
    clear: clearModeB,
    checkResult: (m, r) => checkResultBuyback(m, r),
    obligations: obligationsModeB
  }
};
function modeEntry(packet) {
  const m = JSON.parse(Buffer.from(packet.bytes, "base64").toString("utf8"));
  const mode = m?.clearing?.mode;
  requireThat(typeof mode === "string" && registry[mode] !== void 0, `unknown clearing mode ${String(mode)}`);
  return registry[mode];
}
var clientForMode = (packet, signer) => modeEntry(packet).client(packet, signer);
var clearForMode = (input) => modeEntry(input.manifest).clear(input);

// api/missing-deposits.ts
function omissions(frozen, auctionId, submitTime, C, list) {
  requireThat(list && Object.keys(list).sort().join(",") === "auction_id,block_times,deposits,version" && list.version === 1 && list.auction_id === auctionId && Array.isArray(list.deposits), "mined deposit list fields/binding");
  requireThat(Array.isArray(list.block_times), "mined block times");
  const times = /* @__PURE__ */ new Map();
  for (const b of list.block_times) {
    requireThat(b && Object.keys(b).sort().join(",") === "height,time" && Number.isSafeInteger(b.height) && b.height > 0 && b.height <= 4294967295 && Number.isSafeInteger(b.time) && b.time > 0 && !times.has(b.height), "mined block time fields/duplicate height");
    times.set(b.height, b.time);
  }
  const notes = /* @__PURE__ */ new Set(), frozenMatches = /* @__PURE__ */ new Set();
  const absent = [];
  for (const d of list.deposits) {
    requireThat(d && Object.keys(d).sort().join(",") === "ciphertext_hash,height,note_id" && Number.isSafeInteger(d.height) && d.height > 0 && d.height <= 4294967295 && /^[0-9a-f]{64}$/.test(d.ciphertext_hash) && /^[0-9a-f]{64}:ironwood:(0|[1-9][0-9]*)$/.test(d.note_id) && Number(d.note_id.split(":")[2]) <= 65535, "mined deposit fields");
    requireThat(!notes.has(d.note_id), "duplicate mined note id");
    notes.add(d.note_id);
    requireThat(times.has(d.height), "missing mined block timestamp");
    const txid = d.note_id.split(":")[0];
    const leaf = frozen.leaves.find((l) => l.ciphertext_hash === d.ciphertext_hash && l.deposit.txid === txid && l.deposit.pool === "ironwood");
    if (leaf) {
      requireThat(!frozenMatches.has(leaf.leaf_index), "ambiguous frozen note identity");
      frozenMatches.add(leaf.leaf_index);
    } else if (times.get(d.height) < submitTime) absent.push(d);
  }
  requireThat(list.block_times.every((b) => list.deposits.some((d) => d.height === b.height)), "unused mined block timestamp");
  return absent.sort((a, b) => a.note_id.localeCompare(b.note_id)).map((d) => ({ auction_id: auctionId, ...d, status: "refund_owed", refund_zats: C }));
}
function missingDepositExceptions(pub) {
  const file = path2.join(pub.dir, "mined-deposits.json");
  if (!existsSync2(file)) return [];
  requireThat(pub.frozen, "mined deposits require frozen root");
  checkFrozen(pub.frozen, pub.manifest.auction_id, pub.manifest_hash);
  return omissions(pub.frozen, pub.manifest.auction_id, pub.manifest.T_submit, pub.manifest.C_zats, JSON.parse(readFileSync2(file, "utf8")));
}
function checkMissingDeposits(pub) {
  const expected = missingDepositExceptions(pub), file = path2.join(pub.dir, "refund-exceptions.json");
  if (expected.length || existsSync2(file)) {
    requireThat(existsSync2(file), `missing refund exception queue: ${expected.map((d) => d.note_id + " exact-C " + d.refund_zats).join(", ")}`);
    const queue = JSON.parse(readFileSync2(file, "utf8"));
    requireThat(jsonBytes(queue).equals(jsonBytes(expected)), "missing-bid refund exception queue differs (exact-C required)");
  }
  if (expected.length) return `${expected.length} not included; refund owed (exact C); chain observations supplied by publisher`;
}

// adapters/buyback-report.ts
import { existsSync as existsSync3, readFileSync as readFileSync3 } from "node:fs";
import path3 from "node:path";
function buybackReport(pub) {
  const m = pub.manifest, r = pub.result;
  requireThat(r.mode === "buyback" && m.series, "report requires a recurring buyback");
  const fresh = clearForMode({
    manifest: pub.manifestPacket,
    signer: pub.signer,
    frozen: pub.frozen,
    opened: pub.opened,
    reserve_opening: pub.reserveOpening
  });
  requireThat(jsonBytes(fresh).equals(jsonBytes(r)), "report canonical result differs");
  const file = path3.join(pub.dir, "serial-intake.json");
  requireThat(existsSync3(file), "missing serial-intake.json");
  const intake = JSON.parse(readFileSync3(file, "utf8"));
  requireThat(Array.isArray(intake), "serial intake array");
  const seen = /* @__PURE__ */ new Set(), leaves = /* @__PURE__ */ new Set();
  const serials = intake.map((record) => {
    requireThat(record && Object.keys(record).sort().join(",") === "auction_id,ciphertext_hash,serials,signature", "serial intake fields");
    const { signature, ...body } = record;
    const leaf = pub.frozen.leaves.find((l) => l.ciphertext_hash === body.ciphertext_hash);
    const a = r.allocations.find((a2) => a2.leaf_index === leaf?.leaf_index);
    requireThat(body.auction_id === m.auction_id && leaf && a && a.fill > 0 && !leaves.has(a.leaf_index), "serial intake winner binding");
    leaves.add(a.leaf_index);
    const pt = pub.opened.find((o) => o.leaf_index === a.leaf_index)?.plaintext_hex;
    requireThat(pt && /^[0-9a-f]{256}$/.test(pt), "serial intake opening");
    requireThat(verifyStatement(Buffer.from(pt, "hex").subarray(61, 93).toString("hex"), body, signature), "serial intake owner signature");
    requireThat(Array.isArray(body.serials) && body.serials.length === a.fill, "serial intake fill count");
    checkSerialRange(pub, body.serials);
    for (const s of body.serials) {
      requireThat(Number.isSafeInteger(s) && s >= 0 && !seen.has(s), "serial intake duplicate/range");
      seen.add(s);
    }
    return { leaf_index: a.leaf_index, serials: body.serials };
  }).sort((a, b) => a.leaf_index - b.leaf_index);
  requireThat(r.allocations.filter((a) => a.fill > 0).length === leaves.size, "serial intake missing winner");
  const spent = BigInt(r.conservation.payout_zats) + BigInt(r.conservation.fees_zats);
  return {
    version: 1,
    auction_id: m.auction_id,
    series_id: m.series.series_id,
    window_index: m.series.round_index,
    result_hash: hash(pub.resultBytes),
    units_bought: seen.size,
    clearing_price_zats: r.clearing_price_zats,
    ...r.lots ? { lots: r.lots } : {},
    spent_zats: spent.toString(),
    spent_zec: `${spent / 100000000n}.${(spent % 100000000n).toString().padStart(8, "0")}`,
    serials_taken_in: serials
  };
}
function checkBuybackReport(pub) {
  const file = path3.join(pub.dir, "report.json");
  if (pub.result.mode !== "buyback" || !pub.manifest.series) {
    requireThat(!existsSync3(file) && !existsSync3(path3.join(pub.dir, "serial-intake.json")), "report without recurring buyback");
    return;
  }
  requireThat(existsSync3(file), "missing report.json");
  requireThat(jsonBytes(JSON.parse(readFileSync3(file, "utf8"))).equals(jsonBytes(buybackReport(pub))), "buyback report differs from result/intake");
}

// api/public-auction.ts
import { existsSync as existsSync4, readFileSync as readFileSync4 } from "node:fs";
import path4 from "node:path";

// witness/index.ts
import { createPrivateKey as createPrivateKey3, createPublicKey as createPublicKey3, generateKeyPairSync as generateKeyPairSync2, sign as sign3, verify as verify3 } from "node:crypto";
var witnessSetHash = (packet) => hash(jsonBytes(packet));
var edPublic = (h) => createPublicKey3({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(h, "hex")]), type: "spki", format: "der" });
function validateWitnessSet(set, auctionId) {
  requireThat(set && typeof set === "object" && !Array.isArray(set), "witness set");
  requireThat(Object.keys(set).sort().join(",") === "auction_id,keys,q_w,version", "witness set field set");
  requireThat(set.version === 1 && set.auction_id === auctionId, "witness set binding");
  requireThat(Array.isArray(set.keys) && set.keys.length >= 2 && set.keys.length <= 16, "witness key count");
  for (const k of set.keys) requireThat(typeof k === "string" && /^[0-9a-f]{64}$/.test(k), "witness key");
  requireThat(new Set(set.keys).size === set.keys.length, "duplicate witness key");
  requireThat(Number.isInteger(set.q_w) && set.q_w >= 1 && set.q_w <= set.keys.length, "witness quorum");
  return { q_w: set.q_w, keys: set.keys };
}
function statementBytes(st) {
  requireThat(st && st.version === 1 && /^[0-9a-f]{64}$/.test(String(st.auction_id)) && /^[0-9a-f]{64}$/.test(String(st.frozen_root)) && Number.isSafeInteger(st.leaf_count) && st.leaf_count >= 0 && Number.isSafeInteger(st.T_freeze) && /^[0-9a-f]{64}$/.test(String(st.chain_anchor)), "witness statement");
  return jsonBytes(st);
}
function freezeStatement(m, frozen) {
  return { version: 1, auction_id: m.auction_id, frozen_root: frozen.root, leaf_count: frozen.leaf_count, T_freeze: m.T_freeze, chain_anchor: m.drand.chain_hash };
}
function checkCertificates(certs, spec, statement) {
  requireThat(Array.isArray(certs) && certs.length > 0, "missing certificate");
  for (const c of certs) {
    requireThat(c && typeof c === "object" && c.statement && Array.isArray(c.signatures), "certificate shape");
    requireThat(c.signatures.length > 0, "certificate without signatures");
    for (const s of c.signatures) requireThat(s && /^[0-9a-f]{64}$/.test(String(s.witness)) && /^[0-9a-f]{128}$/.test(String(s.signature)), "certificate signature shape");
    statementBytes(c.statement);
  }
  const roots = new Set(certs.map((c) => c.statement.frozen_root));
  requireThat(roots.size === 1, "two certificates for different roots");
  const wanted = statementBytes(statement).toString("hex");
  for (const c of certs) requireThat(statementBytes(c.statement).toString("hex") === wanted, "certificate statement differs");
  const signed = /* @__PURE__ */ new Set();
  for (const c of certs) for (const s of c.signatures) {
    if (signed.has(s.witness)) continue;
    requireThat(spec.keys.includes(s.witness), "signature not from the witness set");
    requireThat(verify3(null, Buffer.concat([Buffer.from("benzo-witness-v1"), statementBytes(c.statement)]), edPublic(s.witness), Buffer.from(s.signature, "hex")), `witness ${s.witness} signature`);
    signed.add(s.witness);
  }
  requireThat(signed.size >= spec.q_w, `witness quorum ${signed.size}-of-${spec.keys.length}`);
}

// api/public-auction.ts
function readClient(packet, signer) {
  return clientForMode(packet, signer);
}
var canonicalKeys = /* @__PURE__ */ new Set(["version", "auction_id", "signer", "manifest", "state", "receipts", "frozen", "result", "settlement", "opened", "beacon", "envelopes", "witness_set", "witness_cert", "reserve_opening", "serial_beacon", "launch_input", "claims"]);
var states = /* @__PURE__ */ new Set(["DRAFT", "OPEN", "SEALED-WAIT", "OPENED", "CLEARED", "SETTLING", "SETTLED", "CANCELLED", "REFUNDING"]);
var openedStates = /* @__PURE__ */ new Set(["OPENED", "CLEARED", "SETTLED"]);
var frozenStates = /* @__PURE__ */ new Set(["SEALED-WAIT", "OPENED", "CLEARED", "SETTLING", "SETTLED"]);
var resultStates = /* @__PURE__ */ new Set(["CLEARED", "SETTLING", "SETTLED"]);
function loadPublicAuction(dir, opts = {}) {
  const root = path4.resolve(dir);
  const file = (name) => {
    const p = path4.join(root, name);
    requireThat(existsSync4(p), `missing ${name}`);
    return readFileSync4(p);
  };
  const text = (name) => file(name).toString("utf8");
  const anchor = (claimed) => {
    requireThat(/^[0-9a-f]{88}$/.test(claimed), "signer");
    if (opts.signer) requireThat(claimed === opts.signer, "signer mismatch");
    return opts.signer ?? claimed;
  };
  const legacy = !existsSync4(path4.join(root, "auction.json"));
  let signer, manifestPacket, manifest, manifest_hash, state;
  let frozen, opened, beacon;
  let launchInput;
  let serialBeacon = null;
  let resultBytes, result, receipts, envelopes, witnessSet, witnessCerts, settlement, reserveOpening, claims = [];
  if (!legacy) {
    const doc = JSON.parse(text("auction.json"));
    requireThat(doc && typeof doc === "object" && !Array.isArray(doc), "auction.json");
    requireThat(Object.keys(doc).every((k) => canonicalKeys.has(k)) && doc.version === 1, "auction.json schema");
    requireThat(/^[0-9a-f]{64}$/.test(String(doc.auction_id)), "auction id");
    requireThat(typeof doc.state === "string" && states.has(doc.state), "state");
    state = doc.state;
    signer = anchor(String(doc.signer));
    manifestPacket = doc.manifest;
    ({ manifest, manifest_hash } = readClient(manifestPacket, signer));
    requireThat(doc.auction_id === manifest.auction_id, "auction id binding");
    requireThat(Array.isArray(doc.receipts), "receipts");
    requireThat(doc.frozen === void 0 || doc.frozen && typeof doc.frozen === "object", "frozen");
    requireThat(doc.result === void 0 || doc.result && typeof doc.result === "object", "result");
    frozen = doc.frozen ?? null;
    result = doc.result ?? null;
    requireThat(!frozenStates.has(doc.state) || frozen, `state ${doc.state} requires frozen`);
    requireThat(!resultStates.has(doc.state) || result, `state ${doc.state} requires result`);
    if (openedStates.has(doc.state)) requireThat(Array.isArray(doc.opened) && doc.beacon, "opened/beacon required from OPENED");
    opened = Array.isArray(doc.opened) ? doc.opened : [];
    beacon = readBeacon(doc.beacon ?? null, manifest);
    launchInput = doc.launch_input;
    serialBeacon = doc.serial_beacon ?? null;
    if (serialBeacon) {
      requireThat(Object.keys(serialBeacon).sort().join(",") === "round,signature" && /^[0-9a-f]{96}$/.test(serialBeacon.signature), "serial beacon");
      requireThat(manifest.serials && serialBeacon.round === manifest.drand.R + manifest.serials.seed_round_offset, "serial beacon round");
    }
    resultBytes = result ? jsonBytes(doc.result) : null;
    receipts = doc.receipts;
    requireThat(doc.envelopes === void 0 || Array.isArray(doc.envelopes), "envelopes");
    envelopes = doc.envelopes ?? [];
    requireThat(doc.witness_set === void 0 || doc.witness_set && typeof doc.witness_set === "object", "witness_set");
    witnessSet = doc.witness_set ?? null;
    requireThat(doc.witness_cert === void 0 || Array.isArray(doc.witness_cert), "witness_cert");
    witnessCerts = doc.witness_cert ?? [];
    requireThat(doc.claims === void 0 || Array.isArray(doc.claims), "claims");
    claims = doc.claims ?? [];
    settlement = doc.settlement ?? null;
    requireThat(doc.reserve_opening === void 0 || doc.reserve_opening && typeof doc.reserve_opening === "object" && Object.keys(doc.reserve_opening).sort().join(",") === "plaintext_hex" && typeof doc.reserve_opening.plaintext_hex === "string", "reserve_opening");
    reserveOpening = doc.reserve_opening ? doc.reserve_opening.plaintext_hex : null;
  } else {
    signer = anchor(String(JSON.parse(text("signer.json")).signer));
    manifestPacket = JSON.parse(text("manifest.json"));
    ({ manifest, manifest_hash } = readClient(manifestPacket, signer));
    frozen = JSON.parse(text("frozen.json"));
    opened = existsSync4(path4.join(root, "opened.json")) ? JSON.parse(text("opened.json")) : [];
    beacon = readBeacon(
      existsSync4(path4.join(root, "beacon.json")) ? JSON.parse(text("beacon.json")) : null,
      manifest
    );
    resultBytes = file("result.json");
    result = JSON.parse(resultBytes.toString("utf8"));
    receipts = existsSync4(path4.join(root, "receipts.json")) ? JSON.parse(text("receipts.json")) : [];
    envelopes = existsSync4(path4.join(root, "envelope.json")) ? JSON.parse(text("envelope.json")) : [];
    witnessSet = existsSync4(path4.join(root, "witness-set.json")) ? JSON.parse(text("witness-set.json")) : null;
    witnessCerts = existsSync4(path4.join(root, "witness.json")) ? JSON.parse(text("witness.json")) : [];
    settlement = existsSync4(path4.join(root, "summary.json")) ? JSON.parse(text("summary.json")) : null;
    state = settlement ? "SETTLED" : result ? "CLEARED" : frozen ? "SEALED-WAIT" : "OPEN";
    reserveOpening = existsSync4(path4.join(root, "reserve.json")) ? String(JSON.parse(text("reserve.json")).plaintext_hex ?? "") : null;
  }
  return { dir: root, signer, legacy, state, manifestPacket, manifest, manifest_hash, frozen, opened, beacon, serialBeacon, launchInput, result, resultBytes, receipts, envelopes, witnessSet, witnessCerts, claims, settlement, reserveOpening };
}
function loadCompletePublicAuction(dir, opts = {}) {
  const pub = loadPublicAuction(dir, opts);
  requireThat(pub.frozen, "missing frozen");
  requireThat(pub.result, "missing result");
  return pub;
}
function readBeacon(raw2, manifest) {
  if (raw2 === null || raw2 === void 0) return null;
  const b = raw2;
  requireThat(
    b && typeof b.round === "number" && /^[0-9a-f]{96}$/.test(String(b.signature)) && /^[0-9a-f]{64}$/.test(String(b.chain_hash)),
    "beacon"
  );
  requireThat(b.round === manifest.drand.R && b.chain_hash === manifest.drand.chain_hash, "beacon binding");
  return b;
}
var settlementKeys = ["auction_id", "party", "txid", "pool", "output_index", "amount_zats"].sort().join(",");
function checkPublicAuction(pub) {
  const checks = [];
  const run2 = (id, fn) => {
    try {
      const warn = fn();
      checks.push(warn ? { id, warn } : { id });
    } catch (e) {
      checks.push({ id, error: e.message });
    }
  };
  const projection = (name, value) => {
    if (pub.legacy) return;
    const p = path4.join(pub.dir, name);
    if (value === null || value === void 0) {
      requireThat(!existsSync4(p), `${name} projection without document field`);
      return;
    }
    if (existsSync4(p)) requireThat(jsonBytes(value).equals(readFileSync4(p)), `${name} projection differs`);
  };
  run2("missing-deposits", () => checkMissingDeposits(pub));
  run2("delivery", () => checkDeliveryExceptions(pub));
  run2("report", () => {
    if (pub.frozen && pub.result) checkBuybackReport(pub);
  });
  run2("manifest", () => {
    const again = readClient(pub.manifestPacket, pub.signer);
    requireThat(again.manifest_hash === pub.manifest_hash, "manifest hash changed");
    if (pub.result) requireThat(pub.result.auction_id === pub.manifest.auction_id && pub.result.manifest_hash === pub.manifest_hash, "result manifest binding");
    projection("manifest.json", pub.manifestPacket);
  });
  run2("freeze", () => {
    const frozen = pub.frozen;
    if (!frozen) return projection("frozen.json", null);
    checkFrozen(frozen, pub.manifest.auction_id, pub.manifest_hash);
    requireThat(frozen.published_at < pub.manifest.T_freeze, "freeze published too late");
    requireThat(frozen.published_at < releaseTime(pub.manifest), "freeze published after release");
    for (const [i, l] of frozen.leaves.entries()) {
      requireThat(l.leaf_index === i, `leaf order ${i}`);
      requireThat(
        member(l.ciphertext_hash, l.deposit, i, frozen.leaf_count, frozen.paths[i] ?? [], frozen.root),
        `witness ${i}`
      );
    }
    if (pub.result) requireThat(frozen.root === pub.result.freeze_root, "result freeze root");
    projection("frozen.json", frozen);
  });
  run2("witness", () => {
    const frozen = pub.frozen;
    if (!frozen) {
      requireThat(pub.witnessCerts.length === 0 && pub.witnessSet === null, "witness material without frozen root");
      return projection("witness.json", null);
    }
    const bound = pub.manifest.witness_set_hash;
    if (!bound) return "no witness set (pre-Phase-5 manifest)";
    requireThat(pub.witnessSet, "missing witness set");
    const set = verifyRecord(pub.witnessSet, pub.signer);
    requireThat(witnessSetHash(pub.witnessSet) === bound, "witness set hash mismatch");
    checkCertificates(pub.witnessCerts, validateWitnessSet(set, pub.manifest.auction_id), freezeStatement(pub.manifest, frozen));
    projection("witness-set.json", pub.witnessSet);
    projection("witness.json", pub.witnessCerts);
  });
  run2("receipts", () => {
    if (!pub.frozen) return;
    for (const [i, packet] of pub.receipts.entries()) {
      requireThat(receiptMember(packet, pub.frozen, pub.signer), `receipt ${i} not a member`);
    }
  });
  run2("clear", () => {
    const result = pub.result, resultBytes = pub.resultBytes;
    if (!result || !resultBytes) return projection("result.json", null);
    requireThat(pub.frozen, "missing frozen");
    const fresh = clearForMode({ manifest: pub.manifestPacket, signer: pub.signer, frozen: pub.frozen, opened: pub.opened, reserve_opening: pub.reserveOpening, serial_beacon: pub.serialBeacon, launch: pub.launchInput });
    requireThat(jsonBytes(fresh).equals(resultBytes), "canonical result differs");
    if (fresh.allocation_file_hash) {
      const file = path4.join(pub.dir, "allocation.json");
      requireThat(existsSync4(file) && hash(readFileSync4(file)) === fresh.allocation_file_hash, "launch allocation file hash");
    }
    projection("result.json", result);
  });
  run2("envelope", () => {
    const records = pub.envelopes;
    if (!records.length) return projection("envelope.json", null);
    const frozen = pub.frozen;
    requireThat(frozen, "missing frozen");
    const rows = pub.settlement?.rows ?? [], receipts = pub.settlement?.receipts ?? [];
    const settleable = (leaf, reason) => {
      const party = `leaf:${leaf}`;
      if (!pub.settlement) return `${reason} ${leaf}; refund goes to the exception queue`;
      const row = rows.find((r) => r.party === party);
      requireThat(row, `${reason} ${leaf}: missing row`);
      const paid = receipts.some((r) => r.party === party);
      if (row.state === "exception") requireThat(!paid, `${reason} ${leaf}: exception row with receipt`);
      else requireThat(paid, `${reason} ${leaf}: neither an unpaid exception row nor a receipt-backed payment`);
      return paid ? `${reason} ${leaf}; paid through an owner-signed claim` : `${reason} ${leaf}; in the exception queue`;
    };
    const byLeaf = /* @__PURE__ */ new Map();
    for (const rec of records) {
      requireThat(rec && typeof rec === "object" && Object.keys(rec).sort().join(",") === "ciphertext_hash,envelope_ct,owner_sig", "envelope record shape");
      const leaf = frozen.leaves.find((l) => l.ciphertext_hash === rec.ciphertext_hash);
      requireThat(leaf, "envelope for unknown ciphertext");
      requireThat(!byLeaf.has(leaf.leaf_index), `duplicate envelope ${leaf.leaf_index}`);
      byLeaf.set(leaf.leaf_index, rec);
    }
    const warnings = [];
    for (const l of frozen.leaves) if (!byLeaf.has(l.leaf_index)) warnings.push(settleable(l.leaf_index, "missing envelope"));
    if (pub.opened.length) for (const l of frozen.leaves) {
      const rec = byLeaf.get(l.leaf_index);
      if (!rec) continue;
      const opening = pub.opened.find((o) => o.leaf_index === l.leaf_index);
      let valid = !!opening && /^[0-9a-f]{256}$/.test(opening.plaintext_hex ?? "");
      if (valid) {
        const pt = Buffer.from(opening.plaintext_hex, "hex");
        try {
          valid = verifyEnvelope(pt.subarray(61, 93).toString("hex"), pub.manifest.auction_id, rec.ciphertext_hash, rec.envelope_ct, rec.owner_sig) && pt.subarray(93, 125).toString("hex") === settlementCommitment(pt.subarray(45, 61).toString("hex"), rec.envelope_ct);
        } catch {
          valid = false;
        }
      }
      if (!valid) warnings.push(settleable(l.leaf_index, "invalid envelope"));
    }
    projection("envelope.json", records);
    return warnings.filter(Boolean).join("; ") || void 0;
  });
  run2("claims", () => {
    const records = pub.claims ?? [];
    const rows = pub.settlement?.rows ?? [], receipts = pub.settlement?.receipts ?? [];
    for (const [i, c] of records.entries()) {
      requireThat(c && typeof c === "object" && ["party", "destination_sha256", "owner_sig"].every((k) => typeof c[k] === "string") && Object.keys(c).every((k) => ["party", "destination_sha256", "owner_sig", "memo_hex", "opening"].includes(k)), `claim ${i} shape`);
      requireThat(/^leaf:[0-9]+$/.test(c.party) || /^deposit:[0-9a-f]{64}:.+$/.test(c.party), `claim ${i} party`);
      requireThat(/^[0-9a-f]{64}$/.test(c.destination_sha256) && /^[0-9a-f]{128}$/.test(c.owner_sig), `claim ${i} fields`);
      let owner = null;
      if (c.party.startsWith("leaf:")) {
        const opening = pub.opened.find((o) => o.leaf_index === Number(c.party.slice(5)));
        owner = opening && /^[0-9a-f]{256}$/.test(opening.plaintext_hex ?? "") ? Buffer.from(opening.plaintext_hex, "hex").subarray(61, 93).toString("hex") : null;
      } else owner = typeof c.opening === "string" && /^[0-9a-f]{256}$/.test(c.opening) ? Buffer.from(c.opening, "hex").subarray(61, 93).toString("hex") : null;
      requireThat(owner && verifyStatement(owner, { kind: "claim-refund", auction_id: pub.manifest.auction_id, party: c.party, destination_sha256: c.destination_sha256 }, c.owner_sig), `claim ${i} owner signature`);
    }
    for (const row of rows) {
      if (!receipts.some((r) => r.party === row.party)) continue;
      const stray = row.party.startsWith("deposit:");
      const rec = stray ? void 0 : (pub.envelopes ?? []).find((e) => {
        const leaf = pub.frozen?.leaves.find((l) => l.leaf_index === Number(row.party.slice(5)));
        return leaf && e.ciphertext_hash === leaf.ciphertext_hash;
      });
      let valid = !!rec;
      if (valid) {
        const opening = pub.opened.find((o) => o.leaf_index === Number(row.party.slice(5)));
        try {
          const pt = Buffer.from(opening?.plaintext_hex ?? "", "hex");
          valid = pt.length === 128 && verifyEnvelope(pt.subarray(61, 93).toString("hex"), pub.manifest.auction_id, rec.ciphertext_hash, rec.envelope_ct, rec.owner_sig) && pt.subarray(93, 125).toString("hex") === settlementCommitment(pt.subarray(45, 61).toString("hex"), rec.envelope_ct);
        } catch {
          valid = false;
        }
      }
      if (!valid) requireThat(records.some((c) => c.party === row.party), `claim-paid row ${row.party} without a published claim`);
    }
  });
  run2("accounting", () => {
    const result = pub.result;
    if (!result) return;
    const c = result.conservation;
    requireThat(
      BigInt(c.input_zats) + BigInt(c.balances_zats ?? "0") === BigInt(c.payout_zats) + BigInt(c.refund_zats) + BigInt(c.fees_zats),
      "conservation"
    );
    modeEntry(pub.manifestPacket).checkResult(pub.manifest, result);
    if (!pub.settlement) return;
    const receipts = pub.settlement.receipts ?? [];
    const rows = pub.settlement.rows ?? [];
    for (const [i, r] of receipts.entries()) {
      requireThat(Object.keys(r).sort().join(",") === settlementKeys, `settlement receipt ${i} shape`);
    }
    const expected = modeEntry(pub.manifestPacket).obligations(result, pub.settlement);
    for (const [party, amount] of expected) {
      const rs = receipts.filter((r) => r.party === party);
      const row = rows.find((r) => r.party === party);
      if (rs.length === 0) {
        requireThat(row && row.state === "exception" && row.amount_zats === amount, `settlement missing obligation ${party}`);
        continue;
      }
      requireThat(!(row && row.state === "exception"), `exception row ${party} with receipt`);
      requireThat(rs.length === 1, `duplicate settlement ${party}`);
      requireThat(rs[0].amount_zats === amount, `settlement ${party} amount`);
    }
    for (const row of rows) {
      if (!expected.has(row.party)) continue;
      requireThat(row.amount_zats === expected.get(row.party), `row ${row.party} amount`);
      const rs = receipts.filter((r) => r.party === row.party && r.amount_zats === row.amount_zats);
      if (row.state === "exception") requireThat(rs.length === 0, `exception row ${row.party} with receipt`);
      else requireThat(rs.length > 0, `row ${row.party} without receipt`);
    }
  });
  run2("accounting-strays", () => {
    if (!pub.settlement || !pub.result) return;
    const receipts = pub.settlement.receipts ?? [];
    const rows = pub.settlement.rows ?? [];
    const expected = modeEntry(pub.manifestPacket).obligations(pub.result, pub.settlement);
    const stray = (party) => {
      requireThat(/^deposit:[0-9a-f]{64}:.+$/.test(party), `party ${party} is neither a result obligation nor a stray deposit`);
    };
    for (const r of receipts) {
      if (expected.has(r.party)) continue;
      stray(r.party);
      const row = rows.find((x) => x.party === r.party);
      requireThat(row, `stray receipt ${r.party} without row`);
      requireThat(row.amount_zats === r.amount_zats, `stray ${r.party} amount`);
    }
    for (const row of rows) {
      if (expected.has(row.party)) continue;
      stray(row.party);
      const rs = receipts.filter((r) => r.party === row.party);
      if (row.state === "exception") requireThat(rs.length === 0, `stray ${row.party} exception row with receipt`);
      else {
        requireThat(rs.length > 0, `stray ${row.party} not refunded or exception`);
        requireThat(rs.length === 1, `duplicate stray ${row.party}`);
        requireThat(rs[0].amount_zats === row.amount_zats, `stray ${row.party} amount`);
      }
    }
  });
  return checks;
}
function releaseTime(m) {
  return m.drand.genesis + (m.drand.R - 1) * m.drand.period;
}
var statementFields = "auction_id,balance_due_zats,ciphertext_hash,clearing_price_zats,fill,leaf_index,owner_pubkey,payment_zats,payout_txid,price_zats,refund_txid,refund_zats,signature,version";
function settlementStatementBody(pub, ciphertextHash) {
  requireThat(pub.frozen && pub.result, "missing frozen or result");
  const frozen = pub.frozen, result = pub.result;
  const leaf = frozen.leaves.find((l) => l.ciphertext_hash === ciphertextHash);
  requireThat(leaf, "ciphertext not in frozen set");
  const a = result.allocations.find((x) => x.leaf_index === leaf.leaf_index);
  requireThat(a, "allocation missing");
  const opening = pub.opened.find((o) => o.leaf_index === leaf.leaf_index);
  requireThat(opening && /^[0-9a-f]{256}$/.test(opening.plaintext_hex ?? ""), "opening for statement");
  const owner_pubkey = Buffer.from(opening.plaintext_hex, "hex").subarray(61, 93).toString("hex");
  const owed = BigInt(modeEntry(pub.manifestPacket).obligations(result, pub.settlement).get(`leaf:${leaf.leaf_index}`) ?? "0");
  const receipt = (pub.settlement?.receipts ?? []).find((r) => r.party === `leaf:${leaf.leaf_index}`);
  const clearing_price_zats = a.tranche === "holder" && result.holder_price_zats !== void 0 ? result.holder_price_zats : a.lot === void 0 ? result.clearing_price_zats : (result.lots ?? []).find((l) => l.lot_id === a.lot)?.clearing_price_zats ?? result.clearing_price_zats;
  return {
    version: 1,
    auction_id: frozen.auction_id,
    ciphertext_hash: ciphertextHash,
    leaf_index: leaf.leaf_index,
    fill: a.fill,
    price_zats: a.price_zats,
    clearing_price_zats,
    payment_zats: a.payment_zats,
    refund_zats: a.refund_zats,
    // Gate CF: the winner's unpaid balance is due within its window (bond-then-pay); "0" without bond.
    balance_due_zats: a.balance_due_zats ?? "0",
    payout_txid: receipt && owed > BigInt(a.refund_zats) ? receipt.txid : null,
    refund_txid: receipt ? receipt.txid : null,
    owner_pubkey
  };
}
function checkSettlementStatement(pub, ciphertextHash, statement) {
  requireThat(statement && typeof statement === "object" && !Array.isArray(statement), "statement shape");
  requireThat(Object.keys(statement).sort().join(",") === statementFields, "statement field set");
  requireThat(/^[0-9a-f]{128}$/.test(String(statement.signature)), "statement signature");
  const { signature, ...body } = statement;
  const wanted = settlementStatementBody(pub, ciphertextHash);
  requireThat(jsonBytes(body).equals(jsonBytes(wanted)), "statement differs from result/settlement");
  requireThat(verifyStatement(wanted.owner_pubkey, body, signature), "statement signature");
}

// cli/published-beacon.ts
var import_tlock_js = __toESM(require_tlock_js(), 1);
function publishedClient(beacon) {
  requireThat(Number.isSafeInteger(beacon.round) && beacon.round > 0 && /^[0-9a-f]{96}$/.test(beacon.signature), "beacon round/signature");
  const round = Buffer.alloc(8);
  round.writeBigUInt64BE(BigInt(beacon.round));
  let valid = false;
  try {
    valid = bls12_381.verifyShortSignature(
      beacon.signature,
      Buffer.from(hash(round), "hex"),
      QUICKNET.public_key,
      { DST: "BLS_SIG_BLS12381G1_XMD:SHA-256_SSWU_RO_NUL_" }
    );
  } catch {
  }
  requireThat(valid, "beacon BLS signature invalid");
  const info = {
    public_key: QUICKNET.public_key,
    period: QUICKNET.period,
    genesis_time: QUICKNET.genesis,
    hash: QUICKNET.chain_hash,
    groupHash: "",
    schemeID: QUICKNET.scheme,
    metadata: { beaconID: "quicknet" }
  };
  const publicBeacon = { ...beacon, randomness: hash(Buffer.from(beacon.signature, "hex")) };
  return {
    options: { disableBeaconVerification: false, noCache: true },
    chain: () => ({ baseUrl: "", info: async () => info }),
    latest: async () => publicBeacon,
    get: async (requested) => {
      requireThat(requested === beacon.round, "ciphertext beacon round");
      return publicBeacon;
    }
  };
}
async function decryptPublished(ciphertextHex, client2) {
  const ciphertext = Buffer.from(ciphertextHex, "hex").toString("binary");
  const info = await client2.chain().info();
  const stanza = ciphertext.match(/\n-> tlock ([1-9][0-9]*) ([0-9a-f]{64})\n/);
  requireThat(stanza && stanza[2] === info.hash, "ciphertext tlock stanza/chain");
  await client2.get(Number(stanza[1]));
  const log = console.log;
  console.log = () => {
  };
  try {
    return (await (0, import_tlock_js.timelockDecrypt)(ciphertext, client2)).toString("hex");
  } catch (e) {
    if (/^(The MAC did not validate for the fileKey and payload!|Error during decryption!)$/.test(e.message)) return null;
    throw e;
  } finally {
    console.log = log;
  }
}

// settle/envelopes.ts
function memoSealedBid(memoHex) {
  try {
    if (typeof memoHex !== "string" || !/^[0-9a-f]{1024}$/.test(memoHex)) return null;
    const memo = Buffer.from(memoHex, "hex"), length = memo.readUInt16BE(5);
    if (!memo.subarray(0, 5).equals(Buffer.from("ff424e5a01", "hex")) || length <= 0 || length > 505) return null;
    if (!memo.subarray(7 + length).equals(Buffer.alloc(505 - length))) return null;
    return memo.subarray(7, 7 + length).toString("hex");
  } catch {
    return null;
  }
}
var ENVELOPE_CT_BYTES = 32 + 12 + ENVELOPE_PT_BYTES + 16;

// cli/commands/verify.ts
var help = "benzo verify --dir <public-auction-dir> --signer <ed25519-spki-der-hex> [--fetch-beacon] [--tle] [--offline] [--previous <prior-round-dir>] \u2014 re-derive openings offline and reproduce clear + accounting";
var tleOpening2 = (ciphertext, chain) => tleOpening("tle", chain, ciphertext);
async function run(argv) {
  if (argv.includes("--help")) {
    process.stdout.write(help + "\n");
    return 0;
  }
  let dir = "", signerHex = "", fetchBeacon = false, crossCheck = false, previous = "";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--dir") dir = argv[++i] ?? "";
    else if (argv[i] === "--signer") signerHex = argv[++i] ?? "";
    else if (argv[i] === "--offline") {
    } else if (argv[i] === "--fetch-beacon") fetchBeacon = true;
    else if (argv[i] === "--tle") crossCheck = true;
    else if (argv[i] === "--previous") previous = argv[++i] ?? "";
    else {
      process.stderr.write(`ERROR verify usage: ${help}
`);
      return 2;
    }
  }
  if (!dir || !/^[0-9a-f]{88}$/.test(signerHex)) {
    process.stderr.write(`ERROR verify usage: ${help}
`);
    return 2;
  }
  try {
    const pub = loadCompletePublicAuction(dir, { signer: signerHex });
    if (pub.legacy) process.stderr.write("WARN legacy projections (no auction.json); fallback for Phase 2/3 evidence dirs\n");
    requireThat(pub.beacon || fetchBeacon, "no published beacon; rerun with --fetch-beacon");
    const fetchPublished = async (round, beacon) => {
      const base = process.env.BNZ_DRAND_URLS?.split(",")[0] || "https://api.drand.sh";
      const response = await fetch(`${base}/${pub.manifest.drand.chain_hash}/public/${round}`, { signal: AbortSignal.timeout(15e3) });
      requireThat(response.ok, `drand HTTP ${response.status}`);
      const fetched = await response.json();
      requireThat(fetched.round === round, "fetched beacon round");
      if (beacon) requireThat(fetched.signature === beacon.signature, "published beacon differs from fetched beacon");
      return { round: fetched.round, signature: fetched.signature, chain_hash: pub.manifest.drand.chain_hash };
    };
    const published = pub.beacon;
    if (fetchBeacon) pub.beacon = await fetchPublished(pub.manifest.drand.R, published);
    const local = publishedClient(pub.beacon);
    if (!published) process.stderr.write("WARN beacon fetched (not published)\n");
    const derived = [];
    for (const leaf of pub.frozen.leaves) {
      const plaintext = await decryptPublished(leaf.ciphertext_hex, local);
      if (crossCheck) requireThat(tleOpening2(leaf.ciphertext_hex, pub.manifest.drand.chain_hash) === plaintext, `opening ${leaf.leaf_index} tle differs`);
      derived.push(plaintext === null ? { leaf_index: leaf.leaf_index, plaintext_hex: null, error: "undecryptable" } : { leaf_index: leaf.leaf_index, plaintext_hex: plaintext });
    }
    if (pub.opened.length) {
      requireThat(pub.opened.length === derived.length, "published opening count");
      const published2 = new Map(pub.opened.map((o) => [o.leaf_index, o]));
      for (const d of derived) {
        const p = published2.get(d.leaf_index);
        requireThat(
          p && p.plaintext_hex === d.plaintext_hex && (p.error ?? null) === (d.error ?? null),
          `opening ${d.leaf_index} published differs from re-derived`
        );
      }
    }
    pub.opened = derived;
    for (const c of pub.claims ?? []) if (c.memo_hex) {
      const ct = memoSealedBid(c.memo_hex);
      c.opening = ct ? await decryptPublished(ct, local) : null;
    }
    if (pub.manifest.sealed_reserve !== void 0) {
      const reserve = await decryptPublished(pub.manifest.sealed_reserve, local);
      requireReserveOpening(
        pub.manifest,
        pub.reserveOpening,
        reserve,
        crossCheck ? tleOpening2(pub.manifest.sealed_reserve, pub.manifest.drand.chain_hash) : void 0
      );
    } else requireReserveOpening(pub.manifest, pub.reserveOpening, null);
    if (pub.manifest.serials) {
      const round = pub.manifest.drand.R + pub.manifest.serials.seed_round_offset;
      requireThat(pub.result.serial_assignment && pub.result.serial_beacon_round === round, "serial result round/assignment");
      let beacon = pub.serialBeacon;
      requireThat(beacon, "missing published serial beacon");
      if (fetchBeacon) await fetchPublished(round, beacon);
      const d = pub.manifest.drand;
      requireThat(await (0, import_beacon_verification.verifyBeacon)(
        {
          public_key: d.public_key,
          period: d.period,
          genesis_time: d.genesis,
          hash: d.chain_hash,
          groupHash: "",
          schemeID: d.scheme,
          metadata: { beaconID: "quicknet" }
        },
        { ...beacon, randomness: hash(Buffer.from(beacon.signature, "hex")) },
        round
      ), "serial beacon BLS signature");
      pub.serialBeacon = beacon;
    } else requireThat(!pub.result.serial_assignment && pub.result.serial_beacon_round === void 0 && !pub.serialBeacon, "serial material without manifest serials");
    if (pub.manifest.series !== void 0 || previous) {
      if (!previous) process.stderr.write("WARN series linkage not checked (no --previous)\n");
      else {
        try {
          const prev = loadPublicAuction(previous, { signer: signerHex });
          requireThat(prev.resultBytes, "previous round has no result");
          checkSeriesLink(pub.manifest.series, { link: prev.manifest.series, result_hash: hash(prev.resultBytes) });
          process.stdout.write("OK series\n");
        } catch (e) {
          process.stderr.write(`ERROR series ${e.message}
`);
          return 1;
        }
      }
    }
    const checks = checkPublicAuction(pub);
    let failed = false;
    for (const c of checks) {
      if (c.warn) process.stderr.write(`WARN ${c.warn}
`);
      if (c.error) {
        failed = true;
        process.stderr.write(`ERROR ${c.id} ${c.error}
`);
      } else {
        process.stdout.write(`OK ${c.id}
`);
      }
    }
    return failed ? 1 : 0;
  } catch (e) {
    process.stderr.write(`ERROR verify ${e.message}
`);
    return 1;
  }
}

// cli/verify-standalone.ts
process.exitCode = await run(process.argv.slice(2));
/*! Bundled license information:

@noble/hashes/utils.js:
@noble/hashes/esm/utils.js:
  (*! noble-hashes - MIT License (c) 2022 Paul Miller (paulmillr.com) *)

@noble/curves/utils.js:
@noble/curves/abstract/modular.js:
@noble/curves/abstract/curve.js:
@noble/curves/abstract/weierstrass.js:
@noble/curves/abstract/bls.js:
@noble/curves/abstract/tower.js:
@noble/curves/bls12-381.js:
@noble/curves/esm/utils.js:
@noble/curves/esm/abstract/modular.js:
@noble/curves/esm/abstract/curve.js:
@noble/curves/esm/abstract/weierstrass.js:
@noble/curves/esm/abstract/bls.js:
@noble/curves/esm/abstract/tower.js:
@noble/curves/esm/bls12-381.js:
  (*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) *)
*/
