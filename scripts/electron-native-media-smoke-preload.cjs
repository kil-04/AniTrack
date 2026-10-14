const { contextBridge, ipcRenderer } = require("electron");

// This local fixture has no provider, account, filesystem or arbitrary IPC bridge.
contextBridge.exposeInMainWorld("mediaFixture", {
  status: id => ipcRenderer.invoke("providers:media-access-status", id),
  onRejected: listener => {
    const receive = (_event, value) => listener(value);
    ipcRenderer.on("providers:media-access-rejected", receive);
    return () => ipcRenderer.removeListener("providers:media-access-rejected", receive);
  },
});
