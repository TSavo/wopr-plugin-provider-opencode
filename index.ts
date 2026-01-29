/**
 * WOPR Plugin: OpenCode Provider
 *
 * Provides OpenCode AI access via the OpenCode SDK.
 * Supports A2A tools via MCP server configuration.
 * Install: wopr plugin install wopr-plugin-provider-opencode
 */

import winston from "winston";

// Type definitions (peer dependency from wopr)
interface A2AToolResult {
  content: Array<{
    type: "text" | "image" | "resource";
    text?: string;
    data?: string;
    mimeType?: string;
  }>;
  isError?: boolean;
}

interface A2AToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<A2AToolResult>;
}

interface A2AServerConfig {
  name: string;
  version?: string;
  tools: A2AToolDefinition[];
}

interface ModelQueryOptions {
  prompt: string;
  systemPrompt?: string;
  resume?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  images?: string[];
  tools?: string[];
  a2aServers?: Record<string, A2AServerConfig>;
  allowedTools?: string[];
  providerOptions?: Record<string, unknown>;
}

interface ModelClient {
  query(options: ModelQueryOptions): AsyncGenerator<unknown>;
  listModels(): Promise<string[]>;
  healthCheck(): Promise<boolean>;
}

interface ModelProvider {
  id: string;
  name: string;
  description: string;
  defaultModel: string;
  supportedModels: string[];
  validateCredentials(credentials: string): Promise<boolean>;
  createClient(credential: string, options?: Record<string, unknown>): Promise<ModelClient>;
  getCredentialType(): "api-key" | "oauth" | "custom";
}

interface ConfigField {
  name: string;
  type: string;
  label: string;
  placeholder?: string;
  required?: boolean;
  description?: string;
  options?: Array<{ value: string; label: string }>;
  default?: unknown;
}

interface ConfigSchema {
  title: string;
  description: string;
  fields: ConfigField[];
}

interface WOPRPluginContext {
  log: { info: (msg: string) => void };
  registerProvider: (provider: ModelProvider) => void;
  registerConfigSchema: (name: string, schema: ConfigSchema) => void;
}

interface WOPRPlugin {
  name: string;
  version: string;
  description: string;
  init(ctx: WOPRPluginContext): Promise<void>;
  shutdown(): Promise<void>;
}

// Setup winston logger
const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: "wopr-plugin-provider-opencode" },
  transports: [
    new winston.transports.Console({ level: "warn" })
  ],
});

let OpencodeSDK: any;

/**
 * Lazy load OpenCode SDK
 */
async function loadOpencodeSDK() {
  if (!OpencodeSDK) {
    try {
      const opencode = await import("@opencode-ai/sdk");
      OpencodeSDK = opencode;
    } catch (error) {
      throw new Error(
        "OpenCode SDK not installed. Run: npm install @opencode-ai/sdk"
      );
    }
  }
  return OpencodeSDK;
}

/**
 * OpenCode provider implementation
 */
const opencodeProvider: ModelProvider = {
  id: "opencode",
  name: "OpenCode",
  description: "OpenCode AI SDK with A2A/MCP support",
  defaultModel: "claude-3-5-sonnet",
  supportedModels: [
    "claude-3-5-sonnet",
    "claude-3-5-haiku",
    "gpt-4o",
    "gpt-4o-mini",
  ],

  async validateCredentials(credential: string): Promise<boolean> {
    try {
      const opencode = await loadOpencodeSDK();
      const client = opencode.createOpencodeClient({
        baseUrl: credential || "http://localhost:4096",
      });
      const health = await client.global.health();
      return health.data?.healthy === true;
    } catch (error) {
      logger.error("[opencode] Credential validation failed:", error);
      return true; // Allow anyway, server might not be running yet
    }
  },

  async createClient(
    credential: string,
    options?: Record<string, unknown>
  ): Promise<ModelClient> {
    return new OpencodeClient(credential, options);
  },

  getCredentialType(): "api-key" | "oauth" | "custom" {
    return "custom";
  },
};

/**
 * OpenCode client implementation with A2A support
 */
class OpencodeClient implements ModelClient {
  private client: any;
  private sessionId: string | null = null;

  constructor(
    private credential: string,
    private options?: Record<string, unknown>
  ) {}

  private async getClient() {
    if (!this.client) {
      const opencode = await loadOpencodeSDK();
      this.client = opencode.createOpencodeClient({
        baseUrl: this.credential || "http://localhost:4096",
        ...this.options,
      });
    }
    return this.client;
  }

  async *query(opts: ModelQueryOptions): AsyncGenerator<unknown> {
    const client = await this.getClient();

    try {
      if (!this.sessionId) {
        const session = await client.session.create({
          body: {
            title: `WOPR Session ${Date.now()}`,
          },
        });
        this.sessionId = session.data?.id;
        logger.info(`[opencode] Session created: ${this.sessionId}`);
      }

      if (!this.sessionId) {
        throw new Error("Failed to create OpenCode session");
      }

      // Yield session ID for resumption support
      yield { type: "system", subtype: "init", session_id: this.sessionId };

      let promptText = opts.prompt;
      if (opts.images && opts.images.length > 0) {
        const imageList = opts.images.map((url, i) => `[Image ${i + 1}]: ${url}`).join('\n');
        promptText = `[User has shared ${opts.images.length} image(s)]\n${imageList}\n\n${opts.prompt}`;
      }

      const parts: any[] = [{ type: "text", text: promptText }];

      // Build prompt options
      const promptOptions: any = {
        model: opts.model
          ? { providerID: "anthropic", modelID: opts.model }
          : { providerID: "anthropic", modelID: opencodeProvider.defaultModel },
        parts,
      };

      // A2A tools - pass as custom tools if supported
      if (opts.a2aServers && Object.keys(opts.a2aServers).length > 0) {
        const allTools: string[] = [];
        for (const [serverName, config] of Object.entries(opts.a2aServers)) {
          for (const tool of config.tools) {
            allTools.push(`mcp__${serverName}__${tool.name}`);
          }
        }
        promptOptions.enabledTools = allTools;
        logger.info(`[opencode] A2A tools configured: ${allTools.join(", ")}`);
      }

      // Allowed tools
      if (opts.allowedTools && opts.allowedTools.length > 0) {
        promptOptions.enabledTools = [
          ...(promptOptions.enabledTools || []),
          ...opts.allowedTools
        ];
        logger.info(`[opencode] Allowed tools: ${opts.allowedTools.join(", ")}`);
      }

      const result = await client.session.prompt({
        path: { id: this.sessionId },
        body: promptOptions,
      });

      if (result.data) {
        const resultParts = result.data.parts || [];

        for (const part of resultParts) {
          if (part.type === "text") {
            yield {
              type: "assistant",
              message: {
                content: [{ type: "text", text: part.text }],
              },
            };
          } else if (part.type === "tool_use" || part.type === "tool_call") {
            yield {
              type: "assistant",
              message: {
                content: [{ type: "tool_use", name: part.name }],
              },
            };
          }
        }

        yield {
          type: "result",
          subtype: "success",
          total_cost_usd: 0,
        };
      }
    } catch (error) {
      logger.error("[opencode] Query failed:", error);
      throw new Error(
        `OpenCode query failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async listModels(): Promise<string[]> {
    return opencodeProvider.supportedModels;
  }

  async healthCheck(): Promise<boolean> {
    try {
      const client = await this.getClient();
      const health = await client.global.health();
      return health.data?.healthy === true;
    } catch (error) {
      logger.error("[opencode] Health check failed:", error);
      return false;
    }
  }
}

/**
 * Plugin export
 */
const plugin: WOPRPlugin = {
  name: "provider-opencode",
  version: "1.1.0", // Bumped for A2A support
  description: "OpenCode AI provider for WOPR with A2A/MCP support",

  async init(ctx: WOPRPluginContext) {
    ctx.log.info("Registering OpenCode provider...");
    ctx.registerProvider(opencodeProvider);
    ctx.log.info("OpenCode provider registered (supports A2A/MCP)");

    // Register config schema for UI
    ctx.registerConfigSchema("provider-opencode", {
      title: "OpenCode",
      description: "Configure OpenCode server connection",
      fields: [
        {
          name: "serverUrl",
          type: "text",
          label: "Server URL",
          placeholder: "http://localhost:4096",
          default: "http://localhost:4096",
          required: true,
          description: "OpenCode server URL (must be running)",
        },
        {
          name: "model",
          type: "select",
          label: "Default Model",
          options: [
            { value: "claude-3-5-sonnet", label: "Claude 3.5 Sonnet" },
            { value: "claude-3-5-haiku", label: "Claude 3.5 Haiku" },
            { value: "gpt-4o", label: "GPT-4o" },
            { value: "gpt-4o-mini", label: "GPT-4o Mini" },
          ],
          default: "claude-3-5-sonnet",
          description: "Default model to use for new sessions",
        },
      ],
    });
    ctx.log.info("Registered OpenCode config schema");
  },

  async shutdown() {
    logger.info("[provider-opencode] Shutting down");
  },
};

export default plugin;
