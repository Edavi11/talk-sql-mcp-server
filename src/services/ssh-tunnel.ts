/**
 * SSH Tunnel Service
 * Opens an SSH tunnel and returns a local port that forwards to the remote DB host/port.
 */

import { Client, ConnectConfig } from "ssh2";
import * as net from "net";
import * as fs from "fs";
import * as os from "os";
import type { SshConfig } from "../types.js";

export interface SshTunnelHandle {
  localPort: number;
  close: () => Promise<void>;
}

/**
 * Opens an SSH tunnel to the given remote host/port through the SSH server described in `ssh`.
 * Returns a handle with the local port to connect to, and a close() function to tear down the tunnel.
 */
export async function openSshTunnel(
  ssh: SshConfig,
  remoteHost: string,
  remotePort: number
): Promise<SshTunnelHandle> {
  const client = new Client();

  // Build SSH connect config
  const connectConfig: ConnectConfig = {
    host: ssh.host,
    port: ssh.port ?? 22,
    username: ssh.username,
    readyTimeout: 15000
  };

  if (ssh.privateKeyPath) {
    const expandedPath = ssh.privateKeyPath.replace(/^~/, os.homedir());
    if (!fs.existsSync(expandedPath)) {
      throw new Error(
        `SSH private key file not found: ${expandedPath} (configured for SSH host ${ssh.host})`
      );
    }
    connectConfig.privateKey = fs.readFileSync(expandedPath);
  } else if (ssh.password) {
    connectConfig.password = ssh.password;
  } else {
    throw new Error("SSH requires either privateKeyPath or password");
  }

  // Connect SSH client
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      client.destroy();
      reject(new Error(`SSH connection to ${ssh.host}:${ssh.port ?? 22} timed out after 15 seconds`));
    }, 15000);

    client
      .once("ready", () => {
        clearTimeout(timeout);
        resolve();
      })
      .once("error", (err) => {
        clearTimeout(timeout);
        reject(new Error(`SSH tunnel to ${ssh.host}:${ssh.port ?? 22} failed: ${err.message}`));
      })
      .once("close", () => {
        clearTimeout(timeout);
        reject(new Error(`SSH connection to ${ssh.host}:${ssh.port ?? 22} closed before ready`));
      })
      .connect(connectConfig);
  });

  // Create local TCP server that forwards to remote DB through the SSH tunnel
  const server = net.createServer((socket) => {
    client.forwardOut(
      "127.0.0.1",
      0,
      remoteHost,
      remotePort,
      (err, stream) => {
        if (err) {
          console.error(`SSH forwardOut error: ${err.message}`);
          socket.destroy();
          return;
        }
        stream.pipe(socket);
        socket.pipe(stream);
        stream.once("close", () => socket.destroy());
        socket.once("close", () => stream.destroy());
        stream.once("error", () => socket.destroy());
        socket.once("error", () => stream.destroy());
      }
    );
  });

  // Listen on a random free port
  const localPort = await new Promise<number>((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("Failed to get local port for SSH tunnel"));
        return;
      }
      resolve(addr.port);
    });
    server.once("error", reject);
  });

  const close = (): Promise<void> =>
    new Promise((resolve) => {
      server.close(() => {
        client.end();
        resolve();
      });
    });

  return { localPort, close };
}
