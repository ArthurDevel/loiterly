# Loiterly

## Run locally on macOS

If you do not want to use the DMG, you can run the app directly:

```bash
git clone https://github.com/ArthurDevel/loiterly.git
cd loiterly
npm install
npm start
```

That starts the Electron app locally on your Mac.

## Install locally on macOS

If you want Loiterly to behave like a normal installed app instead of depending on an open terminal:

```bash
npm install
npm run install:mac
```

That builds an unsigned local `Loiterly.app` bundle, copies it into `/Applications` when writable, otherwise `~/Applications`, and launches it.

If you only want to install without launching:

```bash
npm run install:mac:no-open
```

This does not require an Apple Developer account for local use on the same Mac, but it is not a signed distribution flow for sharing the app with other machines.
