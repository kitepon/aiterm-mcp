---
title: "OpenAI: Codexの認証保存先とログイン共有"
source_url: "https://developers.openai.com/codex/auth/"
source_type: official_docs
fetched: 2026-09-13
topic: completion-detection
tags: ["codex", "auth", "keyring"]
summary: "OpenAI一次資料。認証情報の保存先file/keyring/auto/ephemeral、共有ログイン、ファイル中のトークンの取扱いを説明する。"
relevance: "保存先変更は明示的な認証設計であり、改造版による既存Keychainの読出しを隠す自動移送として扱わない。"
chars: 45092
---

For the complete documentation index, see [llms.txt](/llms.txt). Markdown versions of documentation pages are available by appending
`.md` to the page URL.

[![OpenAI Developers](/OpenAI_Developers.svg)   ChatGPT](/)

[Home](/)

[API](/api/docs)

[Codex](https://learn.chatgpt.com/docs)

[Docs

Guides, concepts, and product docs for Codex](https://learn.chatgpt.com/docs)[Use cases

Example workflows and tasks teams can take on with ChatGPT or Codex](https://learn.chatgpt.com/use-cases)

[Docs](/codex)

[Use cases](/codex/use-cases)

[Training](/training)

[Resources](/codex/resources)

[ChatGPT](/chatgpt)

[Plugins

Extend ChatGPT and Codex](/plugins)[Workspace Agents

Trigger published ChatGPT workspace agents](/workspace-agents)[Commerce

Build commerce flows in ChatGPT](/commerce)[Ads

Publish and measure ads in ChatGPT](/ads)

[Resources](/learn)

[Showcase

Demo apps to get inspired](/showcase)[Blog

Learnings and experiences from developers](/blog)[Cookbook

Notebook examples for building with OpenAI models](/cookbook)[Learn

Docs, videos, and demo apps for building with OpenAI](/learn)[Community

Programs, meetups, and support for builders](/community)

Start searching

[API Dashboard](https://platform.openai.com/login)

[Try ChatGPT](https://chatgpt.com/)

[Overview](/codex)  [Features](/codex/features)  [Configuration](/codex/configuration)  [Developers](/codex/developers)  [Security](/codex/security-administration)  [Administration](/codex/administration)  [Use Cases](/codex/use-cases)  [Resources](/codex/resources)

## Search the docs

Search docs

### Suggested

responses createreasoning\_effortrealtimeprompt caching

Primary navigation

API  Codex  ChatGPT  Docs  Use cases  Training  Resources  Resources

Search docs

### Suggested

responses createreasoning\_effortrealtimeprompt caching

Overview  Models  Agents  Tools  Audio & voice  Production  API reference

OverviewModelsAgentsToolsAudio & voiceProductionAPI referenceDocsOverview

* [Home](/api/docs)

### Get started

* [Quickstart](/api/docs/quickstart)
* [Using GPT-6 Astra](/api/docs/guides/latest-model)
* [Key concepts](/api/docs/concepts)

### Core concepts

* [Responses API](/api/docs/guides/migrate-to-responses)
* [Conversation state](/api/docs/guides/conversation-state)
* [Background mode](/api/docs/guides/background)
* [Streaming](/api/docs/guides/streaming-responses)
* [WebSocket mode](/api/docs/guides/websocket-mode)
* [Mid-turn steering](/api/docs/guides/steering)
* [Multi-agent](/api/docs/guides/responses-multi-agent)
* [Webhooks](/api/docs/guides/webhooks)
* [File inputs](/api/docs/guides/file-inputs)
* [Compaction](/api/docs/guides/compaction)
* [Counting tokens](/api/docs/guides/token-counting)

### SDKs and CLI

* [OpenAI SDK](/api/docs/libraries)
* [OpenAI CLI](/api/docs/libraries/openai-cli)

### Resources

* [Changelog](/api/docs/changelog)
* [Deprecations](/api/docs/deprecations)
* [Supported countries](/api/docs/supported-countries)
* [OpenAI Crawlers](/api/docs/bots)
* [Terms and policies](https://openai.com/policies)

### Legacy APIs

* Agent Builder
  + [Overview](/api/docs/guides/agent-builder)
  + [Migration guide](/api/docs/guides/agent-builder/migrate-from-agent-builder)
  + [Node reference](/api/docs/guides/node-reference)
  + [Safety in building agents](/api/docs/guides/agent-builder-safety)
* Evals
  + [Getting started](/api/docs/guides/evaluation-getting-started)
  + [Working with evals](/api/docs/guides/evals)
  + [Prompt optimizer](/api/docs/guides/prompt-optimizer)
  + [External models](/api/docs/guides/external-models)
  + [Best practices](/api/docs/guides/evaluation-best-practices)
  + [Graders](/api/docs/guides/graders)
* Fine-tuning
  + [Optimization cycle](/api/docs/guides/model-optimization)
  + [Supervised fine-tuning](/api/docs/guides/supervised-fine-tuning)
  + [Vision fine-tuning](/api/docs/guides/vision-fine-tuning)
  + [Direct preference optimization](/api/docs/guides/direct-preference-optimization)
  + [Reinforcement fine-tuning](/api/docs/guides/reinforcement-fine-tuning)
  + [RFT use cases](/api/docs/guides/rft-use-cases)
  + [Best practices](/api/docs/guides/fine-tuning-best-practices)
* Assistants API
  + [Migration guide](/api/docs/assistants/migration)

* [Model catalog](/api/docs/models)

### Choose a model

* [Pricing](/api/docs/pricing)
* [Model selection](/api/docs/guides/model-selection)

### Text and code

* [Text generation](/api/docs/guides/text)
* [Code generation](/api/docs/guides/code-generation)
* [Structured output](/api/docs/guides/structured-outputs)

### Prompting

* [Overview](/api/docs/guides/prompting)
* [Prompt engineering](/api/docs/guides/prompt-engineering)
* [Citation formatting](/api/docs/guides/citation-formatting)
* [Migration guide](/api/docs/guides/prompting/migrate-from-prompt-object)
* [Prompt generation](/api/docs/guides/prompt-generation)
* [Frontend prompting](/api/docs/guides/frontend-prompt)

### Reasoning

* [Reasoning models](/api/docs/guides/reasoning)
* [Reasoning best practices](/api/docs/guides/reasoning-best-practices)

### Images and video

* [Images and vision](/api/docs/guides/images-vision)
  + [Image input cost calculator](/api/docs/guides/image-cost-calculator)
* [Image generation](/api/docs/guides/image-generation)
  + [Overview](/api/docs/guides/image-generation)
  + [Image prompting](/api/docs/guides/image-prompting)
* [Video generation](/api/docs/guides/video-generation)

### Realtime and audio

* [Audio and speech](/api/docs/guides/audio)
* [Getting started](/api/docs/guides/realtime)
* [Voice agents](/api/docs/guides/voice-agents)

### Specialized models

* [Deep research](/api/docs/guides/deep-research)
* [Embeddings](/api/docs/guides/embeddings)
* [Moderation](/api/docs/guides/moderation)

* [Overview](/api/docs/guides/agents)

### Agents API

* [Overview](/api/docs/guides/agents-api/overview)
* [Quickstart](/api/docs/guides/agents-api/quickstart)
* [Architecture](/api/docs/guides/agents-api/architecture)
* [Configuring Agents](/api/docs/guides/agents-api/configuration)
* Sessions
  + [Run and continue sessions](/api/docs/guides/agents-api/sessions)
  + [Events and items](/api/docs/guides/agents-api/sessions/events)
  + [Manage sessions](/api/docs/guides/agents-api/sessions/manage)
  + [Webhooks](/api/docs/guides/agents-api/sessions/webhooks)
* Environments and sandboxes
  + [OpenAI-hosted sandboxes](/api/docs/guides/agents-api/environments/openai-hosted)
  + [Self-hosted sandboxes](/api/docs/guides/agents-api/environments/self-hosted)
  + [Sandbox lifecycle](/api/docs/guides/agents-api/environments/lifecycle)
  + [Sandbox security](/api/docs/guides/agents-api/environments/security)
  + [Files and artifacts](/api/docs/guides/agents-api/environments/files)
* Tools and integrations
  + [Web search](/api/docs/guides/agents-api/tools/web-search)
  + [Functions](/api/docs/guides/agents-api/tools/functions)
  + [MCP connections](/api/docs/guides/agents-api/tools/mcp)
  + [Plugins](/api/docs/guides/agents-api/tools/plugins)
  + [Vaults](/api/docs/guides/agents-api/tools/vaults)
* [Multi-agent](/api/docs/guides/agents-api/multi-agent)
* [Observability and usage](/api/docs/guides/agents-api/observability)
* [Tracing](/api/docs/guides/agents-api/tracing)

### Agents SDK

* [Overview](/api/docs/guides/agents/sdk)
* [Quickstart](/api/docs/guides/agents/quickstart)
* [Agent definitions](/api/docs/guides/agents/define-agents)
* [Models and providers](/api/docs/guides/agents/models)
* [Running agents](/api/docs/guides/agents/running-agents)
* [Sandbox agents](/api/docs/guides/agents/sandboxes)
* [Orchestration](/api/docs/guides/agents/orchestration)
* [Guardrails](/api/docs/guides/agents/guardrails-approvals)
* [Results and state](/api/docs/guides/agents/results)
* [Integrations and observability](/api/docs/guides/agents/integrations-observability)
* [Evaluate agent workflows](/api/docs/guides/agent-evals)

### ChatKit

* [Overview](/api/docs/guides/chatkit)
* [Customize](/api/docs/guides/chatkit-themes)
* [Widgets](/api/docs/guides/chatkit-widgets)
* [Actions](/api/docs/guides/chatkit-actions)
* [Advanced integrations](/api/docs/guides/custom-chatkit)

* [Overview](/api/docs/guides/tools)
* [Function calling](/api/docs/guides/function-calling)

### Search and retrieval

* [Web search](/api/docs/guides/tools-web-search)
* [File search](/api/docs/guides/tools-file-search)
* [Retrieval](/api/docs/guides/retrieval)

### Connect tools and data

* [MCP and Connectors](/api/docs/guides/tools-connectors-mcp)
* [Secure MCP Tunnel](/api/docs/guides/secure-mcp-tunnels)

### Build tool workflows

* [Skills](/api/docs/guides/tools-skills)
* [Tool search](/api/docs/guides/tools-tool-search)
* [Programmatic tool calling](/api/docs/guides/tools-programmatic-tool-calling)
* [Async tool calling](/api/docs/guides/async-tool-calling)

### Computer and code

* [Shell](/api/docs/guides/tools-shell)
* [Computer use](/api/docs/guides/tools-computer-use)
* [Apply Patch](/api/docs/guides/tools-apply-patch)
* [Local shell](/api/docs/guides/tools-local-shell)
* [Code interpreter](/api/docs/guides/tools-code-interpreter)

### Media

* [Image generation](/api/docs/guides/tools-image-generation)

* [Overview](/api/docs/guides/audio)

### GPT-Live

* [Getting started](/api/docs/guides/live)
* [Prompting](/api/docs/guides/live-prompting)
* [Managing sessions](/api/docs/guides/live-conversations)
* [Delegation and tools](/api/docs/guides/live-delegation)
* [Migrate to GPT-Live](/api/docs/guides/live-migration)
* [Partner integrations](/api/docs/guides/live-partner-integrations)

### Realtime API

* [Getting started](/api/docs/guides/realtime)
* [Prompting](/api/docs/guides/voice-prompting)
* [Managing conversations](/api/docs/guides/realtime-conversations)
* [Voice activity detection](/api/docs/guides/realtime-vad)
* [Tools and MCP](/api/docs/guides/realtime-mcp)

### Build with voice

* [Voice agents](/api/docs/guides/voice-agents)
* [Custom voices](/api/docs/guides/custom-voices)
* [Cost optimization](/api/docs/guides/voice-latency-cost)

### Connections

* [WebRTC](/api/docs/guides/voice-webrtc)
* [WebSockets](/api/docs/guides/voice-websockets)
* [Telephony and SIP](/api/docs/guides/voice-sip)
* [Server-side controls](/api/docs/guides/voice-server-controls)

### Audio processing

* [File transcription](/api/docs/guides/speech-to-text)
* [Live transcription](/api/docs/guides/realtime-transcription)
* [Live translation](/api/docs/guides/realtime-translation)
* [Text to speech](/api/docs/guides/text-to-speech)
* [Audio in Chat Completions](/api/docs/guides/audio-chat-completions)

### Go live

* [Production best practices](/api/docs/guides/production-best-practices)
* [Deployment checklist](/api/docs/guides/deployment-checklist)

### Performance and quality

* [Latency optimization](/api/docs/guides/latency-optimization)
* [Predicted Outputs](/api/docs/guides/predicted-outputs)
* [Fast mode](/api/docs/guides/fast-mode)
* [Accuracy optimization](/api/docs/guides/optimizing-llm-accuracy)

### Cost and throughput

* [Cost optimization](/api/docs/guides/cost-optimization)
* [Prompt caching](/api/docs/guides/prompt-caching)
  + [Prompt cache diagnostics](/api/docs/guides/prompt-caching/diagnostics)
* [Batch](/api/docs/guides/batch)
* [Flex processing](/api/docs/guides/flex-processing)

### Safety and governance

* [Safety best practices](/api/docs/guides/safety-best-practices)
* [Red teaming](/api/docs/guides/red-teaming)
* Safety checks
  + [Safety classifiers](/api/docs/guides/safety-checks)
  + [Cybersecurity checks](/api/docs/guides/safety-checks/cybersecurity)
  + [Misalignment monitoring](/api/docs/guides/safety-checks/misalignment-monitoring)
* [Under-18 guidance](/api/docs/guides/safety-checks/under-18-api-guidance)
* [CSAM guidance](/api/docs/guides/csam-guidance)
* [Content provenance](/api/docs/guides/content-provenance)
* [Your data](/api/docs/guides/your-data)
* [Permissions](/api/docs/guides/rbac)

### Infrastructure and access

* [Terraform provider](/api/docs/guides/terraform)
  + [Overview](/api/docs/guides/terraform)
  + [Projects and access](/api/docs/guides/terraform/projects-and-access)
  + [Service accounts](/api/docs/guides/terraform/service-accounts)
  + [Rate limits and spend](/api/docs/guides/terraform/rate-limits-and-spend)
  + [Model, tool, and data controls](/api/docs/guides/terraform/project-controls)
  + [Import and reconciliation](/api/docs/guides/terraform/import-and-reconcile)
* [Private Link](/api/docs/guides/private-link)
* [IP allowlist](/api/docs/guides/ip-allowlist)
* [Mutual TLS](/api/docs/guides/mutual-tls)
* [Workload identity federation](/api/docs/guides/workload-identity-federation)
  + [Codex setup](/codex/enterprise/workload-identity)
  + [Federation rules](/api/docs/guides/workload-identity-federation/federation-rules)
  + [Admin API](/api/docs/guides/workload-identity-federation/admin-api)
  + [X.509 certificates](/api/docs/guides/workload-identity-federation/x509)
  + [Kubernetes](/api/docs/guides/workload-identity-federation/kubernetes)
  + [AWS](/api/docs/guides/workload-identity-federation/aws)
  + [Microsoft Azure](/api/docs/guides/workload-identity-federation/microsoft-azure)
  + [Google Cloud](/api/docs/guides/workload-identity-federation/google-cloud)
  + [Oracle Cloud Infrastructure](/api/docs/guides/workload-identity-federation/oracle-cloud)
  + [GitHub Actions](/api/docs/guides/workload-identity-federation/github-actions)
  + [SPIFFE](/api/docs/guides/workload-identity-federation/spiffe)
* [IP egress ranges](/api/docs/guides/ip-addresses)
* [Amazon Bedrock](/api/docs/guides/amazon-bedrock)

### Operations

* [Rate limits](/api/docs/guides/rate-limits)
* [Spend limits](/api/docs/guides/spend-limits)
* [Admin APIs](/api/docs/guides/admin-apis)
* [Error codes](/api/docs/guides/error-codes)

[Docs](https://learn.chatgpt.com/docs)  [Use cases](https://learn.chatgpt.com/use-cases)

DocsUse casesDocsDocs

Plugins  Workspace Agents  Commerce  Ads

PluginsWorkspace AgentsCommerceAdsDocsSelect...

* [Home](/plugins)
* [Quickstart](/plugins/quickstart)

### Core concepts

* [Plugin architecture](/plugins/concepts/plugins)
* [Skills](/plugins/concepts/skills)
* [MCP server](/plugins/concepts/mcp-server)

### Plan

* [Brainstorm use cases](/plugins/plan/use-case)
* [Define tools](/plugins/plan/tools)

### Build

* [Build an MCP server](/plugins/build/mcp-server)
* [Add UI to your MCP server (optional)](/plugins/build/chatgpt-ui)
* [Authenticate users](/plugins/build/auth)
* [Build skills](/plugins/build/skills)
* [Package your plugin](/plugins/build/plugins)
* [Examples](/plugins/build/examples)

### Test and publish

* [Connect and test your plugin](/plugins/deploy/connect-chatgpt)
* [Submit and publish](/plugins/deploy/submission)
* [Submission error reference](/plugins/deploy/submission-errors)

### Conversion specs

* [Restaurant reservation spec](/plugins/guides/restaurant-reservation-conversion-spec)
* [Get Quote spec](/plugins/guides/local-services-request-quote-conversion-spec)
* [Product checkout spec](/plugins/guides/product-checkout-conversion-spec)

### Guides

* [UI guidelines](/plugins/concepts/ui-guidelines)
* [Optimize Metadata](/plugins/guides/optimize-metadata)
* [Submit a Claude Code plugin](/plugins/guides/submit-claude-plugin)
* [Security & Privacy](/plugins/guides/security-privacy)
* [Troubleshooting](/plugins/deploy/troubleshooting)

### Resources

* [Changelog](/plugins/changelog)
* [Plugin guidelines](/plugins/app-guidelines)
* [MCP server review requirements](/plugins/deploy/app-review)
* [Plugin UI reference](/plugins/reference)
* [Checkout API reference](/plugins/build/monetization)

* [Home](/workspace-agents)

### Get started

* [Trigger workspace agent runs](/workspace-agents/trigger-runs)
* [Authenticate with Workspace Agent access tokens](/workspace-agents/authentication)

* [Home](/commerce)

### Guides

* [Get started](/commerce/guides/get-started)
* [Best practices](/commerce/guides/best-practices)

### File Upload

* [Overview](/commerce/specs/file-upload/overview)
* [Products](/commerce/specs/file-upload/products)

### API

* [Overview](/commerce/specs/api/overview)
* [Feeds](/commerce/specs/api/feeds)
* [Products](/commerce/specs/api/products)
* [Promotions](/commerce/specs/api/promotions)

* [Ads Overview](/ads)

### Measurement

* [Measurement Pixel](/ads/measurement-pixel)
* [Multiple Pixels (Advanced)](/ads/multiple-pixels)
* [Image Tag](/ads/image-tag)
* [Conversions API](/ads/conversions-api)
* [Supported Events](/ads/supported-events)

### Advertiser API

* [Overview](/ads/api-overview)
* [Campaign Management](/ads/campaign-management)
* [Bidding & Budgets](/ads/bidding-and-budgets)
* [Targeting](/ads/campaign-targeting)
* [Product Feeds](/ads/product-feeds)
* [Conversion Tracking](/ads/conversion-tracking)
* [Reporting](/ads/reporting)
* [Troubleshooting](/ads/troubleshooting)
* [Account Management](/ads/account-management)

### API Reference

* [Authentication](/ads/api-reference/authentication)
* [Ad Account](/ads/api-reference/ad-account)
* [Campaigns](/ads/api-reference/campaigns)
* [Ad Groups](/ads/api-reference/ad-groups)
* [Ads](/ads/api-reference/ads)
* [Insights](/ads/api-reference/insights)
* [Files](/ads/api-reference/files)
* [Conversion Setup](/ads/api-reference/conversion-setup)

Overview  Features  Configuration  Developers  Security  Administration  Use Cases  Resources

OverviewFeaturesConfigurationDevelopersSecurityAdministrationUse CasesResourcesDocsAdministration

* [Home](/codex)

### Get started

* [Quickstart](/codex/quickstart)
* [Use ChatGPT](/codex/use-chatgpt)
* [Get started with Work](/codex/get-started-with-work)
* [Import from another agent](/codex/import)

### Foundations

* [Prompting](/codex/prompting)
* [Personalize ChatGPT](/codex/personalize)
* [Skills & Plugins](/codex/skills-and-plugins)
* [Permissions](/codex/permission-modes)

### Explore

* [What's new](/codex/whats-new)
* [Models](/codex/models)
* [Pricing](/codex/pricing)
* [Glossary](/codex/glossary)

### Available on

* [ChatGPT desktop app](/codex/app)
* [Remote](/codex/remote)
* [ChatGPT on the web](/codex/web)
* [Codex CLI](/codex/cli)
* [Codex IDE extension](/codex/ide)
* [Codex cloud](/codex/cloud)

### Releases

* [Changelog](/codex/changelog)
* [Feature Maturity](/codex/feature-maturity)
* [Open Source](/codex/open-source)

* [Overview](/codex/features)

### Workflows

* [Projects and chats](/codex/projects)
* [Sites](/codex/sites)
* [Visualizations](/codex/visualizations)
* [Scheduled tasks](/codex/automations)
* [Long-running work](/codex/long-running-work)
* [Notifications](/codex/notifications)
* [Pets](/codex/pets)
* [Codex Micro](/codex/features/codex-micro)

### Capabilities

* [Browser](/codex/browser)
* [Computer use](/codex/computer-use)
* [Voice](/codex/features/voice)
* [Plugins](/codex/plugins)
* [Web search](/codex/web-search)
* [Image generation](/codex/image-generation)
* [Image inputs](/codex/image-inputs)
* [Appshots](/codex/appshots)
* [Browser extension](/codex/chrome-extension)
* [Work with files](/codex/artifacts-viewer)

### Reference

* [Commands](/codex/reference/commands)
* [Slash commands](/codex/reference/slash-commands)
* [Settings](/codex/reference/settings)
* [Troubleshooting](/codex/reference/troubleshooting)

* [Overview](/codex/configuration)

### Customization

* [Overview](/codex/customization/overview)
* [Memories](/codex/customization/memories)
* [Computer History](/codex/customization/computer-history)

### Config file

* [Config Basics](/codex/config-file/config-basic)
* [Advanced Config](/codex/config-file/config-advanced)
* [Config Reference](/codex/config-file/config-reference)
* [Environment Variables](/codex/config-file/environment-variables)
* [Sample Config](/codex/config-file/config-sample)

### Agent configuration

* [AGENTS.md](/codex/agent-configuration/agents-md)
* [Subagents](/codex/agent-configuration/subagents)
* [Speed](/codex/agent-configuration/speed)
* [Rules](/codex/agent-configuration/rules)

### Extend ChatGPT and Codex

* [Record & Replay](/codex/extend/record-and-replay)
* [MCP](/codex/extend/mcp)

### Linux

* [Desktop app](/codex/linux/linux-app)

### Windows

* [Desktop app](/codex/windows/windows-app)
* [Windows sandbox](/codex/windows/windows-sandbox)
* [WSL](/codex/windows/wsl)

* [Overview](/codex/developers)

### Development workflows

* [Code review](/codex/code-review)
* [Integrated terminal](/codex/integrated-terminal)

### Extend and automate

* [Build skills](/codex/build-skills)
* [Build plugins](/codex/build-plugins)
* [Site tools (WebMCP)](/codex/webmcp)
* [Hooks](/codex/hooks)

### Environments

* [Modes](/codex/environments/modes)
* [Local environments](/codex/environments/local-environment)
* [Cloud environment](/codex/environments/cloud-environment)
* [Git worktrees](/codex/environments/git-worktrees)

### Build with Codex

* [Codex SDK](/codex/codex-sdk)
* [App Server](/codex/app-server)
* [GitHub Action](/codex/github-action)
* [Non-interactive mode](/codex/non-interactive-mode)

### Third-party integrations

* [GitHub](/codex/third-party/github)
* [GitLab (Beta)](/codex/third-party/gitlab)
* [Slack](/codex/third-party/slack)
* [Linear](/codex/third-party/linear)

### Reference

* [CLI customization](/codex/cli-customization)
* [Developer commands](/codex/developer-commands)
* [Developer settings](/codex/developer-settings)

* [Overview](/codex/security-administration)

### Permissions

* [Profiles](/codex/permissions)
* [Sandboxing](/codex/sandboxing)
* [Auto-review](/codex/sandboxing/auto-review)
* [Agent approvals & security](/codex/agent-approvals-security)
* [Internet access](/codex/cloud/internet-access)

### Codex Security

* [Overview](/codex/security)
* Codex Security plugin
  + [Quickstart](/codex/security/plugin)
  + [Run a security scan](/codex/security/plugin/scans)
  + [Run a deep scan](/codex/security/plugin/deep-scans)
  + [Review code changes](/codex/security/plugin/code-changes)
  + [Use the Security workbench](/codex/security/plugin/workbench)
  + [Triage a backlog](/codex/security/plugin/triage-backlog)
  + [Fix findings](/codex/security/plugin/fix-findings)
  + [Propose security hardening](/codex/security/plugin/security-hardening)
  + [Write vulnerability reports](/codex/security/plugin/vulnerability-reports)
  + [Export and track findings](/codex/security/plugin/export-findings)
  + [Changelog](/codex/security/plugin/changelog)
* Codex Security CLI
  + [Quickstart](/codex/security/cli)
  + [Run bulk scans](/codex/security/cli/bulk-scans)
  + [Run scans in CI](/codex/security/cli/ci)
  + [GitLab CI/CD](/codex/security/cli/ci/gitlab)
  + [Reference](/codex/security/cli/reference)
  + [FAQ](/codex/security/cli/faq)
* [TypeScript SDK](/codex/security/sdk)
* Codex Security cloud
  + [Setup](/codex/security/setup)
  + [Security Review](/codex/security/security-review)
  + [Improving the threat model](/codex/security/threat-model)
  + [FAQ](/codex/security/faq)

### Cyber safety

* [Models & Trusted Access](/codex/cyber-safety)
* [Recommended configuration](/codex/cyber-safety/recommended-configuration)

* [Overview](/codex/administration)

### Getting started

* [Admin rollout guide](/codex/enterprise/admin-setup)

### ChatGPT Work

* [ChatGPT Work Overview](/codex/enterprise/chatgpt-work-overview)
* [ChatGPT Work cloud security](/codex/enterprise/chatgpt-work-cloud-security)
* [ChatGPT Work local security](/codex/enterprise/chatgpt-work-local-security)
* [ChatGPT Work admin FAQ](/codex/enterprise/work-admin-faq)
* [ChatGPT Work: usage and cost](/codex/enterprise/chatgpt-work-usage-and-cost)

### Identity and authentication

* [Authentication overview](/codex/auth)
* [Workload identity](/codex/enterprise/workload-identity)
* [Personal Access Tokens](/codex/enterprise/access-tokens)
* [Service accounts](/codex/enterprise/service-accounts)

### Workspace access, policy, and models

* [Groups and provisioning](/codex/enterprise/groups-and-provisioning)
* [User lifecycle management](/codex/enterprise/user-lifecycle)
* [Roles and workspace permissions](/codex/enterprise/roles-and-workspace-permissions)
* [GPTs and Sharing](/codex/enterprise/gpts-and-sharing)
* [Managed configuration](/codex/enterprise/managed-configuration)
* [Prisma AIRS](/codex/enterprise/prisma-airs)
* [HIPAA configuration](/codex/hipaa-configuration)
* [Workspace model availability](/codex/enterprise/workspace-model-availability)

### Plugin and connector controls

* [Plugin controls](/codex/enterprise/apps-and-connectors)
* [Plugin management](/codex/enterprise/plugin-management)
* [Skill controls](/codex/enterprise/skills)

### Usage, governance, and compliance

* [Governance](/codex/enterprise/governance)
* [Admin plugin](/codex/enterprise/admin-plugin)
* [Workspace analytics](/codex/enterprise/workspace-analytics)
* [Analytics API](/codex/enterprise/analytics-api)
* [Compliance API and audit events](/codex/enterprise/compliance-api)

### Deployment and model providers

* [Manage app updates](/codex/enterprise/manage-app-updates)
* [Windows app deployment](/codex/enterprise/windows-deployment)
* [Remote connections](/codex/remote-connections)
* [Amazon Bedrock](/codex/amazon-bedrock)

* [Explore use cases](/codex/use-cases)
* [Collections](/codex/use-cases/collections)

* [Home](/codex/resources)
* [Videos](/codex/videos)
* [Showcase](https://developers.openai.com/showcase)
* [OpenAI Academy](https://openai.com/academy/)
* [Online trainings](https://academy.openai.com/home/events)

### Community

* [Codex Ambassadors](https://developers.openai.com/community/codex-ambassadors)
* [Codex for Students](https://developers.openai.com/community/students)
* [Codex for Open Source](https://developers.openai.com/community/codex-for-oss)
* [Meetups](https://developers.openai.com/community/meetups)

### Blog

* [Company blog](https://openai.com/news/)
* [Developer blog](https://developers.openai.com/blog)

* [Explore use cases](/codex/use-cases)
* [Collections](/codex/use-cases/collections)

* [Home](/codex/resources)
* [Videos](/codex/videos)
* [Showcase](https://developers.openai.com/showcase)
* [OpenAI Academy](https://openai.com/academy/)
* [Online trainings](https://academy.openai.com/home/events)

### Community

* [Codex Ambassadors](https://developers.openai.com/community/codex-ambassadors)
* [Codex for Students](https://developers.openai.com/community/students)
* [Codex for Open Source](https://developers.openai.com/community/codex-for-oss)
* [Meetups](https://developers.openai.com/community/meetups)

### Blog

* [Company blog](https://openai.com/news/)
* [Developer blog](https://developers.openai.com/blog)

[Showcase](/showcase)  Blog  Cookbook  Learn  Community

ShowcaseBlogCookbookLearnCommunityDocsSelect...

* [All posts](/blog)

### Recent

* [Rethinking skills and prompts for GPT-6 Astra](/blog/rethinking-skills-and-prompts-for-gpt-6-astra)
* [Architectural visualization with Astra](/blog/architectural-visualization-with-astra)
* [Building games with Astra](/blog/how-to-build-games-with-astra)
* [Meet Rosalind Workbench: Empowering every scientist to be their own research team](/blog/rosalind-workbench)
* [Automating repetitive work at OpenAI with Codex](/blog/automating-repetitive-work-at-openai-with-codex)

### Topics

* [General](/blog/topic/general)
* [API](/blog/topic/api)
* [Apps SDK](/blog/topic/apps-sdk)
* [Audio](/blog/topic/audio)
* [Codex](/blog/topic/codex)
* [Life sciences](/blog/topic/life-sciences)

* [Home](/cookbook)

### Topics

* [Agents](/cookbook/topic/agents)
* [Evals](/cookbook/topic/evals)
* [Multimodal](/cookbook/topic/multimodal)
* [Text](/cookbook/topic/text)
* [Guardrails](/cookbook/topic/guardrails)
* [Optimization](/cookbook/topic/optimization)
* [ChatGPT](/cookbook/topic/chatgpt)
* [Codex](/cookbook/topic/codex)
* [gpt-oss](/cookbook/topic/gpt-oss)

### Contribute

* [Cookbook on GitHub](https://github.com/openai/openai-cookbook)

* [Home](/learn)
* [OpenAI Developers plugin](/learn/developers-codex-plugin)
* [Docs MCP](/learn/docs-mcp)

### Categories

* [Demo apps](/learn/code)
* [Videos](/learn/videos)

### Topics

* [Agents](/learn/agents)
* [Audio & Voice](/learn/audio)
* [Computer Use](/learn/cua)
* [Codex](/learn/codex)
* [Evals](/learn/evals)
* [gpt-oss](/learn/gpt-oss)
* [Fine-tuning](/learn/fine-tuning)
* [Image generation](/learn/imagegen)
* [Scaling](/learn/scaling)
* [Tools](/learn/tools)
* [Video generation](/learn/videogen)

* [Community](/community)

### Programs

* [Codex Ambassadors](/community/codex-ambassadors)
* [Codex for Students](/community/students)
* [Codex for Open Source](/community/codex-for-oss)
* [OpenAI for Startups](https://openai.com/business/why-openai/startups/)

### Events

* [Meetups](/community/meetups)

### Spaces

* [Developer Forum](https://community.openai.com/)
* [Discord](https://discord.com/invite/openai)
* [Reddit](https://www.reddit.com/r/OpenAI/)
* [X](https://x.com/OpenAIDevs)

[API Dashboard](https://platform.openai.com/login)

[Try ChatGPT](https://chatgpt.com/)

* [Overview](/codex/administration)

### Getting started

* [Admin rollout guide](/codex/enterprise/admin-setup)

### ChatGPT Work

* [ChatGPT Work Overview](/codex/enterprise/chatgpt-work-overview)
* [ChatGPT Work cloud security](/codex/enterprise/chatgpt-work-cloud-security)
* [ChatGPT Work local security](/codex/enterprise/chatgpt-work-local-security)
* [ChatGPT Work admin FAQ](/codex/enterprise/work-admin-faq)
* [ChatGPT Work: usage and cost](/codex/enterprise/chatgpt-work-usage-and-cost)

### Identity and authentication

* [Authentication overview](/codex/auth)
* [Workload identity](/codex/enterprise/workload-identity)
* [Personal Access Tokens](/codex/enterprise/access-tokens)
* [Service accounts](/codex/enterprise/service-accounts)

### Workspace access, policy, and models

* [Groups and provisioning](/codex/enterprise/groups-and-provisioning)
* [User lifecycle management](/codex/enterprise/user-lifecycle)
* [Roles and workspace permissions](/codex/enterprise/roles-and-workspace-permissions)
* [GPTs and Sharing](/codex/enterprise/gpts-and-sharing)
* [Managed configuration](/codex/enterprise/managed-configuration)
* [Prisma AIRS](/codex/enterprise/prisma-airs)
* [HIPAA configuration](/codex/hipaa-configuration)
* [Workspace model availability](/codex/enterprise/workspace-model-availability)

### Plugin and connector controls

* [Plugin controls](/codex/enterprise/apps-and-connectors)
* [Plugin management](/codex/enterprise/plugin-management)
* [Skill controls](/codex/enterprise/skills)

### Usage, governance, and compliance

* [Governance](/codex/enterprise/governance)
* [Admin plugin](/codex/enterprise/admin-plugin)
* [Workspace analytics](/codex/enterprise/workspace-analytics)
* [Analytics API](/codex/enterprise/analytics-api)
* [Compliance API and audit events](/codex/enterprise/compliance-api)

### Deployment and model providers

* [Manage app updates](/codex/enterprise/manage-app-updates)
* [Windows app deployment](/codex/enterprise/windows-deployment)
* [Remote connections](/codex/remote-connections)
* [Amazon Bedrock](/codex/amazon-bedrock)

![](/images/codex/surface-icons/chatgpt-app.webp)ChatGPT desktop app

Copy Page

# Authentication

Sign-in methods for ChatGPT web and Codex clients

![](/images/codex/surface-icons/chatgpt-app.webp)ChatGPT desktop app

Copy Page

## OpenAI authentication

Codex supports two ways for a person to sign in when using OpenAI models:

* Sign in with ChatGPT for subscription access
* Sign in with an API key for usage-based access

The ChatGPT desktop app, Codex CLI, and IDE extension support both sign-in
methods for local work. Codex cloud requires signing in with ChatGPT.

Your sign-in method also determines which admin controls and data-handling policies apply.

* When you sign in with ChatGPT, Codex usage follows your ChatGPT workspace
  permissions, role-based access control (RBAC), and ChatGPT Enterprise
  retention and residency settings.
* With an API key, usage follows your API organization's retention and
  data-sharing settings instead.

For managed workspaces, authentication is only one layer of access. Workspace
membership and provisioning determine who can sign in, while seats and
workspace roles determine which product surfaces and features they can use.
For local work in the ChatGPT desktop app, Codex CLI, or IDE extension,
permission profiles constrain what the agent can do on the device. See
[Groups and provisioning](/codex/enterprise/groups-and-provisioning)
and [Roles and workspace permissions](/codex/enterprise/roles-and-workspace-permissions)
to plan those controls.

### Sign in with ChatGPT

When you sign in with ChatGPT from the ChatGPT desktop app, Codex CLI, or IDE extension, the sign-in flow opens a browser window. After you sign in, the browser returns your credentials to Codex.

### ChatGPT web

Open [ChatGPT](https://chatgpt.com), sign in, and choose the workspace where you
want to work. ChatGPT web keeps the authenticated session in your browser.

#### ChatGPT desktop app

On the signed-out screen, select **Continue to sign in**, then complete the
browser flow.

#### Codex CLI

Run `codex login`, then complete the browser flow. This is the default
authentication path when no valid session is available.

#### IDE extension

On the signed-out screen, select **Sign in with ChatGPT**, then complete the
browser flow.

### Sign in with an API key

You can also sign in to the ChatGPT desktop app, Codex CLI, or IDE extension with an API key. Get your API key from the [OpenAI dashboard](https://platform.openai.com/api-keys).

#### ChatGPT desktop app

On the signed-out screen, select **Sign in another way**, enter your key, then
select **Continue**.

#### Codex CLI

Pipe the key to `codex login` through stdin:

```
printenv OPENAI_API_KEY | codex login --with-api-key
```

#### IDE extension

On the signed-out screen, select **Use API Key**, enter your key, then select
**OK**.

OpenAI bills API key usage through your OpenAI Platform account at standard API rates. See the [API pricing page](https://openai.com/api/pricing/).

API key authentication supports local Codex workflows, but some features that
rely on ChatGPT workspace access or cloud services are limited or unavailable.
Compare support by plan in
[Feature availability](/codex/pricing#feature-availability).

In Codex CLI and Codex in the ChatGPT desktop app, API key authentication
includes access to supported OpenAI-curated plugins. Some plugins aren't
available because their connection flows require unsupported OAuth
capabilities. See [Use plugins](/codex/plugins#api-key-availability).

When you sign in with an API key, Codex uses standard API pricing instead of
included ChatGPT plan credits.

Use API key authentication for programmatic Codex CLI workflows, such as CI/CD
jobs. Don't expose Codex execution in untrusted or public environments.

### Check authentication or sign out

Open the profile menu to confirm the active account and workspace. To end the
ChatGPT web session in that browser, select **Log out**.

Open the profile menu to see the active account or API key status. Select
**Log out** to clear the current credentials.

Run `codex login status` to see the active authentication method. For stored
authentication, run `codex logout` to clear the current credentials. When
the process selects workload identity, Codex rejects `codex login` and
`codex logout` because the process environment controls authentication.

Open the profile menu to see the active account or API key status. Select
**Log out** to clear the current credentials.

### Use Codex access tokens for enterprise automation

In ChatGPT Enterprise workspaces, admins can grant the access token
permission so permitted members can create Codex access tokens for trusted,
non-interactive Codex local workflows. Use an access token when automation
needs ChatGPT workspace access, ChatGPT-managed Codex entitlements, or
enterprise workspace controls without a browser sign-in.

Access tokens are intended for trusted scripts, schedulers, and private CI
runners. For general OpenAI API calls, continue to use Platform API keys.

For setup steps, permissions, rotation, and revocation guidance, see
[Access tokens](/codex/enterprise/access-tokens).

If your cloud platform, CI system, or cluster already issues short-lived
workload tokens, use
[workload identity federation](/codex/enterprise/workload-identity)
instead of storing an OpenAI credential.

If your environment already provides a Codex access token, pipe it to the CLI:

```
printenv CODEX_ACCESS_TOKEN | codex login --with-access-token
```

## Secure your Codex cloud account

Codex cloud interacts directly with your codebase, so it needs stronger security than many other ChatGPT features. Enable multi-factor authentication (MFA).

If you use a social login provider (Google, Microsoft, Apple), you aren't required to enable MFA on your ChatGPT account, but you can set it up with your social login provider.

For setup instructions, see:

* [Google](https://support.google.com/accounts/answer/185839)
* [Microsoft](https://support.microsoft.com/en-us/topic/what-is-multifactor-authentication-e5e39437-121c-be60-d123-eda06bddf661)
* [Apple](https://support.apple.com/en-us/102660)

If you access ChatGPT through single sign-on (SSO), your organization's SSO administrator should enforce MFA for all users.

If you log in using an email and password, you must set up MFA on your account before accessing Codex cloud.

If your account supports more than one login method and one of them is email and password, you must set up MFA before accessing Codex, even if you sign in another way.

## Login caching

When you sign in to the ChatGPT desktop app, Codex CLI, or IDE extension using either ChatGPT or an API key, your login details are cached and reused. The CLI and extension share the same cached login details. If you log out from either one, you'll need to sign in again the next time you start the CLI or extension.

Codex caches login details locally in a plaintext file at `~/.codex/auth.json` or in your OS-specific credential store.

For sign in with ChatGPT sessions, Codex refreshes tokens automatically during use before they expire, so active sessions usually continue without requiring another browser login.

## Credential storage

Use `cli_auth_credentials_store` to control where the Codex CLI stores cached credentials:

```
# file | keyring | auto | ephemeral
cli_auth_credentials_store = "keyring"
```

* `file` stores credentials in `auth.json` under `CODEX_HOME` (defaults to `~/.codex`).
* `keyring` stores credentials in your operating system credential store and fails if it is unavailable.
* `auto` uses the OS credential store when available, otherwise falls back to `auth.json`.
* `ephemeral` keeps credentials in memory only for the current process.

See the [configuration reference](/codex/config-file/config-reference) for the complete
`config.toml` schema.

Admins can enforce `cli_auth_credentials_store` and `chatgpt_base_url` through
[local authentication requirements](/codex/enterprise/managed-configuration#manage-authentication-locally).
Users can't override those requirements through `config.toml` or CLI overrides.

If you use file-based storage, treat `~/.codex/auth.json` like a password: it
contains access tokens. Don't commit it, paste it into tickets, or share it in
chat.

## Enforce a login method or workspace

In managed environments, admins may restrict how users are allowed to authenticate:

```
# Only allow ChatGPT login or only allow API key login.
forced_login_method = "chatgpt" # or "api"

# When using ChatGPT login, restrict users to a specific workspace.
forced_chatgpt_workspace_id = "00000000-0000-0000-0000-000000000000"
```

If the active credentials don't match the configured restrictions, Codex logs the user out and exits.

These settings can also be supplied through legacy managed configuration.
For admin-enforced login restrictions, see
[Manage authentication locally](/codex/enterprise/managed-configuration#manage-authentication-locally).

## Login diagnostics

Direct `codex login` runs write a dedicated `codex-login.log` file under
your configured log directory. Use it when you need to debug browser-login or
device-code failures, or when support asks for login-specific logs.

## Custom CA bundles

If your network uses a corporate TLS proxy or private root CA, set
`CODEX_CA_CERTIFICATE` to a PEM bundle before logging in. When
`CODEX_CA_CERTIFICATE` is unset, Codex falls back to `SSL_CERT_FILE`. The same
custom CA settings apply to login, normal HTTPS requests, and secure WebSocket
connections.

```
export CODEX_CA_CERTIFICATE=/path/to/corporate-root-ca.pem
codex login
```

## Login on headless devices

If you are signing in to ChatGPT with the Codex CLI, there are some situations where the browser-based login UI may not work:

* You're running the CLI in a remote or headless environment.
* Your local networking configuration blocks the localhost callback Codex uses to return the OAuth token to the CLI after you sign in.

In these situations, prefer device code authentication (beta). In the interactive login UI, choose **Sign in with Device Code**, or run `codex login --device-auth` directly. If device code authentication doesn't work in your environment, use one of the fallback methods.

### Preferred: Device code authentication (beta)

1. Enable device code login in your ChatGPT security settings (personal account) or ChatGPT workspace permissions (workspace admin).
2. In the terminal where you're running Codex, choose one of these options:
   * In the interactive login UI, select **Sign in with Device Code**.
   * Run `codex login --device-auth`.
3. Open the link in your browser, sign in, then enter the one-time code.

If device code login isn't available in your environment, use one of the
fallback methods below.

### Fallback: Authenticate locally and copy your auth cache

If you can complete the login flow on a machine with a browser, you can copy your cached credentials to the headless machine.

1. On a machine where you can use the browser-based login flow, run `codex login`.
2. Confirm the login cache exists at `~/.codex/auth.json`.
3. Copy `~/.codex/auth.json` to `~/.codex/auth.json` on the headless machine.

Treat `~/.codex/auth.json` like a password: it contains access tokens. Don't commit it, paste it into tickets, or share it in chat.

If your OS stores credentials in a credential store instead of `~/.codex/auth.json`, this method may not apply. See
[Credential storage](/codex/auth#credential-storage) for how to configure file-based storage.

Copy to a remote machine over SSH:

```
ssh user@remote 'mkdir -p ~/.codex'
scp ~/.codex/auth.json user@remote:~/.codex/auth.json
```

Or use a one-liner that avoids `scp`:

```
ssh user@remote 'mkdir -p ~/.codex && cat > ~/.codex/auth.json' < ~/.codex/auth.json
```

Copy into a Docker container:

```
# Replace MY_CONTAINER with the name or ID of your container.
CONTAINER_HOME=$(docker exec MY_CONTAINER printenv HOME)
docker exec MY_CONTAINER mkdir -p "$CONTAINER_HOME/.codex"
docker cp ~/.codex/auth.json MY_CONTAINER:"$CONTAINER_HOME/.codex/auth.json"
```

For a more advanced version of this same pattern on trusted CI/CD runners, see
[Maintain Codex account auth in CI/CD (advanced)](/codex/auth/ci-cd-auth).
That guide explains how to let Codex refresh `auth.json` during normal runs and
then keep the updated file for the next job. API keys are still the recommended
default for automation.

### Fallback: Forward the localhost callback over SSH

If you can forward ports between your local machine and the remote host, you can use the standard browser-based flow by tunneling Codex's local callback server (default `localhost:1455`).

1. From your local machine, start port forwarding:

```
ssh -L 1455:localhost:1455 user@remote
```

2. In that SSH session, run `codex login` and follow the printed address on your local machine.

## Alternative model providers

When you define a [custom model provider](/codex/config-file/config-advanced#custom-model-providers) in your configuration file, you can choose one of these authentication methods:

* **OpenAI authentication**: Set `requires_openai_auth = true` to use OpenAI authentication. You can then sign in with ChatGPT or an API key. This is useful when you access OpenAI models through an LLM proxy server. When `requires_openai_auth = true`, Codex ignores `env_key`.
* **Environment variable authentication**: Set `env_key = "<ENV_VARIABLE_NAME>"` to use a provider-specific API key from the local environment variable named `<ENV_VARIABLE_NAME>`.
* **No authentication**: If you don't set `requires_openai_auth` (or set it to `false`) and you don't set `env_key`, Codex assumes the provider doesn't require authentication. This is useful for local models.

[Next

Workload identity](/codex/enterprise/workload-identity)

Ask AI

## Docs agent

Loading docs agent...
