# Third-party notices

BlackCode includes work by other people. This file lists what ships inside the app
and under which license.

| Work | Where | License |
|---|---|---|
| [Feather Icons](https://github.com/feathericons/feather) | paths inside `renderer/iconos-tools.js` | MIT — © Cole Bemis |
| [KaTeX](https://katex.org) | `renderer/vendor/katex/` (module, mhchem extension, stylesheet) | MIT — © Khan Academy and other contributors |
| KaTeX fonts | `renderer/vendor/katex/fonts/` | OFL-1.1 — © Khan Academy and other contributors |
| [Roboto Mono](https://github.com/googlefonts/RobotoMono) | `@rad/fonts` | OFL-1.1 — © The Roboto Mono Project Authors |
| [xterm.js](https://xtermjs.org) | `renderer/vendor/xterm/` (module, fit addon, stylesheet), modified | MIT — © The xterm.js authors, © Christopher Jeffrey |
| [Model Context Protocol SDK](https://github.com/modelcontextprotocol/typescript-sdk) | `node_modules/@modelcontextprotocol/sdk` and its dependencies | MIT — © Anthropic, PBC |
| [esphome-client](https://github.com/hjdhjd/esphome-client) | `node_modules/esphome-client` | ISC — © 2017-2026 HJD |
| [@lydell/node-pty](https://github.com/lydell/node-pty) | `node_modules/@lydell/` (with its prebuilt binaries) | MIT — © Christopher Jeffrey, © Daniel Imms, © Microsoft Corporation, © Simon Lydell |

The tool icons in `renderer/iconos-tools.js` came with the tools from NeonCode.
They are a mix: several paths are Feather's verbatim, others are modified or
original.

`renderer/vendor/katex/` is KaTeX's own distribution, copied verbatim by
`scripts/vendor-katex.mjs` (the version is in `renderer/vendor/katex/VERSION`,
and its license text in `renderer/vendor/katex/LICENSE`). Only the `woff2`
variant of each font is shipped.

`renderer/vendor/xterm/` is xterm.js's own distribution, copied by
`scripts/vendor-xterm.mjs` with two changes to its module so it works under
this app's Content Security Policy (no inline styles): the `<style>` elements
it fills by hand became `<dm-estilo>` elements, and the one place that set a
`style` attribute now uses `style.setProperty`. The versions are in
`renderer/vendor/xterm/VERSION` and the license text in
`renderer/vendor/xterm/LICENSE`.

Electron, Chromium and their third-party components ship their own notices
inside the installer as `LICENSE.electron.txt` and `LICENSES.chromium.html`.
npm dependencies keep their `LICENSE` files inside `node_modules` in the
packaged app.

## Feather Icons

The MIT License (MIT)

Copyright (c) 2013-2023 Cole Bemis

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
