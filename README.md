# Confluence MCP Server

## Overview

Confluenceの記事を検索・取得するためのMCPサーバーです。

このプロジェクトは Vibes Coding したプロジェクトなので、コードの品質はあまり高くない可能性があります。

A MCP server for searching and fetching articles from Confluence.

This project was developed with Vibes Coding, so the code quality may not be very high.

## セットアップ

1. MCPの設定ファイルに以下を追加してください：
   (`~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`)

```json
{
  "mcpServers": {
    "confluence": {
      "command": "node",
      "args": ["/path/to/confluence-mcp/dist/index.js"],
      "env": {
        "CONFLUENCE_BASE_URL": "ConfluenceのベースURL",
        "CONFLUENCE_USERNAME": "ユーザー名",
        "CONFLUENCE_API_TOKEN": "APIトークン"
      }
    }
  }
}
```

## 使用可能なツール

### publish_markdown

Markdownファイルを読み込み、Confluenceページとして公開します。

```typescript
{
  "markdownPath": string;  // Markdownファイルのパス
  "title": string;        // ページのタイトル
  "spaceKey": string;     // 作成先のスペースキー
  "parentId"?: string;    // 親ページのID（オプション）
}
```

### sync_markdown

既存のConfluenceページをMarkdownファイルの内容で更新します。

```typescript
{
  "markdownPath": string;  // Markdownファイルのパス
  "pageId": string;       // 更新対象のページID
}
```

### search_content

Confluenceの記事を検索します。

```typescript
{
  "query": string;       // 検索キーワードまたはCQLクエリ
  "limit"?: number;      // 取得する結果の最大数（オプション）
  "cql"?: boolean;       // クエリをCQLとして扱うかどうか（オプション）
  "outputPath"?: string  // 検索結果を保存するディレクトリパス（オプション）
}
```

### fetch_latest_articles

指定したトピックに関する記事を検索し、Markdown形式で保存します。

```typescript
{
  "query": string;       // 検索キーワードまたはCQLクエリ
  "limit"?: number;      // 取得する結果の最大数（オプション）
  "cql"?: boolean;       // クエリをCQLとして扱うかどうか（オプション）
  "outputPath": string   // 記事を保存するディレクトリパス（必須）
}
```

## 使用例

1. ページの作成：
```typescript
await mcpTool.use("confluence", "publish_markdown", {
  markdownPath: "path/to/document.md",
  title: "My New Page",
  spaceKey: "TEAM"
});
```

2. 既存ページの更新：
```typescript
await mcpTool.use("confluence", "sync_markdown", {
  markdownPath: "path/to/document.md",
  pageId: "123456789"
});
```

3. キーワードで記事を検索：
```typescript
await mcpTool.use("confluence", "search_content", {
  query: "text ~ \"keyword\" AND type = page",
  cql: true,
  limit: 10
});
```

4. 検索結果をファイルに保存：
```typescript
await mcpTool.use("confluence", "fetch_latest_articles", {
  query: "text ~ \"keyword\" AND type = page",
  outputPath: "/path/to/output/directory"
});
```

## 環境変数

- `CONFLUENCE_BASE_URL`: ConfluenceのベースURL（例：`https://your-domain.atlassian.net`）
- `CONFLUENCE_USERNAME`: Confluenceのユーザー名（通常はメールアドレス）
- `CONFLUENCE_API_TOKEN`: Confluenceのアクセストークン
