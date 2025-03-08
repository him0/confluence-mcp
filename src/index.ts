import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import axios from "axios";
import { marked } from "marked";
import fs from "fs/promises";

interface ConfluenceConfig {
  baseUrl: string;
  username: string;
  apiToken: string;
}

interface CreatePageOptions {
  title: string;
  content: string;
  spaceKey: string;
  parentId?: string;
}

class ConfluencePublisher {
  private config: ConfluenceConfig;
  protected axiosInstance;

  constructor(config: ConfluenceConfig) {
    this.config = config;
    this.axiosInstance = axios.create({
      baseURL: `${config.baseUrl}/wiki/rest/api`,
      auth: {
        username: config.username,
        password: config.apiToken,
      },
      headers: {
        "Content-Type": "application/json",
      },
    });
  }

  async createPage(options: CreatePageOptions): Promise<any> {
    return this.createOrUpdatePage(options);
  }

  async getPage(pageId: string): Promise<any> {
    try {
      const response = await this.axiosInstance.get(
        `/content/${pageId}?expand=version,title`
      );
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(
          `Confluence API error: ${error.response?.data?.message || error.message}`
        );
      }
      throw error;
    }
  }

  async updatePage(pageId: string, title: string, content: string): Promise<any> {
    return this.createOrUpdatePage({
      title,
      content,
      pageId,
      spaceKey: "",  // 更新時は不要
    });
  }

  async searchContent(
    query: string,
    limit: number = 10,
    useCql: boolean = true,
    expand: string = "body.storage,version,space"
  ): Promise<any> {
    try {
      const params: Record<string, string | number> = {
        limit,
        expand,
        cql: useCql ? query : `text ~ "${query}"`,
      };

      const response = await this.axiosInstance.get("/content/search", {
        params,
      });
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(
          `Confluence API error: ${error.response?.data?.message || error.message}`
        );
      }
      throw error;
    }
  }

  async getPageContent(pageId: string): Promise<any> {
    try {
      const response = await this.axiosInstance.get(
        `/content/${pageId}?expand=body.storage,version`
      );
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(
          `Confluence API error: ${error.response?.data?.message || error.message}`
        );
      }
      throw error;
    }
  }

  private async createOrUpdatePage(
    options: CreatePageOptions & { pageId?: string }
  ): Promise<any> {
    try {
      if (options.pageId) {
        // Get current version
        const current = await this.axiosInstance.get(`/content/${options.pageId}`);
        const version = current.data.version.number;

        // Update existing page
        const body = {
          type: "page",
          title: options.title,
          version: { number: version + 1 },
          body: {
            storage: {
              value: options.content,
              representation: "storage",
            },
          },
        };
        const response = await this.axiosInstance.put(
          `/content/${options.pageId}`,
          body
        );
        return response.data;
      } else {
        // Create new page
        const body = {
          type: "page",
          title: options.title,
          space: { key: options.spaceKey },
          body: {
            storage: {
              value: options.content,
              representation: "storage",
            },
          },
          ...(options.parentId && { ancestors: [{ id: options.parentId }] }),
        };
        const response = await this.axiosInstance.post("/content", body);
        return response.data;
      }
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(
          `Confluence API error: ${error.response?.data?.message || error.message}`
        );
      }
      throw error;
    }
  }
}

class ConfluencePublisherServer {
  private server: Server;
  private publisher?: ConfluencePublisher;

  constructor() {
    this.server = new Server(
      {
        name: "confluence-publisher",
        version: "0.1.0",
      },
      {
        capabilities: {
          resources: {},
          tools: {},
        },
      }
    );

    this.setupToolHandlers();
    this.server.onerror = (error) => console.error("[MCP Error]", error);
    process.on("SIGINT", async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: "publish_markdown",
          description: "Convert and publish Markdown content to Confluence",
          inputSchema: {
            type: "object",
            properties: {
              markdownPath: {
                type: "string",
                description: "Path to the Markdown file",
              },
              title: {
                type: "string",
                description: "Title for the Confluence page",
              },
              spaceKey: {
                type: "string",
                description: "Space key to create the page in",
              },
              parentId: {
                type: "string",
                description: "Parent page ID (optional)",
              },
            },
            required: ["markdownPath", "title", "spaceKey"],
          },
        },
        {
          name: "sync_markdown",
          description:
            "Sync changes in a Markdown file to an existing Confluence page",
          inputSchema: {
            type: "object",
            properties: {
              markdownPath: {
                type: "string",
                description: "Path to the Markdown file",
              },
              pageId: {
                type: "string",
                description: "Confluence page ID to update",
              },
            },
            required: ["markdownPath", "pageId"],
          },
        },
        {
          name: "search_content",
          description: "Search Confluence content",
          inputSchema: {
            type: "object",
            properties: {
              query: {
                type: "string",
                description: "Search keyword or CQL query",
              },
              limit: {
                type: "number",
                description: "Maximum number of results to return (optional)",
              },
              cql: {
                type: "boolean",
                description: "Whether to treat the query as CQL (optional)",
              },
              outputPath: {
                type: "string",
                description:
                  "Directory path to save the search results (optional)",
              },
            },
            required: ["query"],
          },
        },
        {
          name: "fetch_latest_articles",
          description: "Fetch and save latest articles about specified topic",
          inputSchema: {
            type: "object",
            properties: {
              query: {
                type: "string",
                description: "Search keyword or CQL query",
              },
              limit: {
                type: "number",
                description: "Maximum number of results to return (optional)",
              },
              cql: {
                type: "boolean",
                description: "Whether to treat the query as CQL (optional)",
              },
              outputPath: {
                type: "string",
                description:
                  "Directory path to save the search results (required)",
              },
            },
            required: ["query", "outputPath"],
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      switch (request.params.name) {
        case "publish_markdown": {
          const { markdownPath, title, spaceKey, parentId } = request.params
            .arguments as {
            markdownPath: string;
            title: string;
            spaceKey: string;
            parentId?: string;
          };

          try {
            await this.ensurePublisher();

            // Read and convert markdown
            const markdown = await fs.readFile(markdownPath, "utf-8");
            const html = await marked(markdown);

            // Create page in Confluence
            const result = await this.publisher!.createPage({
              title,
              content: html,
              spaceKey,
              parentId,
            });

            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    {
                      status: "success",
                      pageId: result.id,
                      title: result.title,
                      url: `${process.env.CONFLUENCE_BASE_URL}/wiki/spaces/${spaceKey}/pages/${result.id}`,
                    },
                    null,
                    2
                  ),
                },
              ],
            };
          } catch (error) {
            const errorMessage =
              error instanceof Error ? error.message : "Unknown error occurred";
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    {
                      status: "error",
                      error: errorMessage,
                    },
                    null,
                    2
                  ),
                },
              ],
              isError: true,
            };
          }
        }

        case "sync_markdown": {
          const { markdownPath, pageId } = request.params.arguments as {
            markdownPath: string;
            pageId: string;
          };

          try {
            await this.ensurePublisher();

            // Read and convert markdown
            const markdown = await fs.readFile(markdownPath, "utf-8");
            const html = await marked(markdown);

            // Get current page info and update
            const current = await this.publisher!.getPage(pageId);
            const result = await this.publisher!.updatePage(
              pageId,
              current.title,
              html
            );

            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    {
                      status: "success",
                      pageId: result.id,
                      title: result.title,
                      version: result.version.number,
                      url: `${process.env.CONFLUENCE_BASE_URL}/wiki/spaces/${current.space.key}/pages/${result.id}`,
                    },
                    null,
                    2
                  ),
                },
              ],
            };
          } catch (error) {
            const errorMessage =
              error instanceof Error ? error.message : "Unknown error occurred";
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    {
                      status: "error",
                      error: errorMessage,
                    },
                    null,
                    2
                  ),
                },
              ],
              isError: true,
            };
          }
        }

        case "search_content": {
          const { query, limit, cql, outputPath } = request.params
            .arguments as {
            query: string;
            limit?: number;
            cql?: boolean;
            outputPath?: string;
          };

          try {
            await this.ensurePublisher();

            // Search content
            const result = await this.publisher!.searchContent(
              query,
              limit,
              cql
            );

            if (outputPath && result.results.length > 0) {
              for (const page of result.results) {
                const content = await this.publisher!.getPageContent(page.id);
                const markdown = `---
title: ${content.title}
spaceKey: ${page.space.key}
pageId: ${page.id}
version: ${content.version.number}
url: ${process.env.CONFLUENCE_BASE_URL}/wiki/spaces/${page.space.key}/pages/${page.id}
---

${content.body.storage.value}
`;
                await fs.writeFile(
                  `${outputPath}/${page.id}.md`,
                  markdown,
                  "utf-8"
                );
              }
            }

            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    {
                      status: "success",
                      results: result.results.map((page: any) => ({
                        id: page.id,
                        title: page.title,
                        version: page.version.number,
                        space: page.space.key,
                        url: `${process.env.CONFLUENCE_BASE_URL}/wiki/spaces/${page.space.key}/pages/${page.id}`,
                      })),
                    },
                    null,
                    2
                  ),
                },
              ],
            };
          } catch (error) {
            const errorMessage =
              error instanceof Error ? error.message : "Unknown error occurred";
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    {
                      status: "error",
                      error: errorMessage,
                    },
                    null,
                    2
                  ),
                },
              ],
              isError: true,
            };
          }
        }

        case "fetch_latest_articles": {
          try {
            await this.ensurePublisher();

            const { query, limit, outputPath } = request.params.arguments as {
              query: string;
              limit?: number;
              outputPath?: string;
            };

            // Search for articles
            const result = await this.publisher!.searchContent(
              query,
              limit || 10
            );

            const articles = [];
            for (const page of result.results) {
              const content = await this.publisher!.getPageContent(page.id);
              const markdown = `---
title: ${content.title}
spaceKey: ${page.space.key}
pageId: ${page.id}
version: ${content.version.number}
url: ${process.env.CONFLUENCE_BASE_URL}/wiki/spaces/${page.space.key}/pages/${page.id}
---

${content.body.storage.value}
`;
              const filename = `${outputPath}/${page.id}.md`;
              await fs.writeFile(filename, markdown, "utf-8");
              articles.push({
                id: page.id,
                title: content.title,
                filename,
              });
            }

            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    {
                      status: "success",
                      message: `${articles.length} articles have been saved`,
                      articles,
                    },
                    null,
                    2
                  ),
                },
              ],
            };
          } catch (error) {
            const errorMessage =
              error instanceof Error ? error.message : "Unknown error occurred";
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    {
                      status: "error",
                      error: errorMessage,
                    },
                    null,
                    2
                  ),
                },
              ],
              isError: true,
            };
          }
        }

        default:
          throw new McpError(
            ErrorCode.MethodNotFound,
            `Unknown tool: ${request.params.name}`
          );
      }
    });
  }

  private async ensurePublisher() {
    if (!this.publisher) {
      const config: ConfluenceConfig = {
        baseUrl: process.env.CONFLUENCE_BASE_URL || "",
        username: process.env.CONFLUENCE_USERNAME || "",
        apiToken: process.env.CONFLUENCE_API_TOKEN || "",
      };

      if (
        !config.baseUrl ||
        !config.username ||
        !config.apiToken
      ) {
        throw new Error("Missing required Confluence configuration");
      }

      this.publisher = new ConfluencePublisher(config);
    }
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("Confluence Publisher MCP server running on stdio");
  }
}

const server = new ConfluencePublisherServer();
server.run().catch(console.error);
