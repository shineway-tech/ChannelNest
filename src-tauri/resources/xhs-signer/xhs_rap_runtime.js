var __xhsRapGlobal = globalThis;
var __xhsRapBase64Chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";

if (typeof console === "undefined") {
  var console = { log: function() {}, info: function() {}, warn: function() {}, error: function() {}, debug: function() {} };
  __xhsRapGlobal.console = console;
}

if (typeof setTimeout === "undefined") {
  var setTimeout = function setTimeout(callback) { if (typeof callback === "function") callback(); return 0; };
  __xhsRapGlobal.setTimeout = setTimeout;
}
if (typeof clearTimeout === "undefined") {
  var clearTimeout = function clearTimeout() {};
  __xhsRapGlobal.clearTimeout = clearTimeout;
}

function __xhsRapBtoa(input) {
  var bytes = String(input);
  var output = "";
  for (var block = 0, charCode, index = 0, map = __xhsRapBase64Chars; bytes.charAt(index | 0) || (map = "=", index % 1); output += map.charAt(63 & block >> 8 - index % 1 * 8)) {
    charCode = bytes.charCodeAt(index += 3 / 4);
    if (charCode > 0xff) throw new Error("btoa failed");
    block = block << 8 | charCode;
  }
  return output;
}

function __xhsRapAtob(input) {
  var encoded = String(input).replace(/=+$/, "");
  var output = "";
  if (encoded.length % 4 === 1) throw new Error("atob failed");
  for (var bc = 0, bs = 0, buffer, index = 0; buffer = encoded.charAt(index++); ~buffer && (bs = bc % 4 ? bs * 64 + buffer : buffer, bc++ % 4) ? output += String.fromCharCode(255 & bs >> (-2 * bc & 6)) : 0) {
    buffer = __xhsRapBase64Chars.indexOf(buffer);
  }
  return output;
}

function __xhsRapUtf8Bytes(input) {
  var text = String(input);
  var bytes = [];
  for (var index = 0; index < text.length; index += 1) {
    var codePoint = text.codePointAt(index);
    if (codePoint > 0xffff) index += 1;
    if (codePoint <= 0x7f) {
      bytes.push(codePoint);
    } else if (codePoint <= 0x7ff) {
      bytes.push(0xc0 | codePoint >> 6, 0x80 | codePoint & 0x3f);
    } else if (codePoint <= 0xffff) {
      bytes.push(0xe0 | codePoint >> 12, 0x80 | codePoint >> 6 & 0x3f, 0x80 | codePoint & 0x3f);
    } else {
      bytes.push(0xf0 | codePoint >> 18, 0x80 | codePoint >> 12 & 0x3f, 0x80 | codePoint >> 6 & 0x3f, 0x80 | codePoint & 0x3f);
    }
  }
  return new Uint8Array(bytes);
}

if (typeof TextEncoder === "undefined") {
  var TextEncoder = function TextEncoder() {};
  TextEncoder.prototype.encode = function(input) { return __xhsRapUtf8Bytes(input); };
  __xhsRapGlobal.TextEncoder = TextEncoder;
}

if (typeof TextDecoder === "undefined") {
  var TextDecoder = function TextDecoder() {};
  TextDecoder.prototype.decode = function(input) {
    var bytes = input ? new Uint8Array(input.buffer || input, input.byteOffset || 0, input.byteLength === undefined ? input.length : input.byteLength) : new Uint8Array();
    var output = "";
    for (var index = 0; index < bytes.length;) {
      var first = bytes[index++];
      if (first < 0x80) {
        output += String.fromCharCode(first);
      } else if (first < 0xe0) {
        output += String.fromCharCode((first & 0x1f) << 6 | bytes[index++] & 0x3f);
      } else if (first < 0xf0) {
        output += String.fromCharCode((first & 0x0f) << 12 | (bytes[index++] & 0x3f) << 6 | bytes[index++] & 0x3f);
      } else {
        var codePoint = (first & 0x07) << 18 | (bytes[index++] & 0x3f) << 12 | (bytes[index++] & 0x3f) << 6 | bytes[index++] & 0x3f;
        codePoint -= 0x10000;
        output += String.fromCharCode(0xd800 | codePoint >> 10, 0xdc00 | codePoint & 0x3ff);
      }
    }
    return output;
  };
  __xhsRapGlobal.TextDecoder = TextDecoder;
}

if (typeof URLSearchParams === "undefined") {
  var URLSearchParams = function URLSearchParams(input) {
    this._entries = [];
    var source = String(input || "").replace(/^\?/, "");
    if (!source) return;
    var parts = source.split("&");
    for (var index = 0; index < parts.length; index += 1) {
      var pair = parts[index].split("=");
      this.append(decodeURIComponent(pair.shift().replace(/\+/g, " ")), decodeURIComponent(pair.join("=").replace(/\+/g, " ")));
    }
  };
  URLSearchParams.prototype.append = function(key, value) { this._entries.push([String(key), String(value)]); };
  URLSearchParams.prototype.delete = function(key) { this._entries = this._entries.filter(function(entry) { return entry[0] !== String(key); }); };
  URLSearchParams.prototype.get = function(key) {
    key = String(key);
    for (var index = 0; index < this._entries.length; index += 1) if (this._entries[index][0] === key) return this._entries[index][1];
    return null;
  };
  URLSearchParams.prototype.getAll = function(key) { key = String(key); return this._entries.filter(function(entry) { return entry[0] === key; }).map(function(entry) { return entry[1]; }); };
  URLSearchParams.prototype.has = function(key) { return this.get(key) !== null; };
  URLSearchParams.prototype.set = function(key, value) { this.delete(key); this.append(key, value); };
  URLSearchParams.prototype.toString = function() { return this._entries.map(function(entry) { return encodeURIComponent(entry[0]).replace(/%20/g, "+") + "=" + encodeURIComponent(entry[1]).replace(/%20/g, "+"); }).join("&"); };
  URLSearchParams.prototype.forEach = function(callback, thisArg) { this._entries.forEach(function(entry) { callback.call(thisArg, entry[1], entry[0], this); }, this); };
  __xhsRapGlobal.URLSearchParams = URLSearchParams;
}

if (typeof URL === "undefined") {
  var URL = function URL(input, base) {
    var raw = String(input);
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
      var baseUrl = new URL(String(base || "https://www.xiaohongshu.com/"));
      raw = raw.charAt(0) === "/" ? baseUrl.origin + raw : baseUrl.origin + baseUrl.pathname.replace(/[^/]*$/, "") + raw;
    }
    var match = raw.match(/^([a-z][a-z0-9+.-]*:)?\/\/([^/?#]*)([^?#]*)(\?[^#]*)?(#.*)?$/i);
    if (!match) throw new TypeError("Invalid URL");
    this.protocol = match[1] || "";
    this.host = match[2] || "";
    this.hostname = this.host.replace(/:\d+$/, "");
    this.port = (this.host.match(/:(\d+)$/) || ["", ""])[1];
    this.origin = this.protocol + "//" + this.host;
    this.pathname = match[3] || "/";
    this.search = match[4] || "";
    this.hash = match[5] || "";
    this.searchParams = new URLSearchParams(this.search);
    this.href = this.origin + this.pathname + this.search + this.hash;
  };
  URL.prototype.toString = function() { return this.href; };
  URL.prototype.toJSON = function() { return this.href; };
  __xhsRapGlobal.URL = URL;
}

if (typeof Buffer === "undefined") {
  var Buffer = {
    from: function(value, encoding) {
      var bytes;
      if (typeof value === "string") {
        if (encoding === "base64") {
          var decoded = __xhsRapAtob(value);
          bytes = new Uint8Array(decoded.length);
          for (var index = 0; index < decoded.length; index += 1) bytes[index] = decoded.charCodeAt(index);
        } else if (encoding === "binary" || encoding === "latin1") {
          bytes = new Uint8Array(value.length);
          for (var index = 0; index < value.length; index += 1) bytes[index] = value.charCodeAt(index) & 0xff;
        } else {
          bytes = __xhsRapUtf8Bytes(value);
        }
      } else {
        bytes = new Uint8Array(value.buffer || value, value.byteOffset || 0, value.byteLength === undefined ? value.length : value.byteLength);
      }
      bytes.toString = function(outputEncoding) {
        var binary = "";
        for (var index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index]);
        if (outputEncoding === "base64") return __xhsRapBtoa(binary);
        if (outputEncoding === "binary" || outputEncoding === "latin1") return binary;
        return new TextDecoder().decode(bytes);
      };
      return bytes;
    }
  };
  __xhsRapGlobal.Buffer = Buffer;
}

function require(name) {
  if (name === "crypto") {
    return {
      webcrypto: {
        getRandomValues: function(array) {
          var hex = __xhsRapGlobal.__xhsRapRandomHexRust(array.length * 2);
          for (var index = 0; index < array.length; index += 1) array[index] = parseInt(hex.slice(index * 2, index * 2 + 2), 16);
          return array;
        },
        subtle: {}
      }
    };
  }
  throw new Error("Unsupported module: " + name);
}
