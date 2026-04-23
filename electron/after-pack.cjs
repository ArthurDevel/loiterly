const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

function runCodesign(args, options = {}) {
  execFileSync('codesign', args, {
    stdio: 'pipe',
    ...options,
  })
}

exports.default = async function afterPack(context) {
  if (process.platform !== 'darwin') {
    return
  }

  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  if (!fs.existsSync(appPath)) {
    throw new Error(`Packed app not found for ad-hoc signing: ${appPath}`)
  }

  try {
    runCodesign(['--remove-signature', appPath])
  } catch {
    // Unsigned bundles and some nested binaries will fail removal; ignore and re-sign.
  }

  runCodesign(['--force', '--deep', '--sign', '-', appPath])
  runCodesign(['--verify', '--deep', '--strict', '--verbose=2', appPath])
}
