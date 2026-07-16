const fs = require('fs');
const path = require('path');

function safeTempFilePath(root, relativePath) {
  if (!relativePath) return null;
  const resolvedRoot = path.resolve(root);
  const filePath = path.resolve(resolvedRoot, relativePath);
  return filePath.startsWith(`${resolvedRoot}${path.sep}`) ? filePath : null;
}

async function ackImageOutputFile(output, root) {
  const filePath = safeTempFilePath(root, output.relative_path);
  if (filePath) {
    await fs.promises.rm(filePath, { force: true });
  }
  await output.update({
    status: 'downloaded',
    relative_path: '',
    downloaded_at: new Date(),
    deleted_at: new Date(),
  });
}

module.exports = {
  ackImageOutputFile,
  safeTempFilePath,
};
