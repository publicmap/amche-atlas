# Prompt API

Reusable LLM prompts for building and modifying amche atlases. Each file is a self-contained brief: link it into Claude Code (or any LLM) along with your specific data source and the model should have everything it needs to finish the task.

## How to use

In Claude Code, reference a prompt by URL and fill in the data-specific blanks:

```
Use https://github.com/publicmap/amche-atlas/blob/main/docs/prompts/atlas-from-vector-tiles.md
to build an atlas for <your data source>.
```

The prompt files link to `docs/API.md` (the canonical layer/config reference) so the model can resolve field names and types without further hints.

## Available prompts

- [atlas-from-vector-tiles.md](atlas-from-vector-tiles.md) — Build a multi-region atlas from a set of vector tile (`.pbf`) endpoints, one layer per region.

## Writing a new prompt

A good prompt file follows this shape:

1. **Goal** — one line stating what the LLM should produce.
2. **Reference** — link to `docs/API.md` so the model can look up the schema.
3. **Inputs** — the variables a user will fill in (data source URL, source-layer naming convention, data format).
4. **Styling** — paint properties to apply.
5. **Inspect features** — `id`, `title`, `label`, `fields` for the feature inspector.
6. **Worked example** — a concrete invocation that has been shown to produce a correct result.

Keep prompts under ~100 lines. If a prompt needs more, split it.
