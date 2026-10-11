# Tsuzuri（綴）

A writing tool for interactive articles (quizzes, calculators, graphs, tabs, steps, collapsible sections, image comparison, glossary terms, links between articles). You write and publish on the page itself, and readers read it there too.

- Published at: https://claude.ai/artifact/NLLV7Ez3uakrKMKwFpyeZ8
- `index.html` … reader view, admin and editor screens. The renderer and the formula calculator are in this file
- `tsuzuri.json` … site name and articles. When you press "公開する" (Publish) on the page, it is overwritten through the files form of the `artifact` capability
- `img/` … images and videos used in articles (uploads from the page are added here too)

To republish from your machine, copy these into the scratchpad and publish them with `files` (the Artifact tool only accepts the working directory or the scratchpad). Watch out: republishing from your machine overwrites articles edited on the page, so read `tsuzuri.json` from the live version first.
