const fileManager = (window as unknown as {
  fileManager: Record<string, (...args: unknown[]) => Promise<unknown>>;
}).fileManager;
const chooseRoot = document.querySelector<HTMLButtonElement>("#choose-root");
chooseRoot?.addEventListener("click", () => { void fileManager.chooseRoot(); });
