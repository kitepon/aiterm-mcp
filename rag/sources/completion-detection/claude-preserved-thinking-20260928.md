---
title: "Claudeの思考ブロック保持とCLIの責務"
source_url: "https://support.claude.com/en/articles/16761192"
source_type: official_docs
fetched: 2026-09-28
topic: completion-detection
tags: ["claude", "thinking", "responsibility"]
summary: "思考ブロックを保持する仕様と、Claude Codeがその処理を担当することの公式説明。"
relevance: "AitermはClaudeのAPI要求や思考ブロックを書き換えず、終了記録から送信状態だけを修理する。"
chars: 83477
---

[Skip to main content](#docs-main)

[![](https://downloads.intercomcdn.com/i/o/lupk8zyo/943325/c8d14176c0425c5008e74ab6f0ec/e857ae2291773374591d56c72f73f35e.png)](/en/)

[API docs](https://docs.claude.com/en/docs/intro)[Release notes](https://support.claude.com/en/articles/12138966-release-notes)[How to get support](https://support.claude.com/en/articles/9015913-how-to-get-support)

EnglishFrançaisDeutschBahasa IndonesiaItaliano日本語한국어PortuguêsPусский简体中文Español繁體中文

English

Search`⌘K`

* [![](https://downloads.intercomcdn.com/i/hc/icons/v3/lupk8zyo/938300/973c6ca7d4e976daf15ed134dd98/141413.svg)Claude](https://support.claude.com/en/collections/4078531-claude "Claude")

  + [Release notes](https://support.claude.com/en/articles/12138966-release-notes "Release notes")
  + [Get started with Claude](https://support.claude.com/en/collections/9811058-get-started-with-claude "Get started with Claude")

    - [Get started with Claude](https://support.claude.com/en/articles/8114491-get-started-with-claude "Get started with Claude")
    - [What are some things I can use Claude for?](https://support.claude.com/en/articles/7996845-what-are-some-things-i-can-use-claude-for "What are some things I can use Claude for?")
    - [Where can I access Claude?](https://support.claude.com/en/articles/8461763-where-can-i-access-claude "Where can I access Claude?")
    - [How up-to-date is Claude's training data?](https://support.claude.com/en/articles/8114494-how-up-to-date-is-claude-s-training-data "How up-to-date is Claude's training data?")
    - [What interfaces can I use to access Claude?](https://support.claude.com/en/articles/8114487-what-interfaces-can-i-use-to-access-claude "What interfaces can I use to access Claude?")
    - [Verify your phone number](https://support.claude.com/en/articles/8287232-verify-your-phone-number "Verify your phone number")
    - [How to gift a Claude subscription](https://support.claude.com/en/articles/12938627-how-to-gift-a-claude-subscription "How to gift a Claude subscription")
    - [How to redeem a Claude gift subscription](https://support.claude.com/en/articles/12938695-how-to-redeem-a-claude-gift-subscription "How to redeem a Claude gift subscription")
  + [Account management](https://support.claude.com/en/collections/9811145-account-management "Account management")

    - [Log in to your Claude account](https://support.claude.com/en/articles/13189465-log-in-to-your-claude-account "Log in to your Claude account")
    - [How to get support](https://support.claude.com/en/articles/9015913-how-to-get-support "How to get support")
    - [How do I change the email address associated with my account?](https://support.claude.com/en/articles/8452276-how-do-i-change-the-email-address-associated-with-my-account "How do I change the email address associated with my account?")
    - [I would like to input sensitive data into my chats with Claude. Who can view my conversations?](https://support.claude.com/en/articles/8325621-i-would-like-to-input-sensitive-data-into-my-chats-with-claude-who-can-view-my-conversations "I would like to input sensitive data into my chats with Claude. Who can view my conversations?")
    - [How do I log out of all active sessions?](https://support.claude.com/en/articles/10310342-how-do-i-log-out-of-all-active-sessions "How do I log out of all active sessions?")
    - [Export your Claude data](https://support.claude.com/en/articles/9450526-export-your-claude-data "Export your Claude data")
    - [Delete your Claude account](https://support.claude.com/en/articles/9028421-delete-your-claude-account "Delete your Claude account")
    - [Why is a coupon or promotion not available for my account?](https://support.claude.com/en/articles/11107691-why-is-a-coupon-or-promotion-not-available-for-my-account "Why is a coupon or promotion not available for my account?")
    - [Managing your active sessions](https://support.claude.com/en/articles/13124001-managing-your-active-sessions "Managing your active sessions")
    - [Understanding your billing address and tax calculation](https://support.claude.com/en/articles/12997130-understanding-your-billing-address-and-tax-calculation "Understanding your billing address and tax calculation")
    - [Notice regarding consumption tax (JCT) for Japanese customers](https://support.claude.com/en/articles/14051822-notice-regarding-consumption-tax-jct-for-japanese-customers "Notice regarding consumption tax (JCT) for Japanese customers")
    - [Configuring session security settings](https://support.claude.com/en/articles/13163631-configuring-session-security-settings "Configuring session security settings")
    - [How to get support for Claude for Government](https://support.claude.com/en/articles/13047024-how-to-get-support-for-claude-for-government "How to get support for Claude for Government")
    - [Public Sector FAQs](https://support.claude.com/en/articles/13756069-public-sector-faqs "Public Sector FAQs")
    - [Claude 4 Invite Contest](https://support.claude.com/en/articles/11408405-claude-4-invite-contest "Claude 4 Invite Contest")
  + [Conversation management](https://support.claude.com/en/collections/18031977-conversation-management "Conversation management")

    - [Delete or rename a conversation](https://support.claude.com/en/articles/8230524-delete-or-rename-a-conversation "Delete or rename a conversation")
    - [Share and unshare chats](https://support.claude.com/en/articles/10593882-share-and-unshare-chats "Share and unshare chats")
    - [Share a chat with specific people](https://support.claude.com/en/articles/16762496-share-a-chat-with-specific-people "Share a chat with specific people")
    - [Public links for shared chats](https://support.claude.com/en/articles/16762437-public-links-for-shared-chats "Public links for shared chats")
    - [Use Claude’s chat search and memory to build on previous context](https://support.claude.com/en/articles/11817273-use-claude-s-chat-search-and-memory-to-build-on-previous-context "Use Claude’s chat search and memory to build on previous context")
    - [Import and export your memory from Claude](https://support.claude.com/en/articles/12123587-import-and-export-your-memory-from-claude "Import and export your memory from Claude")
    - [Use incognito chats](https://support.claude.com/en/articles/12260368-use-incognito-chats "Use incognito chats")
    - [Why Claude switched models in your conversation with Fable 5 or Fable 5.1](https://support.claude.com/en/articles/15363606-why-claude-switched-models-in-your-conversation-with-fable-5-or-fable-5-1 "Why Claude switched models in your conversation with Fable 5 or Fable 5.1")
    - [Why Claude switched models in your conversation with Opus 5 or Opus 5.5](https://support.claude.com/en/articles/16049681-why-claude-switched-models-in-your-conversation-with-opus-5-or-opus-5-5 "Why Claude switched models in your conversation with Opus 5 or Opus 5.5")
  + [Features and capabilities](https://support.claude.com/en/collections/18031719-features-and-capabilities "Features and capabilities")

    - [What are artifacts and how do I use them?](https://support.claude.com/en/articles/17153992-what-are-artifacts-and-how-do-i-use-them "What are artifacts and how do I use them?")
    - [Share artifacts](https://support.claude.com/en/articles/9547008-share-artifacts "Share artifacts")
    - [Get started with Claude Docs](https://support.claude.com/en/articles/16923645-get-started-with-claude-docs "Get started with Claude Docs")
    - [Get started with Claude Design](https://support.claude.com/en/articles/14604416-get-started-with-claude-design "Get started with Claude Design")
    - [Set up your design system in Claude Design](https://support.claude.com/en/articles/14604397-set-up-your-design-system-in-claude-design "Set up your design system in Claude Design")
    - [When should I use web search, extended thinking, and research?](https://support.claude.com/en/articles/11095361-when-should-i-use-web-search-extended-thinking-and-research "When should I use web search, extended thinking, and research?")
    - [Enable and use web search](https://support.claude.com/en/articles/10684626-enable-and-use-web-search "Enable and use web search")
    - [Use research on Claude](https://support.claude.com/en/articles/11088861-use-research-on-claude "Use research on Claude")
    - [Can Claude produce images?](https://support.claude.com/en/articles/9002504-can-claude-produce-images "Can Claude produce images?")
    - [Upload files to Claude](https://support.claude.com/en/articles/8241126-upload-files-to-claude "Upload files to Claude")
    - [Create and edit files with Claude](https://support.claude.com/en/articles/12111783-create-and-edit-files-with-claude "Create and edit files with Claude")
    - [How does Claude handle mathematical equations and calculations?](https://support.claude.com/en/articles/10366421-how-does-claude-handle-mathematical-equations-and-calculations "How does Claude handle mathematical equations and calculations?")
    - [What are projects?](https://support.claude.com/en/articles/9517075-what-are-projects "What are projects?")
    - [Retrieval augmented generation (RAG) for projects](https://support.claude.com/en/articles/11473015-retrieval-augmented-generation-rag-for-projects "Retrieval augmented generation (RAG) for projects")
    - [What are skills?](https://support.claude.com/en/articles/12512176-what-are-skills "What are skills?")
    - [Use skills in Claude](https://support.claude.com/en/articles/12512180-use-skills-in-claude "Use skills in Claude")
    - [How to create custom skills](https://support.claude.com/en/articles/12512198-how-to-create-custom-skills "How to create custom skills")
    - [Use plugins in Claude](https://support.claude.com/en/articles/13837440-use-plugins-in-claude "Use plugins in Claude")
    - [Browse skills, connectors, and plugins in one directory](https://support.claude.com/en/articles/14328846-browse-skills-connectors-and-plugins-in-one-directory "Browse skills, connectors, and plugins in one directory")
    - [Use Claude in Xcode](https://support.claude.com/en/articles/12293051-use-claude-in-xcode "Use Claude in Xcode")
    - [Use Claude in Microsoft Foundry](https://support.claude.com/en/articles/12864745-use-claude-in-microsoft-foundry "Use Claude in Microsoft Foundry")
    - [Visual and interactive content](https://support.claude.com/en/articles/13641943-visual-and-interactive-content "Visual and interactive content")
    - [Custom visuals in chat and Cowork](https://support.claude.com/en/articles/13979539-custom-visuals-in-chat-and-cowork "Custom visuals in chat and Cowork")
    - [Available beta and research preview features](https://support.claude.com/en/articles/14503520-available-beta-and-research-preview-features "Available beta and research preview features")
    - [Use Claude Security](https://support.claude.com/en/articles/14661296-use-claude-security "Use Claude Security")
    - [See your monthly recap](https://support.claude.com/en/articles/15672559-see-your-monthly-recap "See your monthly recap")
    - [Get started with Claude Science](https://support.claude.com/en/articles/16563838-get-started-with-claude-science "Get started with Claude Science")
    - [Use Salesforce in Claude](https://support.claude.com/en/articles/16952186-use-salesforce-in-claude "Use Salesforce in Claude")
    - [Set up Salesforce in Claude for your organization](https://support.claude.com/en/articles/16952184-set-up-salesforce-in-claude-for-your-organization "Set up Salesforce in Claude for your organization")
  + [Personalization and settings](https://support.claude.com/en/collections/18031818-personalization-and-settings "Personalization and settings")

    - [Understanding Claude's personalization features](https://support.claude.com/en/articles/10185728-understanding-claude-s-personalization-features "Understanding Claude's personalization features")
    - [Customizing your appearance settings](https://support.claude.com/en/articles/8887527-customizing-your-appearance-settings "Customizing your appearance settings")
    - [How to use Claude in your preferred language](https://support.claude.com/en/articles/10769299-how-to-use-claude-in-your-preferred-language "How to use Claude in your preferred language")
    - [Change the model, effort, and thinking settings](https://support.claude.com/en/articles/8664678-change-the-model-effort-and-thinking-settings "Change the model, effort, and thinking settings")
    - [Set break reminders and quiet hours](https://support.claude.com/en/articles/15672868-set-break-reminders-and-quiet-hours "Set break reminders and quiet hours")
  + [Troubleshooting](https://support.claude.com/en/collections/18032037-troubleshooting "Troubleshooting")

    - [Troubleshoot Claude error messages](https://support.claude.com/en/articles/12466728-troubleshoot-claude-error-messages "Troubleshoot Claude error messages")
    - [Claude is providing incorrect or misleading responses. What’s going on?](https://support.claude.com/en/articles/8525154-claude-is-providing-incorrect-or-misleading-responses-what-s-going-on "Claude is providing incorrect or misleading responses. What’s going on?")
    - [Claude is producing links that don’t work and falsely claiming that it has sent emails or produced external documents. What’s going on?](https://support.claude.com/en/articles/8241188-claude-is-producing-links-that-don-t-work-and-falsely-claiming-that-it-has-sent-emails-or-produced-external-documents-what-s-going-on "Claude is producing links that don’t work and falsely claiming that it has sent emails or produced external documents. What’s going on?")
    - [Adapt to new model personas after deprecations](https://support.claude.com/en/articles/12738598-adapt-to-new-model-personas-after-deprecations "Adapt to new model personas after deprecations")
  + [Usage and limits](https://support.claude.com/en/collections/18031876-usage-and-limits "Usage and limits")

    - [Usage limit best practices](https://support.claude.com/en/articles/9797557-usage-limit-best-practices "Usage limit best practices")
    - [How do usage and length limits work?](https://support.claude.com/en/articles/11647753-how-do-usage-and-length-limits-work "How do usage and length limits work?")
    - [Buy usage bundles](https://support.claude.com/en/articles/14246112-buy-usage-bundles "Buy usage bundles")
    - [Use the Claude Agent SDK with your Claude plan](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan "Use the Claude Agent SDK with your Claude plan")
    - [Claude Fable models on your plan](https://support.claude.com/en/articles/15424964-claude-fable-models-on-your-plan "Claude Fable models on your plan")
    - [What is a limit reset?](https://support.claude.com/en/articles/17007452-what-is-a-limit-reset "What is a limit reset?")
* [![](https://downloads.intercomcdn.com/i/hc/icons/v3/lupk8zyo/938301/38ac2cf80abb9aeb3af2b9bef14b/141413.svg)Pro and Max plans](https://support.claude.com/en/collections/5953830-pro-and-max-plans "Pro and Max plans")

  + [General](https://support.claude.com/en/collections/9811201-general "General")

    - [How large is the context window on paid Claude plans?](https://support.claude.com/en/articles/8606394-how-large-is-the-context-window-on-paid-claude-plans "How large is the context window on paid Claude plans?")
    - [Paid plan billing FAQs](https://support.claude.com/en/articles/8325618-paid-plan-billing-faqs "Paid plan billing FAQs")
    - [Why was my card declined?](https://support.claude.com/en/articles/9402418-why-was-my-card-declined "Why was my card declined?")
    - [Add or update your paid Claude account’s tax or VAT ID](https://support.claude.com/en/articles/9889408-add-or-update-your-paid-claude-account-s-tax-or-vat-id "Add or update your paid Claude account’s tax or VAT ID")
    - [Why am I being asked to verify my payment method?](https://support.claude.com/en/articles/11818288-why-am-i-being-asked-to-verify-my-payment-method "Why am I being asked to verify my payment method?")
    - [Cancel your Pro or Max subscription](https://support.claude.com/en/articles/8325617-cancel-your-pro-or-max-subscription "Cancel your Pro or Max subscription")
    - [How can I create and manage projects?](https://support.claude.com/en/articles/9519177-how-can-i-create-and-manage-projects "How can I create and manage projects?")
    - [Request a refund for a paid Claude plan](https://support.claude.com/en/articles/12386328-request-a-refund-for-a-paid-claude-plan "Request a refund for a paid Claude plan")
    - [Manage usage credits for paid Claude plans](https://support.claude.com/en/articles/12429409-manage-usage-credits-for-paid-claude-plans "Manage usage credits for paid Claude plans")
    - [Understanding your Pro or Max plan invoices](https://support.claude.com/en/articles/16607638-understanding-your-pro-or-max-plan-invoices "Understanding your Pro or Max plan invoices")
  + [Pro plan](https://support.claude.com/en/collections/9811198-pro-plan "Pro plan")

    - [What is the Pro plan?](https://support.claude.com/en/articles/8325606-what-is-the-pro-plan "What is the Pro plan?")
    - [How do I sign up for the Pro plan?](https://support.claude.com/en/articles/8325609-how-do-i-sign-up-for-the-pro-plan "How do I sign up for the Pro plan?")
    - [How to change your Pro plan from monthly to annual billing](https://support.claude.com/en/articles/10185996-how-to-change-your-pro-plan-from-monthly-to-annual-billing "How to change your Pro plan from monthly to annual billing")
  + [Max plan](https://support.claude.com/en/collections/12394590-max-plan "Max plan")

    - [What is the Max plan?](https://support.claude.com/en/articles/11049741-what-is-the-max-plan "What is the Max plan?")
    - [How do I sign up for the Max plan?](https://support.claude.com/en/articles/11049752-how-do-i-sign-up-for-the-max-plan "How do I sign up for the Max plan?")
* [![](https://downloads.intercomcdn.com/i/hc/icons/v3/lupk8zyo/938303/bd2bb85ba160e836164722a24249/141413.svg)Team and Enterprise plans](https://support.claude.com/en/collections/9387370-team-and-enterprise-plans "Team and Enterprise plans")

  + [Plan overviews](https://support.claude.com/en/collections/18901829-plan-overviews "Plan overviews")

    - [What is the Enterprise plan?](https://support.claude.com/en/articles/9797531-what-is-the-enterprise-plan "What is the Enterprise plan?")
    - [What is the Team plan?](https://support.claude.com/en/articles/9266767-what-is-the-team-plan "What is the Team plan?")
    - [Claude Team plan for scientists](https://support.claude.com/en/articles/16634237-claude-team-plan-for-scientists "Claude Team plan for scientists")
  + [Get started](https://support.claude.com/en/collections/18901835-get-started "Get started")

    - [Get started with the Team plan](https://support.claude.com/en/articles/9267247-get-started-with-the-team-plan "Get started with the Team plan")
    - [Move your personal Claude account to a Team or Enterprise organization](https://support.claude.com/en/articles/9267400-move-your-personal-claude-account-to-a-team-or-enterprise-organization "Move your personal Claude account to a Team or Enterprise organization")
    - [Find and join a Team or Enterprise organization](https://support.claude.com/en/articles/13566435-find-and-join-a-team-or-enterprise-organization "Find and join a Team or Enterprise organization")
    - [Migrate your organization from Team to Enterprise](https://support.claude.com/en/articles/13779868-migrate-your-organization-from-team-to-enterprise "Migrate your organization from Team to Enterprise")
    - [Join an organization via invite link](https://support.claude.com/en/articles/13776697-join-an-organization-via-invite-link "Join an organization via invite link")
    - [Respond to an Enterprise domain claim on your Claude account](https://support.claude.com/en/articles/14625626-respond-to-an-enterprise-domain-claim-on-your-claude-account "Respond to an Enterprise domain claim on your Claude account")
    - [Claude Code on Console to Enterprise migration](https://support.claude.com/en/articles/14128775-claude-code-on-console-to-enterprise-migration "Claude Code on Console to Enterprise migration")
    - [Set up Claude for Teachers for your school or district](https://support.claude.com/en/articles/16559896-set-up-claude-for-teachers-for-your-school-or-district "Set up Claude for Teachers for your school or district")
  + [Billing](https://support.claude.com/en/collections/9811436-billing "Billing")

    - [How is my Team plan bill calculated?](https://support.claude.com/en/articles/9267289-how-is-my-team-plan-bill-calculated "How is my Team plan bill calculated?")
    - [Team plan billing FAQs](https://support.claude.com/en/articles/12997503-team-plan-billing-faqs "Team plan billing FAQs")
    - [Change your Team plan from monthly to annual billing](https://support.claude.com/en/articles/12083917-change-your-team-plan-from-monthly-to-annual-billing "Change your Team plan from monthly to annual billing")
    - [Add or update your Team plan's tax or VAT ID](https://support.claude.com/en/articles/9927624-add-or-update-your-team-plan-s-tax-or-vat-id "Add or update your Team plan's tax or VAT ID")
    - [Cancel your organization's Team plan subscription](https://support.claude.com/en/articles/9267323-cancel-your-organization-s-team-plan-subscription "Cancel your organization's Team plan subscription")
    - [How am I billed for my Enterprise plan?](https://support.claude.com/en/articles/11526368-how-am-i-billed-for-my-enterprise-plan "How am I billed for my Enterprise plan?")
    - [Understanding your Team plan invoices](https://support.claude.com/en/articles/16607668-understanding-your-team-plan-invoices "Understanding your Team plan invoices")
  + [Admin management](https://support.claude.com/en/collections/9811449-admin-management "Admin management")

    - [Roles and permissions](https://support.claude.com/en/articles/9267276-roles-and-permissions "Roles and permissions")
    - [Purchase and manage seats on Team plans](https://support.claude.com/en/articles/12004354-purchase-and-manage-seats-on-team-plans "Purchase and manage seats on Team plans")
    - [Purchase and manage seats on Enterprise plans](https://support.claude.com/en/articles/13393991-purchase-and-manage-seats-on-enterprise-plans "Purchase and manage seats on Enterprise plans")
    - [Manage members on Team and Enterprise plans](https://support.claude.com/en/articles/13133750-manage-members-on-team-and-enterprise-plans "Manage members on Team and Enterprise plans")
    - [Claude Enterprise consumption guide](https://support.claude.com/en/articles/14782391-claude-enterprise-consumption-guide "Claude Enterprise consumption guide")
    - [Manage usage credits for Team and seat-based Enterprise plans](https://support.claude.com/en/articles/12005970-manage-usage-credits-for-team-and-seat-based-enterprise-plans "Manage usage credits for Team and seat-based Enterprise plans")
    - [Manage user feedback settings on Team and Enterprise plans](https://support.claude.com/en/articles/10504844-manage-user-feedback-settings-on-team-and-enterprise-plans "Manage user feedback settings on Team and Enterprise plans")
    - [Control project sharing for your organization](https://support.claude.com/en/articles/9927533-control-project-sharing-for-your-organization "Control project sharing for your organization")
    - [Manage plugins for your organization](https://support.claude.com/en/articles/13837433-manage-plugins-for-your-organization "Manage plugins for your organization")
    - [Account management FAQs](https://support.claude.com/en/articles/13325567-account-management-faqs "Account management FAQs")
    - [Manage groups and group spend limits on Enterprise plans](https://support.claude.com/en/articles/13799932-manage-groups-and-group-spend-limits-on-enterprise-plans "Manage groups and group spend limits on Enterprise plans")
    - [Manage custom roles on Enterprise plans](https://support.claude.com/en/articles/13930452-manage-custom-roles-on-enterprise-plans "Manage custom roles on Enterprise plans")
    - [Set up role-based permissions on Enterprise plans](https://support.claude.com/en/articles/13930458-set-up-role-based-permissions-on-enterprise-plans "Set up role-based permissions on Enterprise plans")
    - [Set organization instructions](https://support.claude.com/en/articles/14546867-set-organization-instructions "Set organization instructions")
    - [Claude Design admin guide for Team and Enterprise plans](https://support.claude.com/en/articles/14604406-claude-design-admin-guide-for-team-and-enterprise-plans "Claude Design admin guide for Team and Enterprise plans")
    - [Claim and migrate accounts on your domain](https://support.claude.com/en/articles/14625619-claim-and-migrate-accounts-on-your-domain "Claim and migrate accounts on your domain")
    - [Designate support contacts for human support](https://support.claude.com/en/articles/15263885-designate-support-contacts-for-human-support "Designate support contacts for human support")
    - [Claude Enterprise Admin API reference guide](https://support.claude.com/en/articles/15330651-claude-enterprise-admin-api-reference-guide "Claude Enterprise Admin API reference guide")
    - [Claude Enterprise activation promo for Claude Code and Cowork](https://support.claude.com/en/articles/15282265-claude-enterprise-activation-promo-for-claude-code-and-cowork "Claude Enterprise activation promo for Claude Code and Cowork")
    - [Set a default model for your organization](https://support.claude.com/en/articles/15330088-set-a-default-model-for-your-organization "Set a default model for your organization")
    - [Restrict verified-domain connectors to your Enterprise](https://support.claude.com/en/articles/15402193-restrict-verified-domain-connectors-to-your-enterprise "Restrict verified-domain connectors to your Enterprise")
    - [Manage model access for your organization](https://support.claude.com/en/articles/15694740-manage-model-access-for-your-organization "Manage model access for your organization")
    - [Create surveys for your organization](https://support.claude.com/en/articles/16764057-create-surveys-for-your-organization "Create surveys for your organization")
    - [Manage pooled group budgets on Enterprise plans](https://support.claude.com/en/articles/17005973-manage-pooled-group-budgets-on-enterprise-plans "Manage pooled group budgets on Enterprise plans")
  + [Analytics and usage](https://support.claude.com/en/collections/18901831-analytics-and-usage "Analytics and usage")

    - [View usage analytics for Team and Enterprise plans](https://support.claude.com/en/articles/12883420-view-usage-analytics-for-team-and-enterprise-plans "View usage analytics for Team and Enterprise plans")
    - [Configure a custom OpenTelemetry collector for Office agents](https://support.claude.com/en/articles/14447276-configure-a-custom-opentelemetry-collector-for-office-agents "Configure a custom OpenTelemetry collector for Office agents")
    - [Use analytics chat to ask Claude about usage](https://support.claude.com/en/articles/14729354-use-analytics-chat-to-ask-claude-about-usage "Use analytics chat to ask Claude about usage")
    - [Get started with smart reports](https://support.claude.com/en/articles/16893491-get-started-with-smart-reports "Get started with smart reports")
    - [Let team members run smart reports for specific groups](https://support.claude.com/en/articles/16948886-let-team-members-run-smart-reports-for-specific-groups "Let team members run smart reports for specific groups")
  + [Capabilities](https://support.claude.com/en/collections/9811414-capabilities "Capabilities")

    - [Manage project visibility and sharing](https://support.claude.com/en/articles/9519189-manage-project-visibility-and-sharing "Manage project visibility and sharing")
    - [Use enterprise search](https://support.claude.com/en/articles/12489464-use-enterprise-search "Use enterprise search")
    - [Use visual and interactive content on Team and Enterprise plans](https://support.claude.com/en/articles/13663666-use-visual-and-interactive-content-on-team-and-enterprise-plans "Use visual and interactive content on Team and Enterprise plans")
    - [Provision and manage skills for your organization](https://support.claude.com/en/articles/13119606-provision-and-manage-skills-for-your-organization "Provision and manage skills for your organization")
    - [What is Claude Tag?](https://support.claude.com/en/articles/15594475-what-is-claude-tag "What is Claude Tag?")
    - [Get started with skill and plugin scanning](https://support.claude.com/en/articles/15927065-get-started-with-skill-and-plugin-scanning "Get started with skill and plugin scanning")
    - [Artifacts admin guide for Team and Enterprise plans](https://support.claude.com/en/articles/16994751-artifacts-admin-guide-for-team-and-enterprise-plans "Artifacts admin guide for Team and Enterprise plans")
  + [Security and compliance](https://support.claude.com/en/collections/10351014-security-and-compliance "Security and compliance")

    - [Does Anthropic Act as a Data Processor or Controller?](https://support.claude.com/en/articles/9267385-does-anthropic-act-as-a-data-processor-or-controller "Does Anthropic Act as a Data Processor or Controller?")
    - [Can you delete data that I sent via Team and Enterprise plans?](https://support.claude.com/en/articles/9796617-can-you-delete-data-that-i-sent-via-team-and-enterprise-plans "Can you delete data that I sent via Team and Enterprise plans?")
    - [How can I access the personal information that Anthropic has on my account?](https://support.claude.com/en/articles/9267387-how-can-i-access-the-personal-information-that-anthropic-has-on-my-account "How can I access the personal information that Anthropic has on my account?")
    - [What happens to a user's data when they are removed from a Team or Enterprise organization?](https://support.claude.com/en/articles/12053672-what-happens-to-a-user-s-data-when-they-are-removed-from-a-team-or-enterprise-organization "What happens to a user's data when they are removed from a Team or Enterprise organization?")
    - [Export your organization's data](https://support.claude.com/en/articles/13346720-export-your-organization-s-data "Export your organization's data")
    - [Who owns and manages the data of my team?](https://support.claude.com/en/articles/9265372-who-owns-and-manages-the-data-of-my-team "Who owns and manages the data of my team?")
    - [HIPAA-ready Enterprise plans](https://support.claude.com/en/articles/13296973-hipaa-ready-enterprise-plans "HIPAA-ready Enterprise plans")
    - [Data retention practices for Covered Models](https://support.claude.com/en/articles/15425996-data-retention-practices-for-covered-models "Data retention practices for Covered Models")
    - [Configure custom data retention controls for Enterprise plans](https://support.claude.com/en/articles/10440198-configure-custom-data-retention-controls-for-enterprise-plans "Configure custom data retention controls for Enterprise plans")
    - [Enable US-only inference for your organization](https://support.claude.com/en/articles/15422948-enable-us-only-inference-for-your-organization "Enable US-only inference for your organization")
    - [Access audit logs](https://support.claude.com/en/articles/9970975-access-audit-logs "Access audit logs")
    - [Access the Compliance API](https://support.claude.com/en/articles/13015708-access-the-compliance-api "Access the Compliance API")
    - [Get started with Claude Compliance API integrations](https://support.claude.com/en/articles/15167101-get-started-with-claude-compliance-api-integrations "Get started with Claude Compliance API integrations")
    - [Restrict access to Claude with IP allowlisting](https://support.claude.com/en/articles/13200993-restrict-access-to-claude-with-ip-allowlisting "Restrict access to Claude with IP allowlisting")
    - [Enforce network-level access control with Tenant Restrictions](https://support.claude.com/en/articles/13198485-enforce-network-level-access-control-with-tenant-restrictions "Enforce network-level access control with Tenant Restrictions")
    - [What are customer-managed encryption keys (CMEK)?](https://support.claude.com/en/articles/15505325-what-are-customer-managed-encryption-keys-cmek "What are customer-managed encryption keys (CMEK)?")
    - [Inference hooks overview](https://support.claude.com/en/articles/16059458-inference-hooks-overview "Inference hooks overview")
* [![](https://downloads.intercomcdn.com/i/hc/icons/v3/lupk8zyo/938304/5ffb4feea1e2b255910fc58e99d4/141413.svg)Identity management (SSO, JIT, SCIM)](https://support.claude.com/en/collections/17270717-identity-management-sso-jit-scim "Identity management (SSO, JIT, SCIM)")

  + [Important considerations before enabling single sign-on (SSO) and JIT/SCIM provisioning](https://support.claude.com/en/articles/10276682-important-considerations-before-enabling-single-sign-on-sso-and-jit-scim-provisioning "Important considerations before enabling single sign-on (SSO) and JIT/SCIM provisioning")
  + [Set up single sign-on (SSO)](https://support.claude.com/en/articles/13132885-set-up-single-sign-on-sso "Set up single sign-on (SSO)")
  + [Set up JIT or SCIM provisioning](https://support.claude.com/en/articles/13133195-set-up-jit-or-scim-provisioning "Set up JIT or SCIM provisioning")
  + [Switching to a different Identity Provider (IdP)](https://support.claude.com/en/articles/13443687-switching-to-a-different-identity-provider-idp "Switching to a different Identity Provider (IdP)")
  + [How SCIM sync works for Enterprise organizations](https://support.claude.com/en/articles/14499648-how-scim-sync-works-for-enterprise-organizations "How SCIM sync works for Enterprise organizations")
  + [Setup by identity provider](https://support.claude.com/en/collections/19039081-setup-by-identity-provider "Setup by identity provider")

    - [Google Workspace SSO setup](https://support.claude.com/en/articles/13917884-google-workspace-sso-setup "Google Workspace SSO setup")
    - [Microsoft Entra ID SSO setup](https://support.claude.com/en/articles/13917889-microsoft-entra-id-sso-setup "Microsoft Entra ID SSO setup")
    - [Okta SSO setup](https://support.claude.com/en/articles/13917894-okta-sso-setup "Okta SSO setup")
    - [OneLogin SSO setup](https://support.claude.com/en/articles/13917899-onelogin-sso-setup "OneLogin SSO setup")
    - [Ping Identity SSO setup](https://support.claude.com/en/articles/13917902-ping-identity-sso-setup "Ping Identity SSO setup")
  + [Troubleshooting by identity provider](https://support.claude.com/en/collections/19039143-troubleshooting-by-identity-provider "Troubleshooting by identity provider")

    - [Google Workspace SSO/SCIM email mismatch](https://support.claude.com/en/articles/13917817-google-workspace-sso-scim-email-mismatch "Google Workspace SSO/SCIM email mismatch")
    - [Microsoft Entra ID SSO/SCIM email mismatch](https://support.claude.com/en/articles/13917829-microsoft-entra-id-sso-scim-email-mismatch "Microsoft Entra ID SSO/SCIM email mismatch")
    - [Okta SSO/SCIM email mismatch](https://support.claude.com/en/articles/13917840-okta-sso-scim-email-mismatch "Okta SSO/SCIM email mismatch")
    - [OneLogin SSO/SCIM email mismatch](https://support.claude.com/en/articles/13917861-onelogin-sso-scim-email-mismatch "OneLogin SSO/SCIM email mismatch")
    - [Ping Identity SSO/SCIM email mismatch](https://support.claude.com/en/articles/13917875-ping-identity-sso-scim-email-mismatch "Ping Identity SSO/SCIM email mismatch")
* [![](https://downloads.intercomcdn.com/i/hc/icons/v3/lupk8zyo/938305/82c5bcb41f8e2bd785c0eb70f331/141413.svg)Claude Cowork](https://support.claude.com/en/collections/19667525-claude-cowork "Claude Cowork")

  + [Get started with Claude Cowork](https://support.claude.com/en/articles/13345190-get-started-with-claude-cowork "Get started with Claude Cowork")
  + [Use Claude Cowork safely](https://support.claude.com/en/articles/13364135-use-claude-cowork-safely "Use Claude Cowork safely")
  + [Use Claude Cowork on web, desktop, and mobile](https://support.claude.com/en/articles/15520349-use-claude-cowork-on-web-desktop-and-mobile "Use Claude Cowork on web, desktop, and mobile")
  + [Use Claude Cowork on Team and Enterprise plans](https://support.claude.com/en/articles/13455879-use-claude-cowork-on-team-and-enterprise-plans "Use Claude Cowork on Team and Enterprise plans")
  + [Use the built-in browser in Claude Cowork](https://support.claude.com/en/articles/16607400-use-the-built-in-browser-in-claude-cowork "Use the built-in browser in Claude Cowork")
  + [Set up browser use in Claude Cowork for Team and Enterprise plans](https://support.claude.com/en/articles/16635803-set-up-browser-use-in-claude-cowork-for-team-and-enterprise-plans "Set up browser use in Claude Cowork for Team and Enterprise plans")
  + [Use live artifacts in Claude Cowork](https://support.claude.com/en/articles/14729249-use-live-artifacts-in-claude-cowork "Use live artifacts in Claude Cowork")
  + [Schedule recurring tasks in Claude Cowork](https://support.claude.com/en/articles/13854387-schedule-recurring-tasks-in-claude-cowork "Schedule recurring tasks in Claude Cowork")
  + [Assign tasks from anywhere in Claude Cowork](https://support.claude.com/en/articles/13947068-assign-tasks-from-anywhere-in-claude-cowork "Assign tasks from anywhere in Claude Cowork")
  + [Organize your tasks with projects in Claude Cowork](https://support.claude.com/en/articles/14116274-organize-your-tasks-with-projects-in-claude-cowork "Organize your tasks with projects in Claude Cowork")
  + [Let Claude use your computer in Cowork](https://support.claude.com/en/articles/14128542-let-claude-use-your-computer-in-cowork "Let Claude use your computer in Cowork")
  + [Monitor Claude Cowork activity with OpenTelemetry](https://support.claude.com/en/articles/14477985-monitor-claude-cowork-activity-with-opentelemetry "Monitor Claude Cowork activity with OpenTelemetry")
  + [Claude Cowork architecture overview](https://support.claude.com/en/articles/14479288-claude-cowork-architecture-overview "Claude Cowork architecture overview")
  + [Claude Cowork and chat are one Claude](https://support.claude.com/en/articles/16761823-claude-cowork-and-chat-are-one-claude "Claude Cowork and chat are one Claude")
* [![](https://downloads.intercomcdn.com/i/hc/icons/v3/lupk8zyo/938306/369fee943d6bccaf717f37dc2f67/141413.svg)Claude Code](https://support.claude.com/en/collections/14445694-claude-code "Claude Code")

  + [Claude Code model configuration](https://support.claude.com/en/articles/11940350-claude-code-model-configuration "Claude Code model configuration")
  + [Use Claude Code with your Pro or Max plan](https://support.claude.com/en/articles/11145838-use-claude-code-with-your-pro-or-max-plan "Use Claude Code with your Pro or Max plan")
  + [Automated Security Reviews in Claude Code](https://support.claude.com/en/articles/11932705-automated-security-reviews-in-claude-code "Automated Security Reviews in Claude Code")
  + [Use Claude Code with your Team or Enterprise plan](https://support.claude.com/en/articles/11845131-use-claude-code-with-your-team-or-enterprise-plan "Use Claude Code with your Team or Enterprise plan")
  + [Claude Code usage analytics](https://support.claude.com/en/articles/12157520-claude-code-usage-analytics "Claude Code usage analytics")
  + [Manage API key environment variables in Claude Code](https://support.claude.com/en/articles/12304248-manage-api-key-environment-variables-in-claude-code "Manage API key environment variables in Claude Code")
  + [Claude Code FAQ](https://support.claude.com/en/articles/12386420-claude-code-faq "Claude Code FAQ")
  + [Claude Code on the web](https://support.claude.com/en/articles/12618689-claude-code-on-the-web "Claude Code on the web")
  + [Set up Code Review for Claude Code](https://support.claude.com/en/articles/14233555-set-up-code-review-for-claude-code "Set up Code Review for Claude Code")
  + [Use Claude Code CLI with a screen reader](https://support.claude.com/en/articles/15924927-use-claude-code-cli-with-a-screen-reader "Use Claude Code CLI with a screen reader")
  + [Launch guides](https://support.claude.com/en/collections/19407739-launch-guides "Launch guides")

    - [Your first day in Claude Code](https://support.claude.com/en/articles/14552382-your-first-day-in-claude-code "Your first day in Claude Code")
    - [Models, usage, and limits in Claude Code](https://support.claude.com/en/articles/14552983-models-usage-and-limits-in-claude-code "Models, usage, and limits in Claude Code")
    - [Troubleshoot Claude Code installation and authentication](https://support.claude.com/en/articles/14552646-troubleshoot-claude-code-installation-and-authentication "Troubleshoot Claude Code installation and authentication")
    - [Give Claude context: CLAUDE.md and better prompts](https://support.claude.com/en/articles/14553240-give-claude-context-claude-md-and-better-prompts "Give Claude context: CLAUDE.md and better prompts")
    - [Claude Code cheatsheet](https://support.claude.com/en/articles/14553413-claude-code-cheatsheet "Claude Code cheatsheet")
    - [Claude Code user FAQ](https://support.claude.com/en/articles/14554922-claude-code-user-faq "Claude Code user FAQ")
    - [Claude Code power user tips](https://support.claude.com/en/articles/14554000-claude-code-power-user-tips "Claude Code power user tips")
    - [Claude Code: Common developer use cases](https://support.claude.com/en/articles/14553517-claude-code-common-developer-use-cases "Claude Code: Common developer use cases")
    - [Claude Code communications kit](https://support.claude.com/en/articles/14555877-claude-code-communications-kit "Claude Code communications kit")
    - [Claude Code champion kit](https://support.claude.com/en/articles/14555399-claude-code-champion-kit "Claude Code champion kit")
* [![](https://downloads.intercomcdn.com/i/hc/icons/v3/lupk8zyo/938307/fa132ef7a8309dae7de43cfb255a/141413.svg)Claude Desktop](https://support.claude.com/en/collections/16163169-claude-desktop "Claude Desktop")

  + [General](https://support.claude.com/en/collections/17879568-general "General")

    - [Install Claude Desktop](https://support.claude.com/en/articles/10065433-install-claude-desktop "Install Claude Desktop")
    - [Deploy Claude Desktop for Windows](https://support.claude.com/en/articles/12622703-deploy-claude-desktop-for-windows "Deploy Claude Desktop for Windows")
    - [Deploy Claude Desktop for macOS](https://support.claude.com/en/articles/12611117-deploy-claude-desktop-for-macos "Deploy Claude Desktop for macOS")
    - [Enterprise configuration for Claude Desktop](https://support.claude.com/en/articles/12622667-enterprise-configuration-for-claude-desktop "Enterprise configuration for Claude Desktop")
    - [Use quick entry with Claude Desktop on Mac](https://support.claude.com/en/articles/12626668-use-quick-entry-with-claude-desktop-on-mac "Use quick entry with Claude Desktop on Mac")
    - [Open Claude Desktop with a link](https://support.claude.com/en/articles/14729294-open-claude-desktop-with-a-link "Open Claude Desktop with a link")
  + [Desktop extensions](https://support.claude.com/en/collections/17879657-desktop-extensions "Desktop extensions")

    - [Enabling and using the desktop extension allowlist](https://support.claude.com/en/articles/12592343-enabling-and-using-the-desktop-extension-allowlist "Enabling and using the desktop extension allowlist")
    - [Deploying enterprise-grade MCP servers with desktop extensions](https://support.claude.com/en/articles/12702546-deploying-enterprise-grade-mcp-servers-with-desktop-extensions "Deploying enterprise-grade MCP servers with desktop extensions")
    - [Getting Started with Local MCP Servers on Claude Desktop](https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop "Getting Started with Local MCP Servers on Claude Desktop")
* [![](https://downloads.intercomcdn.com/i/hc/icons/v3/lupk8zyo/938308/b28bba196793ef62db6f92187ce8/141413.svg)Claude Mobile apps](https://support.claude.com/en/collections/9387080-claude-mobile-apps "Claude Mobile apps")

  + [General](https://support.claude.com/en/collections/10788716-general "General")

    - [Use dictation on Claude Mobile](https://support.claude.com/en/articles/10065434-use-dictation-on-claude-mobile "Use dictation on Claude Mobile")
    - [Use voice mode](https://support.claude.com/en/articles/11101966-use-voice-mode "Use voice mode")
    - [Minimum age requirement access restriction](https://support.claude.com/en/articles/13117299-minimum-age-requirement-access-restriction "Minimum age requirement access restriction")
    - [Open the Claude mobile app with a link](https://support.claude.com/en/articles/14898120-open-the-claude-mobile-app-with-a-link "Open the Claude mobile app with a link")
  + [Claude for iOS](https://support.claude.com/en/collections/9879000-claude-for-ios "Claude for iOS")

    - [Install Claude for iOS](https://support.claude.com/en/articles/9266462-install-claude-for-ios "Install Claude for iOS")
    - [How do I sign up for Claude Pro on the Claude app for iOS?](https://support.claude.com/en/articles/9266495-how-do-i-sign-up-for-claude-pro-on-the-claude-app-for-ios "How do I sign up for Claude Pro on the Claude app for iOS?")
    - [Use Claude app intents, shortcuts, and widgets on iOS](https://support.claude.com/en/articles/10263469-use-claude-app-intents-shortcuts-and-widgets-on-ios "Use Claude app intents, shortcuts, and widgets on iOS")
    - [Access Claude for iOS on your Lock Screen, Control Center, and Action button](https://support.claude.com/en/articles/10302511-access-claude-for-ios-on-your-lock-screen-control-center-and-action-button "Access Claude for iOS on your Lock Screen, Control Center, and Action button")
    - [How to update Claude for iOS](https://support.claude.com/en/articles/11825384-how-to-update-claude-for-ios "How to update Claude for iOS")
    - [Use Claude with iOS apps](https://support.claude.com/en/articles/11869619-use-claude-with-ios-apps "Use Claude with iOS apps")
  + [Claude for Android](https://support.claude.com/en/collections/9879004-claude-for-android "Claude for Android")

    - [Install Claude for Android](https://support.claude.com/en/articles/9612887-install-claude-for-android "Install Claude for Android")
    - [How do I sign up for Claude Pro on Claude for Android?](https://support.claude.com/en/articles/9612892-how-do-i-sign-up-for-claude-pro-on-claude-for-android "How do I sign up for Claude Pro on Claude for Android?")
    - [Use the Claude widget on Android](https://support.claude.com/en/articles/10534883-use-the-claude-widget-on-android "Use the Claude widget on Android")
    - [How to update Claude for Android](https://support.claude.com/en/articles/11825394-how-to-update-claude-for-android "How to update Claude for Android")
    - [Use Claude with Android apps](https://support.claude.com/en/articles/11869629-use-claude-with-android-apps "Use Claude with Android apps")
* [![](https://downloads.intercomcdn.com/i/hc/icons/v3/lupk8zyo/938309/4becad479ed9755dc0a561a64e19/141413.svg)Claude API and Console](https://support.claude.com/en/collections/5370014-claude-api-and-console "Claude API and Console")

  + [Use the Claude API and Console](https://support.claude.com/en/collections/9811457-use-the-claude-api-and-console "Use the Claude API and Console")

    - [How can I access the Claude API?](https://support.claude.com/en/articles/8114521-how-can-i-access-the-claude-api "How can I access the Claude API?")
    - [Where is the Claude API supported?](https://support.claude.com/en/articles/8116515-where-is-the-claude-api-supported "Where is the Claude API supported?")
    - [Log in to your Console account](https://support.claude.com/en/articles/13371040-log-in-to-your-console-account "Log in to your Console account")
    - [I created a Claude Console organization - how do I start using the Claude API?](https://support.claude.com/en/articles/8114531-i-created-a-claude-console-organization-how-do-i-start-using-the-claude-api "I created a Claude Console organization - how do I start using the Claude API?")
    - [How do I use the playground?](https://support.claude.com/en/articles/8606378-how-do-i-use-the-playground "How do I use the playground?")
    - [Cost and Usage Reporting in the Claude Console](https://support.claude.com/en/articles/9534590-cost-and-usage-reporting-in-the-claude-console "Cost and Usage Reporting in the Claude Console")
    - [Creating and managing Workspaces in the Claude Console](https://support.claude.com/en/articles/9796807-creating-and-managing-workspaces-in-the-claude-console "Creating and managing Workspaces in the Claude Console")
    - [I have a paid Claude subscription (Pro, Max, Team, or Enterprise plans). Why do I have to pay separately to use the Claude API and Console?](https://support.claude.com/en/articles/9876003-i-have-a-paid-claude-subscription-pro-max-team-or-enterprise-plans-why-do-i-have-to-pay-separately-to-use-the-claude-api-and-console "I have a paid Claude subscription (Pro, Max, Team, or Enterprise plans). Why do I have to pay separately to use the Claude API and Console?")
    - [Claude Console roles and permissions](https://support.claude.com/en/articles/10186004-claude-console-roles-and-permissions "Claude Console roles and permissions")
    - [Manage user feedback settings on Claude Console](https://support.claude.com/en/articles/10504853-manage-user-feedback-settings-on-claude-console "Manage user feedback settings on Claude Console")
    - [About the Development Partner Program](https://support.claude.com/en/articles/11174108-about-the-development-partner-program "About the Development Partner Program")
    - [Anthropic's AI for Science Program](https://support.claude.com/en/articles/11199177-anthropic-s-ai-for-science-program "Anthropic's AI for Science Program")
    - [Customizing your Console appearance settings](https://support.claude.com/en/articles/13346458-customizing-your-console-appearance-settings "Customizing your Console appearance settings")
    - [Inviting members to the Claude Console](https://support.claude.com/en/articles/13443764-inviting-members-to-the-claude-console "Inviting members to the Claude Console")
    - [Find and join a Console organization](https://support.claude.com/en/articles/14793921-find-and-join-a-console-organization "Find and join a Console organization")
    - [Assign a program to workspaces in Claude Console](https://support.claude.com/en/articles/16764810-assign-a-program-to-workspaces-in-claude-console "Assign a program to workspaces in Claude Console")
    - [Turn on data retention for a Workspace in a zero data retention organization](https://support.claude.com/en/articles/16824617-turn-on-data-retention-for-a-workspace-in-a-zero-data-retention-organization "Turn on data retention for a Workspace in a zero data retention organization")
  + [Claude API usage and best practices](https://support.claude.com/en/collections/9811458-claude-api-usage-and-best-practices "Claude API usage and best practices")

    - [Our approach to rate limits for the Claude API](https://support.claude.com/en/articles/8243635-our-approach-to-rate-limits-for-the-claude-api "Our approach to rate limits for the Claude API")
    - [I’m planning to launch a product using the Claude API. What steps should I take to ensure I’m not violating Anthropic’s Usage Policy?](https://support.claude.com/en/articles/8241216-i-m-planning-to-launch-a-product-using-the-claude-api-what-steps-should-i-take-to-ensure-i-m-not-violating-anthropic-s-usage-policy "I’m planning to launch a product using the Claude API. What steps should I take to ensure I’m not violating Anthropic’s Usage Policy?")
    - [What should I do if I suspect my API key has been compromised?](https://support.claude.com/en/articles/8384961-what-should-i-do-if-i-suspect-my-api-key-has-been-compromised "What should I do if I suspect my API key has been compromised?")
    - [I’ve been using other large language models (LLMs) to power my product. How should I alter my prompts when switching to Claude?](https://support.claude.com/en/articles/8114533-i-ve-been-using-other-large-language-models-llms-to-power-my-product-how-should-i-alter-my-prompts-when-switching-to-claude "I’ve been using other large language models (LLMs) to power my product. How should I alter my prompts when switching to Claude?")
    - [API Key Best Practices: Keeping Your Keys Safe and Secure](https://support.claude.com/en/articles/9767949-api-key-best-practices-keeping-your-keys-safe-and-secure "API Key Best Practices: Keeping Your Keys Safe and Secure")
    - [How can I get higher rate limits on the Claude API?](https://support.claude.com/en/articles/10366389-how-can-i-get-higher-rate-limits-on-the-claude-api "How can I get higher rate limits on the Claude API?")
  + [Pricing and billing](https://support.claude.com/en/collections/9811459-pricing-and-billing "Pricing and billing")

    - [How do I pay for my Claude API usage?](https://support.claude.com/en/articles/8977456-how-do-i-pay-for-my-claude-api-usage "How do I pay for my Claude API usage?")
    - [How can I learn more about Claude API pricing?](https://support.claude.com/en/articles/8114523-how-can-i-learn-more-about-claude-api-pricing "How can I learn more about Claude API pricing?")
    - [Add or update your Claude Console organization's tax or VAT ID](https://support.claude.com/en/articles/9889428-add-or-update-your-claude-console-organization-s-tax-or-vat-id "Add or update your Claude Console organization's tax or VAT ID")
    - [Understanding your Claude API invoices](https://support.claude.com/en/articles/16608069-understanding-your-claude-api-invoices "Understanding your Claude API invoices")
  + [API troubleshooting](https://support.claude.com/en/collections/9811460-api-troubleshooting "API troubleshooting")

    - [Where can I find your API documentation?](https://support.claude.com/en/articles/8114490-where-can-i-find-your-api-documentation "Where can I find your API documentation?")
    - [I’m encountering 429 errors, and I’m worried my rate limit is too low. What should I do?](https://support.claude.com/en/articles/8114527-i-m-encountering-429-errors-and-i-m-worried-my-rate-limit-is-too-low-what-should-i-do "I’m encountering 429 errors, and I’m worried my rate limit is too low. What should I do?")
    - [Where can I go for Claude API support and assistance?](https://support.claude.com/en/articles/8114535-where-can-i-go-for-claude-api-support-and-assistance "Where can I go for Claude API support and assistance?")
    - [I'm getting an API connection error. How can I fix it?](https://support.claude.com/en/articles/10366432-i-m-getting-an-api-connection-error-how-can-i-fix-it "I'm getting an API connection error. How can I fix it?")
    - [How can I check connectivity to the Claude API?](https://support.claude.com/en/articles/13403291-how-can-i-check-connectivity-to-the-claude-api "How can I check connectivity to the Claude API?")
  + [API FAQ](https://support.claude.com/en/collections/9811463-api-faq "API FAQ")

    - [Can I have a Claude account and a Console account?](https://support.claude.com/en/articles/8987223-can-i-have-a-claude-account-and-a-console-account "Can I have a Claude account and a Console account?")
    - [Can I use the Claude API for individual use?](https://support.claude.com/en/articles/8987200-can-i-use-the-claude-api-for-individual-use "Can I use the Claude API for individual use?")
    - [What is the External Researcher Access Program?](https://support.claude.com/en/articles/9125743-what-is-the-external-researcher-access-program "What is the External Researcher Access Program?")
    - [How can I delete my Claude Console account?](https://support.claude.com/en/articles/10366376-how-can-i-delete-my-claude-console-account "How can I delete my Claude Console account?")
  + [API prompt design](https://support.claude.com/en/collections/4078533-api-prompt-design "API prompt design")

    - [Introduction to prompt design](https://support.claude.com/en/articles/7996853-introduction-to-prompt-design "Introduction to prompt design")
    - [Claude’s response to my prompt is too brief.](https://support.claude.com/en/articles/8114518-claude-s-response-to-my-prompt-is-too-brief "Claude’s response to my prompt is too brief.")
    - [My prompt isn’t giving me a helpful answer.](https://support.claude.com/en/articles/7996857-my-prompt-isn-t-giving-me-a-helpful-answer "My prompt isn’t giving me a helpful answer.")
  + [API and distillation](https://support.claude.com/en/collections/19737224-api-and-distillation "API and distillation")

    - [Preserved thinking: changing how the Messages API handles thinking blocks to protect against distillation](https://support.claude.com/en/articles/16761192-preserved-thinking-changing-how-the-messages-api-handles-thinking-blocks-to-protect-against-distillation "Preserved thinking: changing how the Messages API handles thinking blocks to protect against distillation")
* [![](https://downloads.intercomcdn.com/i/hc/icons/v3/lupk8zyo/938310/fc1b2b288ad56a87197b85e8d8bc/141413.svg)Connectors](https://support.claude.com/en/collections/15399129-connectors "Connectors")

  + [General](https://support.claude.com/en/collections/17879426-general "General")

    - [Use connectors to extend Claude's capabilities](https://support.claude.com/en/articles/11176164-use-connectors-to-extend-claude-s-capabilities "Use connectors to extend Claude's capabilities")
    - [When to use desktop and web connectors](https://support.claude.com/en/articles/11725091-when-to-use-desktop-and-web-connectors "When to use desktop and web connectors")
    - [Manage Claude’s tool access](https://support.claude.com/en/articles/13730515-manage-claude-s-tool-access "Manage Claude’s tool access")
    - [Anthropic Connectors Directory FAQ](https://support.claude.com/en/articles/11596036-anthropic-connectors-directory-faq "Anthropic Connectors Directory FAQ")
    - [Anthropic Software Directory Policy](https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy "Anthropic Software Directory Policy")
    - [Anthropic Software Directory Terms](https://support.claude.com/en/articles/13145338-anthropic-software-directory-terms "Anthropic Software Directory Terms")
    - [How Claude suggests connected apps](https://support.claude.com/en/articles/14730684-how-claude-suggests-connected-apps "How Claude suggests connected apps")
    - [Authorize MCP connectors for your entire organization](https://support.claude.com/en/articles/15537633-authorize-mcp-connectors-for-your-entire-organization "Authorize MCP connectors for your entire organization")
  + [Pre-Built Connectors](https://support.claude.com/en/collections/17879307-pre-built-connectors "Pre-Built Connectors")

    - [Use Google Workspace connectors](https://support.claude.com/en/articles/10166901-use-google-workspace-connectors "Use Google Workspace connectors")
    - [Use the GitHub integration](https://support.claude.com/en/articles/10167454-use-the-github-integration "Use the GitHub integration")
    - [Connect to Microsoft 365](https://support.claude.com/en/articles/15183774-connect-to-microsoft-365 "Connect to Microsoft 365")
    - [Set up the Microsoft 365 connector](https://support.claude.com/en/articles/12542951-set-up-the-microsoft-365-connector "Set up the Microsoft 365 connector")
    - [Microsoft 365 connector security guide](https://support.claude.com/en/articles/12684923-microsoft-365-connector-security-guide "Microsoft 365 connector security guide")
    - [Use interactive connectors in Claude](https://support.claude.com/en/articles/13454812-use-interactive-connectors-in-claude "Use interactive connectors in Claude")
    - [Get started with 1Password for Claude](https://support.claude.com/en/articles/15936181-get-started-with-1password-for-claude "Get started with 1Password for Claude")
  + [Custom Connectors](https://support.claude.com/en/collections/17879441-custom-connectors "Custom Connectors")

    - [Get started with custom connectors using remote MCP](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp "Get started with custom connectors using remote MCP")
* [![](https://downloads.intercomcdn.com/i/hc/icons/v3/lupk8zyo/938311/0ed8318ca7ceb7754cad55808a88/141413.svg)Claude in Chrome](https://support.claude.com/en/collections/18031491-claude-in-chrome "Claude in Chrome")

  + [Get started with Claude in Chrome](https://support.claude.com/en/articles/12012173-get-started-with-claude-in-chrome "Get started with Claude in Chrome")
  + [Claude in Chrome permissions guide](https://support.claude.com/en/articles/12902446-claude-in-chrome-permissions-guide "Claude in Chrome permissions guide")
  + [Use Claude in Chrome safely](https://support.claude.com/en/articles/12902428-use-claude-in-chrome-safely "Use Claude in Chrome safely")
  + [Claude in Chrome admin controls](https://support.claude.com/en/articles/13065128-claude-in-chrome-admin-controls "Claude in Chrome admin controls")
  + [Claude in Chrome troubleshooting](https://support.claude.com/en/articles/12902405-claude-in-chrome-troubleshooting "Claude in Chrome troubleshooting")
* [![](https://downloads.intercomcdn.com/i/hc/icons/v3/lupk8zyo/938314/acd6815491163db4c65734007fac/141413.svg)Claude for Education](https://support.claude.com/en/collections/12630177-claude-for-education "Claude for Education")

  + [Get started with Claude for Education at your university (for Owners/Admins)](https://support.claude.com/en/articles/11139094-get-started-with-claude-for-education-at-your-university-for-owners-admins "Get started with Claude for Education at your university (for Owners/Admins)")
  + [Use Claude for Education at your university](https://support.claude.com/en/articles/11139144-use-claude-for-education-at-your-university "Use Claude for Education at your university")
  + [Set up the Claude LTI in Canvas by Instructure](https://support.claude.com/en/articles/11725453-set-up-the-claude-lti-in-canvas-by-instructure "Set up the Claude LTI in Canvas by Instructure")
  + [Who owns and manages the data of my Claude for Education account?](https://support.claude.com/en/articles/11732894-who-owns-and-manages-the-data-of-my-claude-for-education-account "Who owns and manages the data of my Claude for Education account?")
* [![](https://downloads.intercomcdn.com/i/hc/icons/v3/lupk8zyo/938313/7688fef0ae55bbeb469de0fa7556/141413.svg)Privacy and legal](https://support.claude.com/en/collections/4078534-privacy-and-legal "Privacy and legal")

  + [Where can I learn more about Anthropic's Privacy practices?](https://support.claude.com/en/articles/10035659-where-can-i-learn-more-about-anthropic-s-privacy-practices "Where can I learn more about Anthropic's Privacy practices?")
  + [Business Associate Agreements (BAA) for Commercial Customers](https://support.claude.com/en/articles/8114513-business-associate-agreements-baa-for-commercial-customers "Business Associate Agreements (BAA) for Commercial Customers")
  + [What Certifications has Anthropic obtained?](https://support.claude.com/en/articles/10015870-what-certifications-has-anthropic-obtained "What Certifications has Anthropic obtained?")
  + [What is Anthropic’s policy for handling governmental requests for user information?](https://support.claude.com/en/articles/9519291-what-is-anthropic-s-policy-for-handling-governmental-requests-for-user-information "What is Anthropic’s policy for handling governmental requests for user information?")
  + [Why am I receiving an 'Output blocked by content filtering policy' error?](https://support.claude.com/en/articles/9205721-why-am-i-receiving-an-output-blocked-by-content-filtering-policy-error "Why am I receiving an 'Output blocked by content filtering policy' error?")
  + [I think a user is infringing my copyright or other intellectual property. How do I report it?](https://support.claude.com/en/articles/10023646-i-think-a-user-is-infringing-my-copyright-or-other-intellectual-property-how-do-i-report-it "I think a user is infringing my copyright or other intellectual property. How do I report it?")
  + [How do I view and sign your Data Processing Addendum (DPA)?](https://support.claude.com/en/articles/7996862-how-do-i-view-and-sign-your-data-processing-addendum-dpa "How do I view and sign your Data Processing Addendum (DPA)?")
  + [Why am I receiving an 'Output blocked by content filtering policy' error?](https://support.claude.com/en/articles/10023638-why-am-i-receiving-an-output-blocked-by-content-filtering-policy-error "Why am I receiving an 'Output blocked by content filtering policy' error?")
  + [Updates to our Acceptable Use Policy (now “Usage Policy”), Consumer Terms of Service, and Privacy Policy](https://support.claude.com/en/articles/9301722-updates-to-our-acceptable-use-policy-now-usage-policy-consumer-terms-of-service-and-privacy-policy "Updates to our Acceptable Use Policy (now “Usage Policy”), Consumer Terms of Service, and Privacy Policy")
  + [Consumer Terms of Service Updates](https://support.claude.com/en/articles/9264813-consumer-terms-of-service-updates "Consumer Terms of Service Updates")
  + [Terms of Service Updates](https://support.claude.com/en/articles/9190861-terms-of-service-updates "Terms of Service Updates")
  + [Official Anthropic marketing email addresses](https://support.claude.com/en/articles/10416553-official-anthropic-marketing-email-addresses "Official Anthropic marketing email addresses")
  + [Report, block, and remove content from Claude](https://support.claude.com/en/articles/10684638-report-block-and-remove-content-from-claude "Report, block, and remove content from Claude")
  + [Does Anthropic crawl data from the web, and how can site owners block the crawler?](https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler "Does Anthropic crawl data from the web, and how can site owners block the crawler?")
  + [Online Safety Contacts](https://support.claude.com/en/articles/11174660-online-safety-contacts "Online Safety Contacts")
  + [Claude 4 Invite Sweepstakes Official Rules](https://support.claude.com/en/articles/11140763-claude-4-invite-sweepstakes-official-rules "Claude 4 Invite Sweepstakes Official Rules")
  + [Designated point of contact for users in the EU](https://support.claude.com/en/articles/11595103-designated-point-of-contact-for-users-in-the-eu "Designated point of contact for users in the EU")
  + [Can I use my Outputs to train an AI model?](https://support.claude.com/en/articles/12326764-can-i-use-my-outputs-to-train-an-ai-model "Can I use my Outputs to train an AI model?")
  + [Report a concern: Australian DIS Standard compliance](https://support.claude.com/en/articles/12335811-report-a-concern-australian-dis-standard-compliance "Report a concern: Australian DIS Standard compliance")
  + [Unauthorized Anthropic stock sales and investment scams](https://support.claude.com/en/articles/13704655-unauthorized-anthropic-stock-sales-and-investment-scams "Unauthorized Anthropic stock sales and investment scams")
  + [Covered Models](https://support.claude.com/en/articles/15425695-covered-models "Covered Models")
  + [Covered Models under a Business Associate Agreement (BAA)](https://support.claude.com/en/articles/15455031-covered-models-under-a-business-associate-agreement-baa "Covered Models under a Business Associate Agreement (BAA)")
  + [Using Claude for Legal Work: Privilege, Confidentiality, and How to Think About Configuration](https://support.claude.com/en/articles/15707726-using-claude-for-legal-work-privilege-confidentiality-and-how-to-think-about-configuration "Using Claude for Legal Work: Privilege, Confidentiality, and How to Think About Configuration")
  + [Claude for Teachers: your data and our terms](https://support.claude.com/en/articles/15926041-claude-for-teachers-your-data-and-our-terms "Claude for Teachers: your data and our terms")
  + [How Claude marks AI-generated content](https://support.claude.com/en/articles/16266773-how-claude-marks-ai-generated-content "How Claude marks AI-generated content")
* [![](https://downloads.intercomcdn.com/i/hc/icons/v3/lupk8zyo/938315/93439536bbfa052d2e231211d48c/141413.svg)Safeguards](https://support.claude.com/en/collections/4078535-safeguards "Safeguards")

  + [Our Approach to User Safety](https://support.claude.com/en/articles/8106465-our-approach-to-user-safety "Our Approach to User Safety")
  + [Exceptions to our Usage Policy](https://support.claude.com/en/articles/9528712-exceptions-to-our-usage-policy "Exceptions to our Usage Policy")
  + [Safeguards warnings and appeals](https://support.claude.com/en/articles/8241253-safeguards-warnings-and-appeals "Safeguards warnings and appeals")
  + [API Safeguards Tools](https://support.claude.com/en/articles/9199617-api-safeguards-tools "API Safeguards Tools")
  + [Law Enforcement Requests](https://support.claude.com/en/articles/9035075-law-enforcement-requests "Law Enforcement Requests")
  + [Responsible Use of Anthropic's Models: Guidelines for Organizations Serving Minors](https://support.claude.com/en/articles/9307344-responsible-use-of-anthropic-s-models-guidelines-for-organizations-serving-minors "Responsible Use of Anthropic's Models: Guidelines for Organizations Serving Minors")
  + [Report, block, and remove content from Claude](https://support.claude.com/en/articles/7996906-report-block-and-remove-content-from-claude "Report, block, and remove content from Claude")
  + [CSAM Detection and Reporting](https://support.claude.com/en/articles/9020328-csam-detection-and-reporting "CSAM Detection and Reporting")
  + [Public Vulnerability Reporting](https://support.claude.com/en/articles/11427875-public-vulnerability-reporting "Public Vulnerability Reporting")
  + [Using Agents According to Our Usage Policy](https://support.claude.com/en/articles/12005017-using-agents-according-to-our-usage-policy "Using Agents According to Our Usage Policy")
  + [Creating a new account after deletion](https://support.claude.com/en/articles/12109679-creating-a-new-account-after-deletion "Creating a new account after deletion")
  + [Model Safety Bug Bounty Program](https://support.claude.com/en/articles/12119250-model-safety-bug-bounty-program "Model Safety Bug Bounty Program")
  + [Crisis Helpline Support in Claude](https://support.claude.com/en/articles/13171706-crisis-helpline-support-in-claude "Crisis Helpline Support in Claude")
  + [Identity verification on Claude](https://support.claude.com/en/articles/14328960-identity-verification-on-claude "Identity verification on Claude")
  + [Real-time cyber safeguards on Claude Opus and Sonnet](https://support.claude.com/en/articles/14604842-real-time-cyber-safeguards-on-claude-opus-and-sonnet "Real-time cyber safeguards on Claude Opus and Sonnet")
  + [Age assurance on Claude](https://support.claude.com/en/articles/15171100-age-assurance-on-claude "Age assurance on Claude")
  + [Child safety guidance for developers](https://support.claude.com/en/articles/15591275-child-safety-guidance-for-developers "Child safety guidance for developers")
* [![](https://downloads.intercomcdn.com/i/hc/icons/v3/lupk8zyo/938316/868fe8577ba4ba9e65d00791433e/141413.svg)Amazon Bedrock](https://support.claude.com/en/collections/4078537-amazon-bedrock "Amazon Bedrock")

  + [What is Amazon Bedrock?](https://support.claude.com/en/articles/7996918-what-is-amazon-bedrock "What is Amazon Bedrock?")
  + [How do I get access to Claude in Amazon Bedrock?](https://support.claude.com/en/articles/7996920-how-do-i-get-access-to-claude-in-amazon-bedrock "How do I get access to Claude in Amazon Bedrock?")
  + [I use Claude in Amazon Bedrock. Who do I contact for customer support inquiries?](https://support.claude.com/en/articles/7996921-i-use-claude-in-amazon-bedrock-who-do-i-contact-for-customer-support-inquiries "I use Claude in Amazon Bedrock. Who do I contact for customer support inquiries?")
  + [How do I learn more about Amazon and Anthropic’s strategic collaboration?](https://support.claude.com/en/articles/10280779-how-do-i-learn-more-about-amazon-and-anthropic-s-strategic-collaboration "How do I learn more about Amazon and Anthropic’s strategic collaboration?")
  + [Where do I find Claude in Amazon Bedrock documentation?](https://support.claude.com/en/articles/10280783-where-do-i-find-claude-in-amazon-bedrock-documentation "Where do I find Claude in Amazon Bedrock documentation?")
  + [What AWS Regions are Claude models available in Amazon Bedrock?](https://support.claude.com/en/articles/10280791-what-aws-regions-are-claude-models-available-in-amazon-bedrock "What AWS Regions are Claude models available in Amazon Bedrock?")
* [![](https://downloads.intercomcdn.com/i/hc/icons/v3/lupk8zyo/938317/8a5deb1c9407189630bfc224d12f/141413.svg)Claude for Government](https://support.claude.com/en/collections/19395194-claude-for-government "Claude for Government")

  + [Get started with Claude for Government](https://support.claude.com/en/articles/14503590-get-started-with-claude-for-government "Get started with Claude for Government")
  + [SSO login](https://support.claude.com/en/articles/14503613-sso-login "SSO login")
  + [Set up SCIM in Claude for Government](https://support.claude.com/en/articles/14503643-set-up-scim-in-claude-for-government "Set up SCIM in Claude for Government")
  + [Organization instructions in Claude for Government](https://support.claude.com/en/articles/14503675-organization-instructions-in-claude-for-government "Organization instructions in Claude for Government")
  + [MCP connectors](https://support.claude.com/en/articles/14503689-mcp-connectors "MCP connectors")
  + [MCP: Individual connectors](https://support.claude.com/en/articles/14503703-mcp-individual-connectors "MCP: Individual connectors")
  + [MCP: Web Search](https://support.claude.com/en/articles/14503775-mcp-web-search "MCP: Web Search")
  + [Model availability in Claude for Government](https://support.claude.com/en/articles/14503794-model-availability-in-claude-for-government "Model availability in Claude for Government")
  + [Classification banner in Claude for Government](https://support.claude.com/en/articles/14503804-classification-banner-in-claude-for-government "Classification banner in Claude for Government")

[All Collections](/en/)[Claude API and Console](https://support.claude.com/en/collections/5370014-claude-api-and-console)[API and distillation](https://support.claude.com/en/collections/19737224-api-and-distillation)Preserved thinking: changing how the Messages API handles thinking blocks to protect against distillation

# Preserved thinking: changing how the Messages API handles thinking blocks to protect against distillation

Updated this week

Copy for LLM

We're changing how the Messages API handles thinking blocks to protect against distillation. A thinking block is a record of the reasoning Claude may produce while working on a response. On Claude Fable 5.1 and Claude Opus 5.5, new API accounts can no longer edit the context around a thinking block, such as the messages, tools, or system prompt, during a multi-turn conversation. We’ll expand the rollout to all users with upcoming model launches.

Modifying this prior context has legitimate applications, which we continue to support using the adjustments outlined below. However, such modifications are also a common and **[publicly documented technique](https://arxiv.org/abs/2608.09867)** for industrial-scale illicit distillation, which is prohibited by our **[Usage Policy](https://www.anthropic.com/legal/aup)** and Terms of Service.

Now, the API will now verify that a thinking block is sent back with the same system prompt, tools, and messages that produced it, and will return an error if they don't match. In order for modified requests to succeed, developers may opt-in to instead have the thinking blocks *removed* from such requests; the model will respond without seeing the thinking block.

In this article, we share details on why we're doing this and the adjustments you can make to minimize disruption.

## What are thinking blocks?

Claude produces reasoning steps before providing its final answer. On the API, these are returned to the user as "thinking blocks." In a multi-turn conversation, API users send these blocks back with each exchange (along with the system prompt, tools, and earlier messages), so that Claude has full conversational context.

## What’s changing?

For affected accounts using the models listed below, the API will return an error if the system prompt, tools, or messages preceding a prior thinking block have been modified.

To avoid an error message, you may opt into "non-strict" mode. In this mode, the request will go through, but the affected thinking blocks will be dropped from what the model sees. This allows you to continue your conversation or task uninterrupted despite the prior turns’ thinking not being shown to the model. When this happens, the API response will tell you which blocks were dropped.

## Why are we making this change?

Altering the earlier turns of a conversation is a **[common technique](https://arxiv.org/abs/2608.09867)** used in illicit distillation campaigns, which aim to extract the capabilities of advanced models—especially thinking—to train another model, without authorization. Distillation is often employed on an industrial scale, using thousands of fake accounts. We encrypt Claude's thinking blocks to prevent this, but by editing the conversation before a thinking block, a user could get Claude to decrypt and print its reasoning. Systems trained this way can inherit capabilities they wouldn’t otherwise have, *without* inheriting the safeguards that we've built to prevent a broad range of misuse like cyberattacks and weapons development.

This change aims to make distillation campaigns more difficult to execute. It builds on existing anti-distillation measures like **[enhanced distillation classifiers](https://www.anthropic.com/research/next-generation-constitutional-classifiers)** and restrictions on transferring sessions or reasoning from more advanced models to less capable models with weaker safeguards.

## What does this mean for API integrations?

Certain integrations—particularly those that involve rewriting earlier turns mid-conversation, like context compaction, injected system reminders, or changing tools mid-session—may need adjustment.

Here are the resources to help guide you through this update:

* The **[preserved thinking documentation](https://platform.claude.com/docs/en/build-with-claude/preserved-thinking)** covers where the change applies, how to check whether your integration is affected, and **[how to make common edits](https://platform.claude.com/docs/en/build-with-claude/preserved-thinking#replace-prefix-edits)** without breaking preserved thinking.
* **[Compaction](https://platform.claude.com/docs/en/build-with-claude/compaction)** (beta) can summarize older turns while keeping the most recent turns word for word, and can build the summary in the background while your agent keeps working. It replaces client-side compaction, which is likely the most common reason integrations need to change.
* **[Mid-conversation tool changes](https://platform.claude.com/docs/en/build-with-claude/mid-conversation-system-messages#mid-conversation-tool-changes)** (beta) let you add or remove tools during a conversation without editing earlier turns.
* Our **[migration guides](https://platform.claude.com/docs/en/about-claude/models/migration-guide)** have a full checklist for moving to each model.

Check each page for availability on Amazon Bedrock, Google Cloud Vertex AI, and Microsoft Foundry.

If the guidance above doesn't cover your use case, please **[reach out to our support team](https://support.claude.com/en/articles/9015913)**. If you work with an account team, you can also reach out to them for support with updating more complex integrations.

There are additional benefits to keeping thinking blocks consistent: it means that the API can reuse cached prompts more often, which reduces costs and response time.

## Who will this impact?

Preserved thinking applies to these models and accounts:

|  |  |  |
| --- | --- | --- |
| **Model** | **API accounts created on or after August 31, 2026 (00:00 UTC)** | **Accounts created before then** |
| Claude Fable 5.1 | Applies | Doesn't apply |
| Claude Opus 5.5 | Applies | Doesn't apply |

This covers Claude Platform organizations, Amazon Bedrock accounts, Google Cloud Vertex AI projects, and Microsoft Foundry projects.

We're taking a phased approach to enforcement, starting with new accounts, where we see the highest concentration of distillation-related abuse. This gives developers with existing accounts time to make their harnesses and integrations compatible.

If you use Claude Code, Claude Cowork, or Claude.ai, there's nothing you need to change; those products handle thinking blocks for you.

Did this answer your question?

Disappointed ReactionNeutral ReactionSmiley Reaction

## Related Articles

* [How large is the context window on paid Claude plans?](https://support.claude.com/en/articles/8606394-how-large-is-the-context-window-on-paid-claude-plans)
* [Change the model, effort, and thinking settings](https://support.claude.com/en/articles/8664678-change-the-model-effort-and-thinking-settings)
* [Release notes](https://support.claude.com/en/articles/12138966-release-notes)
* [Why Claude switched models in your conversation with Fable 5 or Fable 5.1](https://support.claude.com/en/articles/15363606-why-claude-switched-models-in-your-conversation-with-fable-5-or-fable-5-1)
* [Why Claude switched models in your conversation with Opus 5 or Opus 5.5](https://support.claude.com/en/articles/16049681-why-claude-switched-models-in-your-conversation-with-opus-5-or-opus-5-5)

On this page

* [What are thinking blocks?](#h_c6010b61e9)
* [What’s changing?](#h_f648e3b8e8)
* [Why are we making this change?](#h_d022c64278)
* [What does this mean for API integrations?](#h_9f1b1349e6)
* [Who will this impact?](#h_db6dad3a6a)

[![Claude Help Center](https://downloads.intercomcdn.com/i/o/487548/17213f6a445c8e6e874b1f4b/fad85208982e639d11b9108df895a293.png)](/en/)

* [Product](https://www.anthropic.com/product)
* [Research](https://www.anthropic.com/research)
* [Company](https://www.anthropic.com/company)
* [News](https://www.anthropic.com/news)
* [Careers](https://www.anthropic.com/careers)

* [Terms of Service - Consumer](https://www.anthropic.com/terms)
* [Terms of Service - Commercial](https://www.anthropic.com/legal/commercial-terms)
* [Privacy Policy](https://www.anthropic.com/privacy)
* [Usage Policy](https://www.anthropic.com/aup)
* [Responsible Disclosure Policy](https://www.anthropic.com/responsible-disclosure-policy)
* [Compliance](https://trust.anthropic.com/)
