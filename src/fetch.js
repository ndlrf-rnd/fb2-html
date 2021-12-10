const fs = require('fs');
const path = require('path');
const nodeFetch = require('node-fetch');


/**
 *  * Fetch remote file
 *   * @param src
 *    * @param localPath
 *     * @returns {Promise<Promise<*|*|Promise<any>|Promise>|*>}
 *      */
const fetch = async (src, localPath, cleanUnfinished=true) => {
  const targetDir = path.dirname(localPath); 
  if (!fs.existsSync(targetDir)) {
    process.stderr.write(`Target directory: ${targetDir} do not exists and will be created automatically\n`);
    fs.mkdirSync(targetDir, recursive=true);
  }
  if (src.startsWith('file://')) {
    fs.copyFileSync(src.split('//')[1], localPath);
    return localPath;
  }

  const response = await nodeFetch(src);
  if (!response.ok) {
    throw new Error(`ERROR: Unexpectea response: "${response.statusText}"`); 
  }
  response.body.pipe(fs.createWriteStream(localPath));
  return new Promise((resolve, reject) => {
    response.body.on('error', (e) => {
      process.stderr.write(`ERROR: Error while downloading ${src}:\n${e.message}\n${e.stack}\n`);
      if (cleanUnfinished && fs.existsSync(localPath)) {
        fs.unlinkSync(localPath);
      }
      reject(e);
    });
    response.body.on('end', () => {
      process.stderr.write(`Download completed ${src}`);
      resolve(localPath);
    });
  });
};

module.exports = {
  fetch,
};
