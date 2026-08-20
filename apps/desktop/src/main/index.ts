import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, normalize, sep } from "node:path";

import { PRODUCT_NAME } from "@knosys-rag/core";
import {
  app,
  BrowserWindow,
  nativeTheme,
  net,
  protocol,
  session,
  shell,
} from "electron";

import { registerIpcHandlers } from "./ipc.js";
import { EngineClient } from "./services/engine-client.js";

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const appRoot = join(currentDirectory, "../..");
const rendererRoot = join(appRoot, "out/renderer");
const developmentRendererUrl = process.env.ELECTRON_RENDERER_URL;
const engineClient = new EngineClient();

app.setName(PRODUCT_NAME);
app.setPath("userData", join(app.getPath("appData"), PRODUCT_NAME));

protocol.registerSchemesAsPrivileged([
  {
    privileges: {
      secure: true,
      standard: true,
      supportFetchAPI: true,
    },
    scheme: "app",
  },
]);

function resolveRendererAsset(url: URL): string | null {
  const relativePath = decodeURIComponent(url.pathname.replace(/^\/+/, "")) || "index.html";
  const candidate = normalize(join(rendererRoot, relativePath));
  const rootPrefix = `${normalize(rendererRoot)}${sep}`;

  if (candidate !== normalize(rendererRoot) && !candidate.startsWith(rootPrefix)) {
    return null;
  }

  return candidate;
}

function registerApplicationProtocol(): void {
  protocol.handle("app", (request) => {
    const url = new URL(request.url);
    if (url.host !== "bundle") {
      return new Response("Not found", { status: 404 });
    }

    const assetPath = resolveRendererAsset(url);
    if (!assetPath) {
      return new Response("Not found", { status: 404 });
    }

    return net.fetch(pathToFileURL(assetPath).toString());
  });
}

function configureSessionSecurity(): void {
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) => {
    // The renderer's copy-to-clipboard buttons need this one permission; every
    // other capability request stays denied.
    callback(permission === "clipboard-sanitized-write");
  });

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const isApplicationPage =
      details.url.startsWith("app://bundle") ||
      (developmentRendererUrl !== undefined &&
        details.url.startsWith(developmentRendererUrl));

    if (!isApplicationPage || developmentRendererUrl) {
      callback(
        details.responseHeaders
          ? { responseHeaders: details.responseHeaders }
          : {},
      );
      return;
    }

    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [
          "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self' data:; img-src 'self' data:; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'",
        ],
      },
    });
  });
}

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#16141a" : "#fbfafc",
    height: 860,
    minHeight: 640,
    minWidth: 320,
    show: false,
    title: PRODUCT_NAME,
    titleBarStyle: "hiddenInset",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: join(currentDirectory, "../preload/index.cjs"),
      sandbox: true,
      webSecurity: true,
    },
    width: 1320,
  });

  window.webContents.on("will-navigate", (event) => {
    event.preventDefault();
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    const parsed = new URL(url);
    if (parsed.protocol === "https:") {
      void shell.openExternal(parsed.toString());
    }
    return { action: "deny" };
  });

  window.once("ready-to-show", () => window.show());

  if (developmentRendererUrl) {
    void window.loadURL(developmentRendererUrl);
  } else {
    void window.loadURL("app://bundle/index.html");
  }

  return window;
}

void app.whenReady().then(() => {
  registerApplicationProtocol();
  configureSessionSecurity();
  registerIpcHandlers(engineClient);
  void engineClient.start().catch((error: unknown) => {
    console.error("The local knowledge engine could not start.", error);
  });
  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("before-quit", () => engineClient.stop());

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
