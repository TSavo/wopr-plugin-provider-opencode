/**
 * WOPR Plugin: OpenCode Provider
 * 
 * Provides OpenCode AI access via the OpenCode SDK.
 * Install: wopr plugin install wopr-plugin-provider-opencode
 */

import type { ModelProvider, ModelClient, ModelQueryOptions } from "wopr/dist/types/provider.js";
import type { WOPRPlugin, WOPRPluginContext } from "wopr/dist/types.js";

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
  description: "OpenCode AI SDK for coding tasks (image URLs passed in prompt)",
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
 * OpenCode client implementation
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

  async *query(opts: ModelQueryOptions): AsyncGenerator<any> {
    const client = await this.getClient();

    try {
      if (!this.sessionId) {
        const session = await client.session.create({
          body: { 
            title: `WOPR Session ${Date.now()}`,
          },
        });
        this.sessionId = session.data?.id;
      }

      if (!this.sessionId) {
        throw new Error("Failed to create OpenCode session");
      }

      let promptText = opts.prompt;
      if (opts.images && opts.images.length > 0) {
        const imageList = opts.images.map((url, i) => `[Image ${i + 1}]: ${url}`).join('\n');
        promptText = `[User has shared ${opts.images.length} image(s)]\n${imageList}\n\n${opts.prompt}`;
      }

      const parts: any[] = [{ type: "text", text: promptText }];

      const result = await client.session.prompt({
        path: { id: this.sessionId },
        body: {
          model: opts.model 
            ? { providerID: "anthropic", modelID: opts.model }
            : { providerID: "anthropic", modelID: opencodeProvider.defaultModel },
          parts,
        },
      });

      if (result.data) {
        const parts = result.data.parts || [];
        
        for (const part of parts) {
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
    } catch {
      return false;
    }
  }
}

/**
 * Plugin export
 */
const plugin: WOPRPlugin = {
  name: "provider-opencode",
  version: "1.0.0",
  description: "OpenCode AI provider for WOPR",

  async init(ctx: WOPRPluginContext) {
    ctx.log.info("Registering OpenCode provider...");
    ctx.registerProvider(opencodeProvider);
    ctx.log.info("OpenCode provider registered");

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
    console.log("[provider-opencode] Shutting down");
  },
};

export default plugin;
