import { createServer, Socket } from 'net';
import { IPty, spawn } from 'node-pty'; // Import spawn from node-pty

const bashServerPort = Number(process.env.BASH_SERVER_PORT) || 3031;

interface Window {
  proc: IPty;
  history: string;
}

interface Env {
  windows: { [id: string]: Window };
  activeWindowID: string | null;
}

const env: Env = {
  windows: {},
  activeWindowID: null,
};

const server = createServer();

const sockets: Socket[] = [];

function writeToSockets(msg: string) {
  sockets.forEach((socket) => {
    socket.write(msg);
  });
}

function newWindow(payload: any) {
  const { windowID, shellPath: shellPath = '/bin/bash', shellArgs: shellArgs = [] } = payload;
  const id = windowID || `window-${Math.random().toString(36).substring(7)}`;

  // Using node-pty to spawn the window
  env.windows[id] = {
    proc: spawn(shellPath, shellArgs, {
      name: 'xterm-color',
      cwd: process.cwd(),
      env: process.env,
    }),
    history: '',
  };
  env.activeWindowID = id;

  writeToSockets(`observation: created window with ID ${id} and made it active window.`);

  // Relay messages from the subprocess to the socket
  env.windows[id].proc.onData((data) => {
    writeToSockets(`observation: window ${id}:\n${data}`);
  });

  env.windows[id].proc.onExit(({ exitCode, signal }) => {
    writeToSockets(`observation: window '${id}' exited with code ${exitCode}, signal ${signal}.`);
    // Cleanup window from env.windows when it exits
    delete env.windows[id];
    if (env.activeWindowID === id) {
      env.activeWindowID = null; // Reset active window ID if the exited window was active
    }
  });
}

function runCommand(payload: any) {
  if (!env.activeWindowID) {
    writeToSockets('observation: there are no windows open.');
    return;
  }
  const { command } = payload;
  env.windows[env.activeWindowID].proc.write(`${command}\n`);
}

function switchToWindow(payload: any) {
  const { id } = payload;
  if (env.windows[id]) {
    env.activeWindowID = id;
    writeToSockets(`observation: switched to window '${id}'.`);
  } else {
    writeToSockets(`observation: window '${id}' does not exist.`);
  }
}

function whichWindowActive() {
  if (!env.activeWindowID) {
    writeToSockets('observation: there are no windows open.');
  } else {
    writeToSockets(`observation: active window is '${env.activeWindowID}'.`);
  }
}

function listWindows() {
  const windowIDs = Object.keys(env.windows);
  if (windowIDs.length === 0) {
    writeToSockets('observation: there are no windows open.');
  } else {
    writeToSockets(`observation: open windows: ${windowIDs.join(', ')}`);
  }
}

server.on('connection', (socket) => {
  console.log('bashServer: client connected');
  sockets.push(socket);

  socket.on('data', (data) => {
    console.log('received:', data.toString());
    const msg = JSON.parse(data.toString());
    const { type, payload = {} } = msg;
    switch (type) {
      case 'newWindow':
        newWindow(payload);
        break;
      case 'runCommand':
        runCommand(payload);
        break;
      case 'switchToWindow':
        switchToWindow(payload);
        break;
      case 'whichWindowActive':
        whichWindowActive();
        break;
      case 'listWindows':
        listWindows();
        break;
      default:
        console.log('received unrecognized type from client:', type);
    }
  });

  socket.on('close', () => {
    console.log('a client disconnected');
    const index = sockets.indexOf(socket);
    if (index !== -1) {
      sockets.splice(index, 1);
    }
  });
});

server.listen(bashServerPort, () => {
  console.log(`bashServer listening on port ${bashServerPort}`);
});

console.log("done running listen. registering process.on('SIGTERM')");
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received. Shutting down...');
  process.exit(0);
});
