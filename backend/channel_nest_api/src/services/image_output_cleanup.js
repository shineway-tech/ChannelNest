const OssTempStorage = require('./oss_temp_storage');

async function ackImageOutputFile(output) {
  const objectKey = OssTempStorage.parseStoredPath(output.relative_path);
  if (objectKey && OssTempStorage.enabled()) {
    await OssTempStorage.deleteObject(objectKey);
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
};
