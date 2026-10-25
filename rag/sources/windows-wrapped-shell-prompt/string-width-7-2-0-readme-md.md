---
title: "string-width 7.2.0 readme.md"
source_url: "https://raw.githubusercontent.com/sindresorhus/string-width/v7.2.0/readme.md"
source_type: official_source
fetched: 2026-10-25
topic: windows-wrapped-shell-prompt
tags: ["unicode", "terminal", "width", "node18"]
summary: "Node18対応の表示セル数を取得する既存libraryの固定一次資料。"
relevance: "psmuxの現在prompt折返しを実pane幅と照合し、日本語/emojiを文字数へ誤変換しない。"
chars: 1935
---

# string-width

> Get the visual width of a string - the number of columns required to display it

Some Unicode characters are [fullwidth](https://en.wikipedia.org/wiki/Halfwidth_and_fullwidth_forms) and use double the normal width. [ANSI escape codes](https://en.wikipedia.org/wiki/ANSI_escape_code) are stripped and doesn't affect the width.

Useful to be able to measure the actual width of command-line output.

## Install

```sh
npm install string-width
```

## Usage

```js
import stringWidth from 'string-width';

stringWidth('a');
//=> 1

stringWidth('古');
//=> 2

stringWidth('\u001B[1m古\u001B[22m');
//=> 2
```

## API

### stringWidth(string, options?)

#### string

Type: `string`

The string to be counted.

#### options

Type: `object`

##### ambiguousIsNarrow

Type: `boolean`\
Default: `true`

Count [ambiguous width characters](https://www.unicode.org/reports/tr11/#Ambiguous) as having narrow width (count of 1) instead of wide width (count of 2).

> Ambiguous characters behave like wide or narrow characters depending on the context (language tag, script identification, associated font, source of data, or explicit markup; all can provide the context). **If the context cannot be established reliably, they should be treated as narrow characters by default.**
> - http://www.unicode.org/reports/tr11/

##### countAnsiEscapeCodes

Type: `boolean`\
Default: `false`

Whether [ANSI escape codes](https://en.wikipedia.org/wiki/ANSI_escape_code) should be counted.

## Related

- [string-width-cli](https://github.com/sindresorhus/string-width-cli) - CLI for this module
- [string-length](https://github.com/sindresorhus/string-length) - Get the real length of a string
- [widest-line](https://github.com/sindresorhus/widest-line) - Get the visual width of the widest line in a string
- [get-east-asian-width](https://github.com/sindresorhus/get-east-asian-width) - Determine the East Asian Width of a Unicode character
