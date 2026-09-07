import path from "node:path";

export async function installDestinationSwapFault(electronApp, appRoot, configuration) {
  const modulePath = path.join(appRoot, "dist", "fms", "windows-filesystem-adapter.js");
  await electronApp.evaluate(async (_, input) => {
    const { createRequire } = process.getBuiltinModule("node:module");
    const fs = process.getBuiltinModule("node:fs/promises");
    const pathModule = process.getBuiltinModule("node:path");
    const requireFromModule = createRequire(input.modulePath);
    const { WindowsFilesystemAdapter } = requireFromModule(input.modulePath);
    const prototype = WindowsFilesystemAdapter.prototype;
    if (globalThis.__msspDestinationSwapFault) throw new Error("destination swap fault already installed");
    const original = prototype.lstat;
    const same = (left, right) => pathModule.resolve(left).toLocaleLowerCase("en-US")
      === pathModule.resolve(right).toLocaleLowerCase("en-US");
    const state = {
      original,
      count: 0,
      swapped: false,
      replacement: input.replacement,
      destination: input.destination,
      backup: input.backup,
      outsideTarget: input.outsideTarget,
    };
    globalThis.__msspDestinationSwapFault = state;
    prototype.lstat = async function lstatWithDestinationSwap(subject) {
      if (same(subject, input.destination)) {
        state.count += 1;
        if (state.count === 2) {
          await fs.rename(input.destination, input.backup);
          if (input.replacement === "file") {
            await fs.writeFile(input.destination, Buffer.from("destination-became-file\n", "utf8"), { flag: "wx" });
          } else {
            await fs.mkdir(input.outsideTarget);
            await fs.symlink(input.outsideTarget, input.destination, "junction");
          }
          state.swapped = true;
        }
      }
      return original.call(this, subject);
    };
  }, { modulePath, ...configuration });
}

export async function finishDestinationSwapFault(electronApp) {
  return electronApp.evaluate(() => {
    const state = globalThis.__msspDestinationSwapFault;
    if (!state) throw new Error("destination swap fault was not installed");
    const { createRequire } = process.getBuiltinModule("node:module");
    const pathModule = process.getBuiltinModule("node:path");
    const modulePath = pathModule.join(process.cwd(), "dist", "fms", "windows-filesystem-adapter.js");
    const { WindowsFilesystemAdapter } = createRequire(modulePath)(modulePath);
    WindowsFilesystemAdapter.prototype.lstat = state.original;
    delete globalThis.__msspDestinationSwapFault;
    return {
      count: state.count,
      swapped: state.swapped,
      replacement: state.replacement,
      destination: state.destination,
      backup: state.backup,
      outsideTarget: state.outsideTarget,
    };
  });
}
