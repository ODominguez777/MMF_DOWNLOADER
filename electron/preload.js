const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktopApi", {
    checkDependencies: () => ipcRenderer.invoke("desktop:check-dependencies"),
    installMissingDependencies: () => ipcRenderer.invoke("desktop:install-missing-dependencies"),
    getRuntimeInfo: (payload) => ipcRenderer.invoke("desktop:get-runtime-info", payload),
    pickDirectory: (payload) => ipcRenderer.invoke("desktop:pick-directory", payload),
    openPath: (payload) => ipcRenderer.invoke("desktop:open-path", payload),
    listModelJsonFiles: (payload) => ipcRenderer.invoke("desktop:list-model-json-files", payload),
    readModelJsonFile: (payload) => ipcRenderer.invoke("desktop:read-model-json-file", payload),
    loadSettings: () => ipcRenderer.invoke("desktop:load-settings"),
    saveSettings: (payload) => ipcRenderer.invoke("desktop:save-settings", payload),
    resolveOwnModelIds: (payload) => ipcRenderer.invoke("desktop:resolve-own-model-ids", payload),
    startWorkflowStep: (payload) => ipcRenderer.invoke("desktop:start-workflow-step", payload),
    stopWorkflowStep: () => ipcRenderer.invoke("desktop:stop-workflow-step"),
    onWorkflowLog: (handler) => {
        const listener = (_event, payload) => handler(payload);
        ipcRenderer.on("workflow:log", listener);
        return () => ipcRenderer.removeListener("workflow:log", listener);
    },
    onWorkflowState: (handler) => {
        const listener = (_event, payload) => handler(payload);
        ipcRenderer.on("workflow:state", listener);
        return () => ipcRenderer.removeListener("workflow:state", listener);
    }
});
