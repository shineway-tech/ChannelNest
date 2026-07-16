This directory contains the Xiaohongshu creator-platform request signer used for
direct API calls.

Source reference:
- https://github.com/cv-cat/Spider_XHS
- `static/xhs_creator_260411.js`
- `static/xhs_rap.js`

The upstream README marks the project as MIT licensed. The repository did not
serve a LICENSE file at the time this asset was added, so keep this note with
the copied signer source.

Local changes:
- Removed the standalone test invocation that logs `window.mnsv2(...)`.
- `xhs_creator_runtime.js` and `xhs_creator_entry.js` adapt the creator signer
  to QuickJS, with MD5 and trace generation delegated to Rust.
- `xhs_rap_runtime.js` supplies the Node/browser globals required by
  `xhs_rap.js` inside QuickJS.
- The x-rap runtime is prewarmed in its own worker while media uploads run.
