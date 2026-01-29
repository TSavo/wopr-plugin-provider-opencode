# wopr-plugin-provider-opencode

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![WOPR](https://img.shields.io/badge/WOPR-Plugin-blue)](https://github.com/TSavo/wopr)

OpenCode AI provider plugin for [WOPR](https://github.com/TSavo/wopr).

> Part of the [WOPR](https://github.com/TSavo/wopr) ecosystem - Self-sovereign AI session management over P2P.

## Installation

```bash
wopr plugin install wopr-plugin-provider-opencode
```

## Prerequisites

OpenCode requires the OpenCode server to be running. Install OpenCode:

```bash
npm install -g @opencode-ai/cli
```

Start the OpenCode server:

```bash
opencode server
```

Or let the SDK start it automatically.

## Configuration

Set the OpenCode server URL (default: http://localhost:4096):

```bash
wopr providers add opencode http://localhost:4096
```

## Usage

Create a session with OpenCode provider:

```bash
wopr session create my-session --provider opencode
```

Or set provider on existing session:

```bash
wopr session set-provider my-session opencode
```

## Supported Models

- `claude-3-5-sonnet` (default)
- `claude-3-5-haiku`
- `gpt-4o`
- `gpt-4o-mini`

## Development

```bash
npm install
npm run build
```

## About OpenCode

OpenCode is an open-source AI coding assistant.
Learn more: https://opencode.ai
