var __xhsHostGlobal = globalThis;
var global = __xhsHostGlobal;
var window = global;
var self = global;
var Navigator, navigator, Location, location, Storage, localStorage;
var Screen, screen, HTMLHtmlElement, html, HTMLBodyElement, body, HTMLDocument, document;
var mnsv2;
var process = { env: {}, browser: false, version: "", versions: {} };
var module = { exports: {} };
var exports = module.exports;
var console = {
  log: function() {},
  info: function() {},
  warn: function() {},
  error: function() {}
};
global.console = console;
global.process = process;
__xhsHostGlobal.console = console;
__xhsHostGlobal.process = process;

function require(name) {
  if (name === "crypto-js") {
    return {
      MD5: function(value) {
        return {
          toString: function() {
            return __xhsHostGlobal.__xhsMd5(String(value));
          }
        };
      }
    };
  }
  throw new Error("Unsupported module: " + name);
}

function __xhsTraceHex(length) {
  return __xhsHostGlobal.__xhsTraceHexRust(Number(length) || 0);
}

if (typeof btoa === "undefined") {
  var __xhsBase64Chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
  function btoa(input) {
    var str = String(input);
    var output = "";
    for (var block = 0, charCode, index = 0, map = __xhsBase64Chars; str.charAt(index | 0) || (map = "=", index % 1); output += map.charAt(63 & block >> 8 - index % 1 * 8)) {
      charCode = str.charCodeAt(index += 3 / 4);
      if (charCode > 0xff) {
        throw new Error("btoa failed");
      }
      block = block << 8 | charCode;
    }
    return output;
  }
  global.btoa = btoa;
}

if (typeof atob === "undefined") {
  function atob(input) {
    var str = String(input).replace(/=+$/, "");
    var output = "";
    if (str.length % 4 === 1) {
      throw new Error("atob failed");
    }
    for (var bc = 0, bs = 0, buffer, index = 0; buffer = str.charAt(index++); ~buffer && (bs = bc % 4 ? bs * 64 + buffer : buffer, bc++ % 4) ? output += String.fromCharCode(255 & bs >> (-2 * bc & 6)) : 0) {
      buffer = __xhsBase64Chars.indexOf(buffer);
    }
    return output;
  }
  global.atob = atob;
}

if (typeof performance === "undefined") {
  var performance = { now: function() { return Date.now(); } };
  global.performance = performance;
}

if (typeof Event === "undefined") {
  function Event(type) {
    this.type = type || "";
  }
  global.Event = Event;
}

if (typeof TextEncoder === "undefined") {
  function __xhsUtf8Bytes(input) {
    var text = String(input);
    var bytes = [];
    for (var index = 0; index < text.length; index += 1) {
      var codePoint = text.codePointAt(index);
      if (codePoint > 0xffff) {
        index += 1;
      }
      if (codePoint <= 0x7f) {
        bytes.push(codePoint);
      } else if (codePoint <= 0x7ff) {
        bytes.push(0xc0 | (codePoint >> 6));
        bytes.push(0x80 | (codePoint & 0x3f));
      } else if (codePoint <= 0xffff) {
        bytes.push(0xe0 | (codePoint >> 12));
        bytes.push(0x80 | ((codePoint >> 6) & 0x3f));
        bytes.push(0x80 | (codePoint & 0x3f));
      } else {
        bytes.push(0xf0 | (codePoint >> 18));
        bytes.push(0x80 | ((codePoint >> 12) & 0x3f));
        bytes.push(0x80 | ((codePoint >> 6) & 0x3f));
        bytes.push(0x80 | (codePoint & 0x3f));
      }
    }
    return new Uint8Array(bytes);
  }

  var TextEncoder = function TextEncoder() {};
  TextEncoder.prototype.encode = function(input) {
    return __xhsUtf8Bytes(input);
  };
  global.TextEncoder = TextEncoder;
}
