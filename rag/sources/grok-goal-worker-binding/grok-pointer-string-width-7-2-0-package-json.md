---
title: "string-width 7.2.0 package.json"
source_url: "https://raw.githubusercontent.com/sindresorhus/string-width/v7.2.0/package.json"
source_type: official_source
fetched: 2026-10-25
topic: grok-goal-worker-binding
tags: ["unicode", "terminal", "width", "node18"]
summary: "表示cell幅とGoal表示の位置を既存libraryで取得する。"
relevance: "Unicodeのcwd/branchを含む現在headerのクリック位置を、native pane座標へ正しく結合する。"
chars: 1139
---

{
	"name": "string-width",
	"version": "7.2.0",
	"description": "Get the visual width of a string - the number of columns required to display it",
	"license": "MIT",
	"repository": "sindresorhus/string-width",
	"funding": "https://github.com/sponsors/sindresorhus",
	"author": {
		"name": "Sindre Sorhus",
		"email": "sindresorhus@gmail.com",
		"url": "https://sindresorhus.com"
	},
	"type": "module",
	"exports": {
		"types": "./index.d.ts",
		"default": "./index.js"
	},
	"sideEffects": false,
	"engines": {
		"node": ">=18"
	},
	"scripts": {
		"test": "xo && ava && tsd"
	},
	"files": [
		"index.js",
		"index.d.ts"
	],
	"keywords": [
		"string",
		"character",
		"unicode",
		"width",
		"visual",
		"column",
		"columns",
		"fullwidth",
		"full-width",
		"full",
		"ansi",
		"escape",
		"codes",
		"cli",
		"command-line",
		"terminal",
		"console",
		"cjk",
		"chinese",
		"japanese",
		"korean",
		"fixed-width",
		"east-asian-width"
	],
	"dependencies": {
		"emoji-regex": "^10.3.0",
		"get-east-asian-width": "^1.0.0",
		"strip-ansi": "^7.1.0"
	},
	"devDependencies": {
		"ava": "^5.3.1",
		"tsd": "^0.29.0",
		"xo": "^0.56.0"
	}
}
