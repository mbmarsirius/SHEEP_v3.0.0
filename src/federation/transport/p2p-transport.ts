/**
 * P2P Transport Layer (WebSocket)
 *
 * Direct peer-to-peer transport for Pro/Enterprise tiers.
 */

import { WebSocket, WebSocketServer } from "ws";
import { createSubsystemLogger, type SubsystemLogger } from "../../stubs/logging.js";
import { FederationMessage } from "../protocol/messages.js";

export interface P2PTransportConfig {
  port?: number;
  logger?: SubsystemLogger;
}

export interface P2PConnection {
  agentId: string;
  ws: WebSocket;
  connectedAt: Date;
}

export class P2PTransport {
  private readonly server?: WebSocketServer;
  private readonly logger: SubsystemLogger;
  private connections: Map<string, P2PConnection> = new Map();

  constructor(config?: P2PTransportConfig) {
    this.logger = config?.logger ?? createSubsystemLogger("P2PTransport");

    if (config?.port) {
      this.server = new WebSocketServer({ port: config.port });
      this.setupServer();
    }
  }

  /**
   * Setup WebSocket server
   */
  private setupServer(): void {
    if (!this.server) return;

    this.server.on("connection", (ws: WebSocket, req) => {
      const agentId = req.url?.split("?agentId=")[1] ?? "unknown";

      const connection: P2PConnection = {
        agentId,
        ws,
        connectedAt: new Date(),
      };

      this.connections.set(agentId, connection);
      this.logger.info(`P2P connection from ${agentId}`);

      ws.on("message", (data) => {
        try {
          const message = JSON.parse(data.toString()) as FederationMessage;
          this.handleMessage(agentId, message);
        } catch (e) {
          this.logger.warn(`Invalid message from ${agentId}`);
        }
      });

      ws.on("close", () => {
        this.connections.delete(agentId);
        this.logger.info(`P2P connection closed: ${agentId}`);
      });

      ws.on("error", (error) => {
        this.logger.error(`P2P error from ${agentId}: ${error.message}`);
      });
    });
  }

  /**
   * Connect to a peer
   */
  async connect(agentId: string, endpoint: string): Promise<boolean> {
    return new Promise((resolve) => {
      const ws = new WebSocket(endpoint);

      ws.on("open", () => {
        const connection: P2PConnection = {
          agentId,
          ws,
          connectedAt: new Date(),
        };
        this.connections.set(agentId, connection);
        this.logger.info(`Connected to peer ${agentId}`);
        resolve(true);
      });

      ws.on("error", () => {
        resolve(false);
      });
    });
  }

  /**
   * Send message to a peer
   */
  async sendMessage(agentId: string, message: FederationMessage): Promise<boolean> {
    const connection = this.connections.get(agentId);
    if (!connection || connection.ws.readyState !== WebSocket.OPEN) {
      return false;
    }

    try {
      connection.ws.send(JSON.stringify(message));
      this.logger.info(`Sent P2P message ${message.id} to ${agentId}`);
      return true;
    } catch (e) {
      this.logger.error(
        `Failed to send to ${agentId}: ${e instanceof Error ? e.message : "Unknown error"}`,
      );
      return false;
    }
  }

  /**
   * Handle incoming message (override in subclass)
   */
  protected handleMessage(fromAgentId: string, message: FederationMessage): void {
    this.logger.debug(`Received message ${message.id} from ${fromAgentId}`);
  }

  /**
   * Close connection to a peer
   */
  disconnect(agentId: string): void {
    const connection = this.connections.get(agentId);
    if (connection) {
      connection.ws.close();
      this.connections.delete(agentId);
    }
  }

  /**
   * Close all connections and server
   */
  close(): void {
    for (const connection of this.connections.values()) {
      connection.ws.close();
    }
    this.connections.clear();

    if (this.server) {
      this.server.close();
    }
  }
}
