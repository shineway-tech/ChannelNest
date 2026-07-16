function __xhsSignJson(__xhsInputJson) {
const __xhsInput = JSON.parse(__xhsInputJson);
if (typeof window.mnsv2 !== "function" && typeof mnsv2 === "function") {
  window.mnsv2 = mnsv2;
}
if (typeof window.mnsv2 !== "function") {
  throw new Error("mnsv2 unavailable");
}
const __xhsResult = module.exports.get_request_headers_params(
  __xhsInput.api,
  __xhsInput.data || "",
  __xhsInput.a1
);
return JSON.stringify({
  "x-s": __xhsResult.xs,
  "x-t": String(__xhsResult.xt),
  "x-s-common": __xhsResult.xs_common,
  "x-b3-traceid": __xhsTraceHex(16),
  "x-xray-traceid": __xhsTraceHex(32)
});
}
